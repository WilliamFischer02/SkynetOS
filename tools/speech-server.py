"""
The synthesis server for voice profiles (docs/11-JARVIS-VOICE.md § Voice profiles, roadmap M13.2).

    python tools/speech-server.py [--port 47832] [--profiles <dir>]

Binds 127.0.0.1 only. Two routes, the contract `src/main/services/speech.ts` speaks:

    GET  /health                -> {"ok": true, "engine": "f5-tts", "device": "cuda", "profiles": [...]}
    GET  /warm                  -> loads the base model now
    GET  /profile/<name>        -> which checkpoint the profile speaks with, and its reference clip
    POST /synthesize            <- {"text": "...", "profile": "william", "nfe_step": 32, "cfg_strength": 2.0}
                                -> audio/wav (16-bit PCM, the model's sample rate)

A profile is a folder under %LOCALAPPDATA%/SkynetOS/voice-profiles/<name>/ with profile.json and
line-*.wav files that William recorded or imported. This server reads them as the REFERENCE for
synthesis (F5-TTS): it picks the best line with a transcript (2–15 s, scored by `score_reference`:
6–10 s, steady level, no clipping, ends on a sentence) and speaks the requested text in that voice.
When profile.json carries a `finetune` block ({"ckpt", "vocab", "use_ema"}, written by
`npm run speech:finetune -- apply <profile>`), that checkpoint speaks instead of the base model; if
it will not load, the base model does and the log says so. Nothing is trained here and nothing is
uploaded; the base weights are fetched once by F5-TTS into the Hugging Face cache.

No dependency beyond what `npm run speech:install` puts in the venv. Standard library HTTP; the
model is loaded on the first request and kept.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_CHARS = 400
REF_MIN_S = 2.0
REF_MAX_S = 15.0
# The band F5-TTS clones best from: long enough to carry the timbre, short enough that the
# preprocessor does not clip it at 12 s.
REF_IDEAL_MIN_S = 6.0
REF_IDEAL_MAX_S = 10.0
REF_TAIL_SILENCE_S = 0.6
DEFAULT_NFE = 32
DEFAULT_CFG = 2.0

_lock = threading.Lock()
_model = None                      # the base model
_tuned: dict[str, object] = {}     # fine-tuned models by checkpoint path
_tuned_failed: dict[str, str] = {}
_device = "cpu"
_ref_scores: dict[tuple[str, float], dict] = {}


def log(msg: str) -> None:
    print(f"[speech-server] {msg}", file=sys.stderr, flush=True)


def profiles_dir(override: str | None) -> Path:
    if override:
        return Path(override)
    local = os.environ.get("LOCALAPPDATA", "")
    return Path(local) / "SkynetOS" / "voice-profiles"


def wav_seconds(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as w:
            return w.getnframes() / float(w.getframerate() or 1)
    except Exception:
        return 0.0


def read_manifest(folder: Path) -> dict | None:
    manifest = folder / "profile.json"
    if not manifest.exists():
        return None
    try:
        return json.loads(manifest.read_text(encoding="utf-8"))
    except Exception:
        return None


def clip_stats(path: Path) -> dict:
    """Seconds, clipping ratio, loudness stability and trailing silence of a 16-bit PCM WAV."""
    key = (str(path), path.stat().st_mtime)
    cached = _ref_scores.get(key)
    if cached:
        return cached
    import numpy as np  # noqa: WPS433

    stats = {"seconds": 0.0, "clip": 1.0, "rms_cv": 9.0, "tail": 0.0}
    try:
        with wave.open(str(path), "rb") as w:
            sr = w.getframerate() or 16000
            raw = w.readframes(w.getnframes())
            width = w.getsampwidth()
            ch = w.getnchannels()
        if width == 2:
            x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        else:
            x = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0
        if ch > 1:
            x = x.reshape(-1, ch).mean(axis=1)
        n = len(x)
        if n:
            frame = max(1, sr // 20)  # 50 ms
            frames = x[: n - n % frame].reshape(-1, frame)
            rms = np.sqrt((frames ** 2).mean(axis=1)) if len(frames) else np.zeros(1)
            voiced = rms[rms > 0.01]
            stats["seconds"] = n / sr
            stats["clip"] = float((np.abs(x) > 0.985).mean())
            stats["rms_cv"] = float(voiced.std() / (voiced.mean() + 1e-6)) if len(voiced) > 2 else 9.0
            quiet = 0
            for v in rms[::-1]:
                if v > 0.01:
                    break
                quiet += 1
            stats["tail"] = quiet * frame / sr
    except Exception:
        pass
    _ref_scores[key] = stats
    return stats


def score_reference(stats: dict, text: str) -> float:
    """
    Higher is better. Duration inside 6–10 s scores full marks and falls off outside; clipping and
    an unsteady level cost; a transcript that ends in punctuation means the clip ends on a
    sentence, which F5 copies as its own phrasing.
    """
    secs = stats["seconds"]
    if REF_IDEAL_MIN_S <= secs <= REF_IDEAL_MAX_S:
        dur = 1.0
    elif secs < REF_IDEAL_MIN_S:
        dur = max(0.0, (secs - REF_MIN_S) / (REF_IDEAL_MIN_S - REF_MIN_S))
    else:
        dur = max(0.0, (REF_MAX_S - secs) / (REF_MAX_S - REF_IDEAL_MAX_S))
    clip_penalty = min(1.0, stats["clip"] * 200.0)
    steadiness = max(0.0, 1.0 - min(stats["rms_cv"], 2.0) / 2.0)
    ends_well = 1.0 if text.rstrip()[-1:] in ".!?" else 0.6
    return dur * 3.0 + steadiness * 1.5 + ends_well - clip_penalty * 2.0


def pick_reference(folder: Path, exclude: set[str] | None = None) -> tuple[Path, str] | None:
    """The best line with a transcript inside the reference window, by `score_reference`."""
    data = read_manifest(folder)
    if not data:
        return None
    best: tuple[float, Path, str] | None = None
    for line in data.get("lines", []):
        file = line.get("file")
        text = " ".join(str(line.get("text") or "").split())
        if not file or not text or (exclude and file in exclude):
            continue
        path = folder / file
        if not path.exists():
            continue
        stats = clip_stats(path)
        secs = stats["seconds"]
        if secs < REF_MIN_S or secs > REF_MAX_S:
            continue
        score = score_reference(stats, text)
        if best is None or score > best[0]:
            best = (score, path, text)
    return (best[1], best[2]) if best else None


def padded_reference(path: Path) -> Path:
    """
    F5 clones the reference's ending; a clip cut hard on the last word makes it swallow the last
    word of its own line. When the clip's tail holds less than REF_TAIL_SILENCE_S of quiet, a copy
    with 0.6 s of silence appended is written under %TEMP%/skynetos-speech/ (the preprocessor
    needs a path). The profile's own file is never touched.
    """
    stats = clip_stats(path)
    if stats["tail"] >= REF_TAIL_SILENCE_S * 0.5:
        return path
    import tempfile  # noqa: WPS433

    out_dir = Path(tempfile.gettempdir()) / "skynetos-speech"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{path.stem}-{int(path.stat().st_mtime)}-padded.wav"
    if out.exists():
        return out
    try:
        with wave.open(str(path), "rb") as w:
            params = w.getparams()
            frames = w.readframes(w.getnframes())
        silence = b"\x00" * int(params.framerate * REF_TAIL_SILENCE_S) * params.sampwidth * params.nchannels
        with wave.open(str(out), "wb") as o:
            o.setparams(params)
            o.writeframes(frames + silence)
        return out
    except Exception as err:
        log(f"could not pad reference {path.name}: {err}")
        return path


def finetune_of(folder: Path) -> dict | None:
    """profile.json's `finetune` block, when it names a checkpoint that exists."""
    data = read_manifest(folder)
    ft = (data or {}).get("finetune")
    if not isinstance(ft, dict):
        return None
    ckpt = str(ft.get("ckpt") or "")
    if not ckpt or not Path(ckpt).exists():
        return None
    vocab = str(ft.get("vocab") or "")
    return {"ckpt": ckpt, "vocab": vocab if vocab and Path(vocab).exists() else "", "use_ema": bool(ft.get("use_ema", False))}


def _patch_audio_loading() -> None:
    """
    torchaudio 2.9+ decodes through torchcodec, which needs FFmpeg's shared libraries on PATH.
    This machine has no FFmpeg, and the only files this server ever loads are its own 16 kHz PCM
    WAVs, so the reference audio is read with soundfile instead. Found by the first synthesis on
    2026-09-24: "Could not load libtorchcodec".
    """
    import soundfile as sf  # noqa: WPS433
    import torch  # noqa: WPS433
    import torchaudio  # noqa: WPS433

    def load(path, *args, **kwargs):  # noqa: ANN001
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
        return torch.from_numpy(data.T.copy()), int(sr)

    torchaudio.load = load


def load_model():
    global _model, _device
    with _lock:
        if _model is not None:
            return _model
        _patch_audio_loading()
        import torch  # noqa: WPS433
        from f5_tts.api import F5TTS  # noqa: WPS433

        _device = "cuda" if torch.cuda.is_available() else "cpu"
        t0 = time.time()
        _model = F5TTS(device=_device)
        log(f"model loaded on {_device} in {time.time() - t0:.1f}s")
        return _model


def load_tuned(ft: dict):
    """The fine-tuned model for a checkpoint, loaded once; None (and a reason) when it will not load."""
    key = ft["ckpt"]
    if key in _tuned:
        return _tuned[key]
    if key in _tuned_failed:
        return None
    load_model()  # the base first: it also picks the device and patches audio loading
    with _lock:
        if key in _tuned:
            return _tuned[key]
        from f5_tts.api import F5TTS  # noqa: WPS433

        t0 = time.time()
        try:
            model = F5TTS(ckpt_file=key, vocab_file=ft["vocab"], use_ema=ft["use_ema"], device=_device)
        except Exception as err:
            _tuned_failed[key] = str(err)
            log(f"fine-tune {key} did not load ({err}); using the base model")
            return None
        _tuned[key] = model
        log(f"fine-tune loaded from {Path(key).name} in {time.time() - t0:.1f}s (use_ema={ft['use_ema']})")
        return model


def model_for(folder: Path) -> tuple[object, str]:
    """The model a profile speaks with, and its name for the log and /profile route."""
    ft = finetune_of(folder)
    if ft:
        tuned = load_tuned(ft)
        if tuned is not None:
            return tuned, Path(ft["ckpt"]).name
    return load_model(), "F5TTS_v1_Base"


def synthesize(text: str, ref: Path, ref_text: str, folder: Path, nfe_step: int = DEFAULT_NFE, cfg_strength: float = DEFAULT_CFG) -> tuple[bytes, str]:
    import numpy as np  # noqa: WPS433

    model, name = model_for(folder)
    ref_path = padded_reference(ref)
    with _lock:
        wav, sr, _spec = model.infer(
            ref_file=str(ref_path), ref_text=ref_text, gen_text=text, remove_silence=True,
            nfe_step=nfe_step, cfg_strength=cfg_strength,
        )
    samples = np.asarray(wav, dtype=np.float32)
    if samples.ndim > 1:
        samples = samples.mean(axis=0)
    pcm = np.clip(samples, -1.0, 1.0)
    pcm16 = (pcm * 32767.0).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes(pcm16)
    return buf.getvalue(), name


class Handler(BaseHTTPRequestHandler):
    profiles: Path = Path(".")

    def _json(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        log(fmt % args)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/warm":
            # Load the model now, so the first real line does not pay for it. SkynetOS calls this
            # right after the server answers /health.
            try:
                t0 = time.time()
                load_model()
                self._json(200, {"ok": True, "device": _device, "seconds": round(time.time() - t0, 1)})
            except Exception as err:
                self._json(500, {"ok": False, "error": f"MODEL DID NOT LOAD — {err}"})
            return
        if self.path.startswith("/profile/"):
            name = self.path[len("/profile/"):].strip("/")
            if not name or any(c in name for c in "/\\.."):
                self._json(400, {"ok": False, "error": "NAME A PROFILE"})
                return
            folder = self.profiles / name
            if not folder.is_dir():
                self._json(404, {"ok": False, "error": f"NO PROFILE {name}"})
                return
            ft = finetune_of(folder)
            ref = pick_reference(folder)
            loaded = bool(ft and ft["ckpt"] in _tuned)
            self._json(200, {
                "ok": True,
                "profile": name,
                "model": Path(ft["ckpt"]).name if ft else "F5TTS_v1_Base",
                "finetune": ft,
                "finetuneLoaded": loaded,
                "finetuneError": _tuned_failed.get(ft["ckpt"]) if ft else None,
                "reference": {"file": ref[0].name, "text": ref[1], **clip_stats(ref[0])} if ref else None,
                "defaults": {"nfe_step": DEFAULT_NFE, "cfg_strength": DEFAULT_CFG},
            })
            return
        if self.path != "/health":
            self._json(404, {"ok": False, "error": "NO SUCH ROUTE"})
            return
        names = sorted(p.name for p in self.profiles.iterdir() if p.is_dir()) if self.profiles.exists() else []
        self._json(200, {"ok": True, "engine": "f5-tts", "device": _device if _model else "not loaded yet", "profiles": names})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/synthesize":
            self._json(404, {"ok": False, "error": "NO SUCH ROUTE"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            req = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._json(400, {"ok": False, "error": "BODY IS NOT JSON"})
            return
        text = " ".join(str(req.get("text", "")).split())[:MAX_CHARS]
        profile = str(req.get("profile", "")).strip()
        if not text:
            self._json(400, {"ok": False, "error": "NOTHING TO SAY"})
            return
        if not profile or any(c in profile for c in "/\\.."):
            self._json(400, {"ok": False, "error": "NAME A PROFILE"})
            return
        folder = self.profiles / profile
        ref = pick_reference(folder)
        if not ref:
            self._json(409, {"ok": False, "error": f"PROFILE {profile} HAS NO LINE WITH A TRANSCRIPT BETWEEN 2 AND 15 S — RECORD OR IMPORT ONE"})
            return
        try:
            nfe = int(req.get("nfe_step") or DEFAULT_NFE)
            cfg = float(req.get("cfg_strength") or DEFAULT_CFG)
        except (TypeError, ValueError):
            self._json(400, {"ok": False, "error": "nfe_step MUST BE A WHOLE NUMBER AND cfg_strength A NUMBER"})
            return
        nfe = max(8, min(128, nfe))
        cfg = max(0.5, min(5.0, cfg))
        try:
            t0 = time.time()
            data, model_name = synthesize(text, ref[0], ref[1], folder, nfe_step=nfe, cfg_strength=cfg)
            log(f"synthesised {len(text)} chars with {ref[0].name} on {model_name} (nfe {nfe}, cfg {cfg}) in {time.time() - t0:.1f}s")
        except Exception as err:  # the caller falls back to Windows' voice
            log(f"synthesis failed: {err}")
            self._json(500, {"ok": False, "error": f"SYNTHESIS FAILED — {err}"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=47832)
    parser.add_argument("--profiles", default=None)
    parser.add_argument("--warm", action="store_true", help="load the model before serving")
    args = parser.parse_args()
    Handler.profiles = profiles_dir(args.profiles)
    if args.warm:
        load_model()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    log(f"listening on http://127.0.0.1:{args.port} · profiles in {Handler.profiles}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
