"""
Fine-tune F5-TTS on a voice profile, in the venv `npm run speech:install` made.

    python tools/speech-finetune.py prepare <profile> [--min-seconds 2] [--max-seconds 15]
    python tools/speech-finetune.py train   <profile> [--epochs 100] [--batch-frames 3200] [--log-samples]
    python tools/speech-finetune.py status  <profile>
    python tools/speech-finetune.py stop    <profile> --yes
    python tools/speech-finetune.py prune   <profile>
    python tools/speech-finetune.py eval    <profile>
    python tools/speech-finetune.py apply   <profile>

Everything lives under %LOCALAPPDATA%/SkynetOS/voice/tts/:

    venv/                       the interpreter and f5-tts (never modified beyond one .pth hook)
    data/<profile>_char/        the prepared dataset (raw.arrow, duration.json, vocab.txt)
    data/Emilia_ZH_EN_pinyin/   the pretrained vocab F5-TTS's prepare step insists on finding here
    ckpts/<profile>/            pretrained_*.safetensors (copied in), model_<n>.pt, model_last.pt,
                                model_<n>_pruned.pt (weights only, what the server loads)
    finetune/<profile>/         metadata.csv, heldout.json, train.log, train.pid, train.json,
                                status.json, eval/

F5-TTS hard-codes its data and checkpoint roots as <site-packages>/../../data and ../../ckpts, which
in this venv is venv/Lib/data and venv/Lib/ckpts. Rather than write into the venv, those two names
are directory junctions onto data/ and ckpts/ above, so the files stay where the docs say and the
package finds them where it looks.

Audio decoding: torchaudio 2.9+ needs torchcodec/FFmpeg, absent here. The synthesis server patches
`torchaudio.load` in-process; training cannot, because DataLoader workers are fresh processes on
Windows. So a one-file `.pth` hook is installed into the venv's site-packages that patches
`torchaudio.load` and `torchaudio.info` with soundfile the moment torchaudio is imported, in every
interpreter of this venv. It falls back to the original on anything soundfile cannot read.

No clip is ever modified or deleted. Nothing is uploaded. The only download is F5-TTS's own
pretrained checkpoint, and only if the Hugging Face cache does not already hold it.
"""
from __future__ import annotations

import argparse
import ctypes
import glob
import json
import os
import re
import subprocess
import sys
import time
import wave
from datetime import datetime, timezone
from pathlib import Path

EXP_NAME = "F5TTS_v1_Base"
PRETRAINED_REL = "models--SWivid--F5-TTS/snapshots/*/F5TTS_v1_Base/model_1250000.safetensors"
HELDOUT_COUNT = 5
PATCH_MODULE = "skynet_torchaudio_patch"

PATCH_SOURCE = '''"""
Installed by SkynetOS (tools/speech-finetune.py). Patches torchaudio.load/info to read with
soundfile, because this machine has no FFmpeg for torchcodec. Applies in every interpreter of this
venv, including DataLoader worker processes. Falls back to torchaudio's own functions on failure.
"""
import importlib.abc
import importlib.machinery
import sys


def _patch(mod):
    try:
        import soundfile as sf
        import torch
    except Exception:
        return
    original_load = getattr(mod, "load", None)
    original_info = getattr(mod, "info", None)

    def load(path, *args, **kwargs):
        try:
            data, sr = sf.read(str(path), dtype="float32", always_2d=True)
            return torch.from_numpy(data.T.copy()), int(sr)
        except Exception:
            if original_load is None:
                raise
            return original_load(path, *args, **kwargs)

    class _Info:
        def __init__(self, i):
            self.sample_rate = int(i.samplerate)
            self.num_frames = int(i.frames)
            self.num_channels = int(i.channels)
            self.bits_per_sample = 16
            self.encoding = "PCM_S"

    def info(path, *args, **kwargs):
        try:
            return _Info(sf.info(str(path)))
        except Exception:
            if original_info is None:
                raise
            return original_info(path, *args, **kwargs)

    mod.load = load
    mod.info = info


class _Finder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if fullname != "torchaudio":
            return None
        for finder in sys.meta_path:
            if finder is self:
                continue
            spec = finder.find_spec(fullname, path, target) if hasattr(finder, "find_spec") else None
            if spec is None:
                continue
            loader = spec.loader
            if loader is None or not hasattr(loader, "exec_module"):
                return spec
            original_exec = loader.exec_module

            def exec_module(module, _orig=original_exec):
                _orig(module)
                _patch(module)

            loader.exec_module = exec_module
            return spec
        return None


if not any(isinstance(f, _Finder) for f in sys.meta_path):
    sys.meta_path.insert(0, _Finder())
'''


# ───────────────────────────── paths ─────────────────────────────


def tts_root() -> Path:
    local = os.environ.get("LOCALAPPDATA", "")
    return Path(local) / "SkynetOS" / "voice" / "tts"


def venv_python() -> Path:
    return tts_root() / "venv" / "Scripts" / "python.exe"


def site_packages() -> Path:
    return tts_root() / "venv" / "Lib" / "site-packages"


def profiles_dir() -> Path:
    local = os.environ.get("LOCALAPPDATA", "")
    return Path(local) / "SkynetOS" / "voice-profiles"


def profile_dir(profile: str) -> Path:
    if not profile or any(c in profile for c in "/\\.."):
        raise SystemExit("NAME A PROFILE")
    return profiles_dir() / profile


def data_dir(profile: str) -> Path:
    return tts_root() / "data" / f"{profile}_char"


def ckpt_dir(profile: str) -> Path:
    return tts_root() / "ckpts" / profile


def work_dir(profile: str) -> Path:
    return tts_root() / "finetune" / profile


def log(msg: str) -> None:
    print(f"[speech-finetune] {msg}", flush=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ───────────────────────────── layout ─────────────────────────────


def _junction(link: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    if link.exists() or link.is_symlink():
        return
    link.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"COULD NOT CREATE JUNCTION {link} -> {target}: {result.stderr.strip() or result.stdout.strip()}")
    log(f"junction {link} -> {target}")


def ensure_layout() -> None:
    """Directories, the two junctions F5-TTS needs, the pretrained vocab, and the torchaudio hook."""
    root = tts_root()
    if not venv_python().exists():
        raise SystemExit(f"NO SYNTHESIS ENVIRONMENT AT {venv_python()} — RUN npm run speech:install")
    for name in ("data", "ckpts", "finetune"):
        (root / name).mkdir(parents=True, exist_ok=True)
    lib = root / "venv" / "Lib"
    _junction(lib / "data", root / "data")
    _junction(lib / "ckpts", root / "ckpts")
    # The pretrained vocab, where prepare_csv_wavs asserts it must be. The package ships the same
    # 2,545-line file under infer/examples; copy it once.
    vocab_dst = root / "data" / "Emilia_ZH_EN_pinyin" / "vocab.txt"
    if not vocab_dst.exists():
        vocab_src = site_packages() / "f5_tts" / "infer" / "examples" / "vocab.txt"
        if not vocab_src.exists():
            raise SystemExit(f"PRETRAINED VOCAB NOT FOUND AT {vocab_src}")
        vocab_dst.parent.mkdir(parents=True, exist_ok=True)
        vocab_dst.write_bytes(vocab_src.read_bytes())
        log(f"pretrained vocab copied to {vocab_dst}")
    # The torchaudio hook, once.
    module = site_packages() / f"{PATCH_MODULE}.py"
    pth = site_packages() / f"{PATCH_MODULE}.pth"
    if module.read_text(encoding="utf-8") != PATCH_SOURCE if module.exists() else True:
        module.write_text(PATCH_SOURCE, encoding="utf-8")
        log(f"torchaudio hook written to {module}")
    if not pth.exists():
        pth.write_text(f"import {PATCH_MODULE}\n", encoding="utf-8")
        log(f"hook enabled by {pth}")


# ───────────────────────────── profile ─────────────────────────────


def read_profile(profile: str) -> dict:
    manifest = profile_dir(profile) / "profile.json"
    if not manifest.exists():
        raise SystemExit(f"NO PROFILE AT {manifest}")
    return json.loads(manifest.read_text(encoding="utf-8"))


def clip_seconds(path: Path, ms: int | None) -> float:
    if ms and ms > 0:
        return ms / 1000.0
    try:
        with wave.open(str(path), "rb") as w:
            return w.getnframes() / float(w.getframerate() or 1)
    except Exception:
        return 0.0


def usable_lines(profile: str, min_s: float, max_s: float) -> list[dict]:
    """Every line with a file on disk, a transcript, and a duration inside the window."""
    folder = profile_dir(profile)
    out: list[dict] = []
    for line in read_profile(profile).get("lines", []):
        file = line.get("file")
        text = " ".join(str(line.get("text") or "").split())
        if not file or not text:
            continue
        path = folder / file
        if not path.exists():
            continue
        secs = clip_seconds(path, line.get("ms"))
        if secs < min_s or secs > max_s:
            continue
        out.append({"id": line.get("id") or file, "file": str(path), "text": text, "seconds": round(secs, 3)})
    out.sort(key=lambda l: l["id"])
    return out


def choose_heldout(lines: list[dict], count: int = HELDOUT_COUNT) -> list[dict]:
    """Deterministic: among 3–8 s clips, every Nth by id, so eval never trains on itself."""
    pool = [l for l in lines if 3.0 <= l["seconds"] <= 8.0]
    if len(pool) < count * 2:
        pool = lines
    if not pool:
        return []
    step = max(1, len(pool) // count)
    return pool[::step][:count]


# ───────────────────────────── prepare ─────────────────────────────


def cmd_prepare(args: argparse.Namespace) -> None:
    ensure_layout()
    profile = args.profile
    lines = usable_lines(profile, args.min_seconds, args.max_seconds)
    if not lines:
        raise SystemExit(f"PROFILE {profile} HAS NO CLIP WITH A TRANSCRIPT BETWEEN {args.min_seconds} AND {args.max_seconds} S")
    heldout = choose_heldout(lines)
    held_ids = {l["id"] for l in heldout}
    train = [l for l in lines if l["id"] not in held_ids]
    work = work_dir(profile)
    work.mkdir(parents=True, exist_ok=True)
    csv_path = work / "metadata.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        f.write("audio_file|text\n")
        for l in train:
            text = l["text"].replace("|", "/").replace("\n", " ")
            f.write(f"{l['file']}|{text}\n")
    (work / "heldout.json").write_text(json.dumps(heldout, indent=1), encoding="utf-8")
    minutes = sum(l["seconds"] for l in train) / 60.0
    log(f"{len(train)} clips for training ({minutes:.1f} min), {len(heldout)} held out, window {args.min_seconds}–{args.max_seconds} s")

    # Run F5-TTS's own preparation in-process, with the two things it cannot find here supplied.
    import torchaudio  # noqa: F401  (patched by the hook; keep the import so the patch is live)
    from f5_tts.train.datasets import prepare_csv_wavs as prep

    prep.PRETRAINED_VOCAB_PATH = tts_root() / "data" / "Emilia_ZH_EN_pinyin" / "vocab.txt"
    out = data_dir(profile)
    out.mkdir(parents=True, exist_ok=True)
    prep.prepare_and_save_set(str(csv_path), str(out), is_finetune=True, num_workers=max(1, min(4, os.cpu_count() or 1)))
    summary = {
        "profile": profile,
        "prepared": now_iso(),
        "clips": len(train),
        "minutes": round(minutes, 2),
        "heldout": len(heldout),
        "window": [args.min_seconds, args.max_seconds],
        "dataset": str(out),
    }
    (work / "dataset.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    log(f"dataset at {out}")
    for k in ("raw.arrow", "duration.json", "vocab.txt"):
        if not (out / k).exists():
            raise SystemExit(f"PREPARE DID NOT WRITE {out / k}")
    print(json.dumps(summary))


# ───────────────────────────── train ─────────────────────────────


def pretrained_checkpoint() -> str | None:
    cache = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub"
    hits = sorted(glob.glob(str(cache / PRETRAINED_REL)))
    return hits[-1] if hits else None


def train_args(profile: str, a: argparse.Namespace) -> list[str]:
    out = [
        "--exp_name", EXP_NAME,
        "--dataset_name", profile,
        "--finetune",
        "--tokenizer", "char",
        "--learning_rate", str(a.learning_rate),
        "--batch_size_per_gpu", str(a.batch_frames),
        "--batch_size_type", "frame",
        "--max_samples", str(a.max_samples),
        "--grad_accumulation_steps", "1",
        "--max_grad_norm", "1.0",
        "--epochs", str(a.epochs),
        "--num_warmup_updates", str(a.warmup),
        "--save_per_updates", str(a.save_every),
        "--last_per_updates", str(a.last_every),
        "--keep_last_n_checkpoints", str(a.keep),
    ]
    pre = pretrained_checkpoint()
    if pre:
        out += ["--pretrain", pre]
    if a.log_samples:
        out.append("--log_samples")
    return out


def process_alive(pid: int) -> bool:
    """Windows: never os.kill(pid, 0) here, it TERMINATES. Query the handle instead."""
    if pid <= 0:
        return False
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return False
    try:
        code = ctypes.c_ulong()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return False
        return code.value == 259  # STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def running_pid(profile: str) -> int | None:
    pid_file = work_dir(profile) / "train.pid"
    if not pid_file.exists():
        return None
    try:
        pid = int(pid_file.read_text().strip() or "0")
    except ValueError:
        return None
    return pid if process_alive(pid) else None


def cmd_train(args: argparse.Namespace) -> None:
    ensure_layout()
    profile = args.profile
    if not (data_dir(profile) / "raw.arrow").exists():
        raise SystemExit(f"NO DATASET FOR {profile} — RUN prepare FIRST")
    pid = running_pid(profile)
    if pid:
        raise SystemExit(f"TRAINING IS ALREADY RUNNING FOR {profile} (pid {pid}) — status OR stop --yes")
    work = work_dir(profile)
    work.mkdir(parents=True, exist_ok=True)
    ckpt_dir(profile).mkdir(parents=True, exist_ok=True)
    cli = train_args(profile, args)
    cmd = [str(venv_python()), "-u", str(Path(__file__).resolve()), "_train", profile, "--", *cli]
    log_path = work / "train.log"
    env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8", TQDM_MININTERVAL="5")
    DETACHED = 0x00000008
    NEW_GROUP = 0x00000200
    NO_WINDOW = 0x08000000
    with log_path.open("ab") as lf:
        lf.write(f"\n===== {now_iso()} start: {' '.join(cmd)}\n".encode("utf-8"))
        proc = subprocess.Popen(
            cmd,
            cwd=str(tts_root()),
            stdin=subprocess.DEVNULL,
            stdout=lf,
            stderr=subprocess.STDOUT,
            env=env,
            creationflags=DETACHED | NEW_GROUP | NO_WINDOW,
            close_fds=True,
        )
    (work / "train.pid").write_text(str(proc.pid), encoding="utf-8")
    (work / "train.json").write_text(json.dumps({
        "profile": profile,
        "pid": proc.pid,
        "started": now_iso(),
        "command": cmd,
        "epochs": args.epochs,
        "batch_frames": args.batch_frames,
        "log": str(log_path),
        "checkpoints": str(ckpt_dir(profile)),
    }, indent=1), encoding="utf-8")
    log(f"training started detached, pid {proc.pid}, log {log_path}")
    print(json.dumps({"pid": proc.pid, "log": str(log_path), "command": cmd}))


def cmd__train(args: argparse.Namespace) -> None:
    """The detached child: F5-TTS's finetune_cli.main with its arguments, and a heartbeat file."""
    import torchaudio  # noqa: F401  (hook)

    cli = list(args.cli)
    if cli and cli[0] == "--":
        cli = cli[1:]
    sys.argv = ["f5-tts_finetune-cli", *cli]
    heartbeat = work_dir(args.profile) / "heartbeat.json"

    # Replicate finetune_cli.main so the DataLoader worker count can be set: the CLI hard-codes 16,
    # and each Windows worker is a spawned interpreter (the .pth hook covers them).
    from importlib.resources import files
    from f5_tts.train import finetune_cli as fc
    from f5_tts.model import CFM, DiT, Trainer
    from f5_tts.model.dataset import load_dataset
    from f5_tts.model.utils import get_tokenizer
    import shutil

    a = fc.parse_args()
    checkpoint_path = str(files("f5_tts").joinpath(f"../../ckpts/{a.dataset_name}"))
    if a.exp_name != "F5TTS_v1_Base":
        raise SystemExit("ONLY F5TTS_v1_Base IS SUPPORTED HERE")
    model_cfg = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4)
    if a.pretrain is None:
        from cached_path import cached_path
        ckpt_path = str(cached_path("hf://SWivid/F5-TTS/F5TTS_v1_Base/model_1250000.safetensors"))
    else:
        ckpt_path = a.pretrain
    os.makedirs(checkpoint_path, exist_ok=True)
    file_checkpoint = os.path.basename(ckpt_path)
    if not file_checkpoint.startswith("pretrained_"):
        file_checkpoint = "pretrained_" + file_checkpoint
    file_checkpoint = os.path.join(checkpoint_path, file_checkpoint)
    if not os.path.isfile(file_checkpoint):
        shutil.copy2(ckpt_path, file_checkpoint)
        print("copy checkpoint for finetune", flush=True)

    vocab_char_map, vocab_size = get_tokenizer(a.dataset_name, a.tokenizer)
    print(f"vocab: {vocab_size}", flush=True)
    mel_spec_kwargs = dict(
        n_fft=fc.n_fft, hop_length=fc.hop_length, win_length=fc.win_length,
        n_mel_channels=fc.n_mel_channels, target_sample_rate=fc.target_sample_rate, mel_spec_type=fc.mel_spec_type,
    )
    model = CFM(
        transformer=DiT(**model_cfg, text_num_embeds=vocab_size, mel_dim=fc.n_mel_channels),
        mel_spec_kwargs=mel_spec_kwargs,
        vocab_char_map=vocab_char_map,
    )
    trainer = Trainer(
        model, a.epochs, a.learning_rate,
        num_warmup_updates=a.num_warmup_updates,
        save_per_updates=a.save_per_updates,
        keep_last_n_checkpoints=a.keep_last_n_checkpoints,
        checkpoint_path=checkpoint_path,
        batch_size_per_gpu=a.batch_size_per_gpu,
        batch_size_type=a.batch_size_type,
        max_samples=a.max_samples,
        grad_accumulation_steps=a.grad_accumulation_steps,
        max_grad_norm=a.max_grad_norm,
        logger=a.logger,
        wandb_project=a.dataset_name,
        wandb_run_name=a.exp_name,
        wandb_resume_id=None,
        log_samples=a.log_samples,
        last_per_updates=a.last_per_updates,
        bnb_optimizer=a.bnb_optimizer,
    )
    train_dataset = load_dataset(a.dataset_name, a.tokenizer, mel_spec_kwargs=mel_spec_kwargs)
    heartbeat.write_text(json.dumps({"at": now_iso(), "stage": "training", "samples": len(train_dataset)}), encoding="utf-8")
    print(f"samples: {len(train_dataset)}", flush=True)
    trainer.train(train_dataset, num_workers=2, resumable_with_seed=666)
    heartbeat.write_text(json.dumps({"at": now_iso(), "stage": "done"}), encoding="utf-8")
    print("training finished", flush=True)


# ───────────────────────────── status / stop ─────────────────────────────

UPDATE_RE = re.compile(r"update=(\d+)")
LOSS_RE = re.compile(r"loss=([\d.eE+-]+)")
BAR_RE = re.compile(r"Epoch (\d+)/(\d+):\s*\d+%\|[^|]*\|\s*(\d+)/(\d+)\s*\[([^\]]*)\]")
RATE_RE = re.compile(r"([\d.]+)\s*(s/update|update/s|s/it|it/s)")


def parse_log(text: str) -> dict:
    """The last progress line tqdm wrote: update, loss, epoch, per-epoch steps, seconds per update."""
    tail = text[-200_000:]
    chunks = re.split(r"[\r\n]+", tail)
    out: dict = {"update": None, "loss": None, "epoch": None, "epochs": None, "step": None, "perEpoch": None, "secPerUpdate": None, "saved": None, "error": None}
    for line in chunks:
        m = UPDATE_RE.search(line)
        if m:
            out["update"] = int(m.group(1))
            lm = LOSS_RE.search(line)
            if lm:
                try:
                    out["loss"] = float(lm.group(1))
                except ValueError:
                    pass
        b = BAR_RE.search(line)
        if b:
            out["epoch"], out["epochs"], out["step"], out["perEpoch"] = int(b.group(1)), int(b.group(2)), int(b.group(3)), int(b.group(4))
            r = RATE_RE.search(b.group(5))
            if r:
                v = float(r.group(1))
                out["secPerUpdate"] = v if r.group(2).startswith("s/") else (1.0 / v if v > 0 else None)
        s = re.search(r"Saved (?:last )?checkpoint at update (\d+)", line)
        if s:
            out["saved"] = int(s.group(1))
        if re.search(r"Traceback|Error:|OutOfMemoryError|CUDA out of memory", line):
            out["error"] = line.strip()[:300]
    return out


def gpu_memory() -> dict | None:
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
        used, total = [int(x.strip()) for x in r.stdout.strip().splitlines()[0].split(",")]
        return {"usedMiB": used, "totalMiB": total}
    except Exception:
        return None


def checkpoints(profile: str) -> list[dict]:
    folder = ckpt_dir(profile)
    if not folder.exists():
        return []
    out = []
    for p in sorted(folder.glob("*.pt")) + sorted(folder.glob("*.safetensors")):
        out.append({"file": p.name, "mb": round(p.stat().st_size / 1_048_576), "modified": datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")})
    return out


def cmd_status(args: argparse.Namespace) -> None:
    profile = args.profile
    work = work_dir(profile)
    info = json.loads((work / "train.json").read_text(encoding="utf-8")) if (work / "train.json").exists() else {}
    pid = running_pid(profile)
    log_path = work / "train.log"
    parsed = parse_log(log_path.read_text(encoding="utf-8", errors="replace")) if log_path.exists() else parse_log("")
    started = info.get("started")
    elapsed = None
    if started:
        try:
            elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(started)).total_seconds()
        except ValueError:
            elapsed = None
    total_updates = (parsed["epochs"] or info.get("epochs") or 0) * (parsed["perEpoch"] or 0) or None
    done = parsed["update"] or 0
    rate = parsed["secPerUpdate"]
    if rate is None and elapsed and done:
        rate = elapsed / done
    eta_s = (total_updates - done) * rate if (total_updates and rate and done) else None
    status = {
        "profile": profile,
        "running": pid is not None,
        "pid": pid or info.get("pid"),
        "started": started,
        "elapsedMin": round(elapsed / 60, 1) if elapsed else None,
        "update": parsed["update"],
        "loss": parsed["loss"],
        "epoch": parsed["epoch"],
        "epochs": parsed["epochs"] or info.get("epochs"),
        "updatesPerEpoch": parsed["perEpoch"],
        "totalUpdates": total_updates,
        "secPerUpdate": round(rate, 2) if rate else None,
        "etaHours": round(eta_s / 3600, 1) if eta_s else None,
        "lastSaved": parsed["saved"],
        "checkpoints": checkpoints(profile),
        "gpu": gpu_memory(),
        "error": parsed["error"],
        "log": str(log_path),
    }
    (work / "status.json").write_text(json.dumps(status, indent=1), encoding="utf-8") if work.exists() else None
    print(json.dumps(status))


def cmd_stop(args: argparse.Namespace) -> None:
    if not args.yes:
        raise SystemExit("STOPPING TRAINING THROWS AWAY EVERYTHING SINCE THE LAST CHECKPOINT — ADD --yes IF WILLIAM SAID SO")
    pid = running_pid(args.profile)
    if not pid:
        log("nothing is running")
        return
    r = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, text=True)
    log(f"stopped pid {pid}: {(r.stdout or r.stderr).strip()}")


# ───────────────────────────── prune / apply / eval ─────────────────────────────


def latest_training_checkpoint(profile: str) -> Path | None:
    folder = ckpt_dir(profile)
    if not folder.exists():
        return None
    numbered = []
    for p in folder.glob("model_*.pt"):
        m = re.match(r"model_(\d+)\.pt$", p.name)
        if m:
            numbered.append((int(m.group(1)), p))
    last = folder / "model_last.pt"
    if numbered:
        numbered.sort()
        best = numbered[-1][1]
        if last.exists() and last.stat().st_mtime > best.stat().st_mtime:
            return last
        return best
    return last if last.exists() else None


def cmd_prune(args: argparse.Namespace) -> None:
    import torch

    profile = args.profile
    src = latest_training_checkpoint(profile)
    if not src:
        raise SystemExit(f"NO TRAINING CHECKPOINT YET IN {ckpt_dir(profile)}")
    ckpt = torch.load(str(src), map_location="cpu", weights_only=True)
    update = int(ckpt.get("update", 0) or 0)
    if "model_state_dict" not in ckpt:
        raise SystemExit(f"{src.name} HAS NO model_state_dict")
    pruned = {"model_state_dict": ckpt["model_state_dict"], "update": update}
    dst = ckpt_dir(profile) / f"model_{update}_pruned.pt"
    torch.save(pruned, str(dst))
    log(f"{src.name} ({src.stat().st_size // 1_048_576} MB) -> {dst.name} ({dst.stat().st_size // 1_048_576} MB), update {update}")
    print(json.dumps({"source": str(src), "pruned": str(dst), "update": update}))


def pruned_checkpoint(profile: str) -> Path | None:
    folder = ckpt_dir(profile)
    hits = []
    for p in folder.glob("model_*_pruned.pt") if folder.exists() else []:
        m = re.match(r"model_(\d+)_pruned\.pt$", p.name)
        if m:
            hits.append((int(m.group(1)), p))
    hits.sort()
    return hits[-1][1] if hits else None


def cmd_apply(args: argparse.Namespace) -> None:
    """Point profile.json at the pruned checkpoint. Only when one exists; never before."""
    profile = args.profile
    pruned = pruned_checkpoint(profile)
    if not pruned:
        raise SystemExit("NO PRUNED CHECKPOINT — RUN prune FIRST")
    vocab = data_dir(profile) / "vocab.txt"
    if not vocab.exists():
        raise SystemExit(f"NO VOCAB AT {vocab}")
    manifest = profile_dir(profile) / "profile.json"
    data = json.loads(manifest.read_text(encoding="utf-8"))
    data["finetune"] = {"ckpt": str(pruned), "vocab": str(vocab), "use_ema": False, "applied": now_iso()}
    # The app reads `trained` as {at, model} (packages/shared/speech.ts); anything else is dropped.
    data["trained"] = {"at": now_iso(), "model": f"f5-tts fine-tune {pruned.name}"}
    data["updatedAt"] = now_iso()
    manifest.write_text(json.dumps(data, indent=2), encoding="utf-8")
    log(f"{manifest} now points at {pruned.name}; the server picks it up on its next synthesis for {profile}")
    print(json.dumps(data["finetune"]))


def _write_wav(path: Path, wav, sr: int) -> None:
    import numpy as np

    samples = np.asarray(wav, dtype=np.float32)
    if samples.ndim > 1:
        samples = samples.mean(axis=0)
    pcm16 = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes(pcm16)


def _mel_cosine(a: Path, b: Path) -> float:
    """A cheap proxy: cosine between mean log-mel vectors at 16 kHz. Not a speaker model."""
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio

    def mean_mel(path: Path):
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
        x = torch.from_numpy(data.T.copy()).mean(dim=0, keepdim=True)
        if sr != 16000:
            x = torchaudio.transforms.Resample(sr, 16000)(x)
        mel = torchaudio.transforms.MelSpectrogram(16000, n_fft=1024, hop_length=256, n_mels=80)(x)
        return torch.log(mel + 1e-6).mean(dim=-1).squeeze().numpy()

    va, vb = mean_mel(a), mean_mel(b)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb) + 1e-9))


def cmd_eval(args: argparse.Namespace) -> None:
    import torchaudio  # noqa: F401
    from f5_tts.api import F5TTS

    profile = args.profile
    work = work_dir(profile)
    held_path = work / "heldout.json"
    if not held_path.exists():
        raise SystemExit("NO heldout.json — RUN prepare FIRST")
    heldout = json.loads(held_path.read_text(encoding="utf-8"))
    pruned = pruned_checkpoint(profile)
    vocab = data_dir(profile) / "vocab.txt"
    out = work / "eval"
    out.mkdir(parents=True, exist_ok=True)
    # The reference: the best training clip (not held out), by the server's own rule.
    import importlib.util

    spec = importlib.util.spec_from_file_location("speech_server", Path(__file__).resolve().parent / "speech-server.py")
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)  # type: ignore[union-attr]
    held_files = {Path(h["file"]).name for h in heldout}
    ref = server.pick_reference(profile_dir(profile), exclude=held_files)
    if not ref:
        raise SystemExit("NO REFERENCE CLIP")
    ref_file, ref_text = ref
    results = {"reference": str(ref_file), "pruned": str(pruned) if pruned else None, "lines": [], "note": "melCosine is a log-mel proxy against the real clip, not a speaker model; the F5 eval speaker model (WavLM-large) is not on this machine"}
    base = F5TTS()
    tuned = F5TTS(ckpt_file=str(pruned), vocab_file=str(vocab), use_ema=False) if pruned else None
    for i, h in enumerate(heldout, 1):
        row = {"id": h["id"], "text": h["text"], "real": h["file"]}
        wav, sr, _ = base.infer(ref_file=str(ref_file), ref_text=ref_text, gen_text=h["text"], remove_silence=True, show_info=lambda *_: None, progress=None)
        bp = out / f"base_{i:02d}.wav"
        _write_wav(bp, wav, sr)
        row["base"] = str(bp)
        row["baseMelCosine"] = round(_mel_cosine(bp, Path(h["file"])), 4)
        if tuned:
            wav, sr, _ = tuned.infer(ref_file=str(ref_file), ref_text=ref_text, gen_text=h["text"], remove_silence=True, show_info=lambda *_: None, progress=None)
            tp = out / f"tuned_{i:02d}.wav"
            _write_wav(tp, wav, sr)
            row["tuned"] = str(tp)
            row["tunedMelCosine"] = round(_mel_cosine(tp, Path(h["file"])), 4)
        results["lines"].append(row)
        log(f"{i}/{len(heldout)} {h['id']}: base {row['baseMelCosine']}" + (f", tuned {row['tunedMelCosine']}" if tuned else ""))
    (out / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    print(json.dumps(results))


# ───────────────────────────── main ─────────────────────────────


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("prepare"); s.add_argument("profile"); s.add_argument("--min-seconds", type=float, default=2.0); s.add_argument("--max-seconds", type=float, default=15.0); s.set_defaults(fn=cmd_prepare)
    s = sub.add_parser("train"); s.add_argument("profile")
    s.add_argument("--epochs", type=int, default=100); s.add_argument("--batch-frames", type=int, default=3200); s.add_argument("--max-samples", type=int, default=64)
    s.add_argument("--learning-rate", type=float, default=1e-5); s.add_argument("--warmup", type=int, default=100)
    s.add_argument("--save-every", type=int, default=500); s.add_argument("--last-every", type=int, default=250); s.add_argument("--keep", type=int, default=3)
    s.add_argument("--log-samples", action="store_true"); s.set_defaults(fn=cmd_train)
    s = sub.add_parser("_train"); s.add_argument("profile"); s.add_argument("cli", nargs=argparse.REMAINDER); s.set_defaults(fn=cmd__train)
    s = sub.add_parser("status"); s.add_argument("profile"); s.set_defaults(fn=cmd_status)
    s = sub.add_parser("stop"); s.add_argument("profile"); s.add_argument("--yes", action="store_true"); s.set_defaults(fn=cmd_stop)
    s = sub.add_parser("prune"); s.add_argument("profile"); s.set_defaults(fn=cmd_prune)
    s = sub.add_parser("apply"); s.add_argument("profile"); s.set_defaults(fn=cmd_apply)
    s = sub.add_parser("eval"); s.add_argument("profile"); s.set_defaults(fn=cmd_eval)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
