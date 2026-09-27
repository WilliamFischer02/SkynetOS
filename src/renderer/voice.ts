/**
 * The voice window: opens the microphone for one sentence, and closes it the moment the sentence ends.
 *
 * It does nothing until main says the wake phrase fired (`voice:listen`). Then it opens the chosen
 * microphone, feeds 20 ms of loudness at a time to the endpointer (packages/shared/voice-capture.ts),
 * and as soon as that decides the sentence is over — or that nobody spoke — it stops every track
 * BEFORE doing anything else. Only then is the sentence cut out, resampled to 16 kHz, encoded as WAV
 * and handed to main over IPC. Nothing is written anywhere and this page has no network.
 *
 * ScriptProcessorNode rather than an AudioWorklet: a worklet is a module the page must fetch, and this
 * page is served from a file with a CSP that gives it nothing to fetch from. The processor is
 * deprecated but supported, and a sentence is short.
 *
 * While the microphone is open, an AnalyserNode on the same stream reduces it to eight band levels
 * and a loudness thirty times a second (`voice:levels`, packages/shared/speech-levels.ts) so the
 * hologram's globe can move to William's own voice. Numbers only; no audio leaves this page by that
 * path, and the analyser stops with the tracks.
 */

import { DEFAULT_ENDPOINT, createEndpointer, downsample, encodeWav, rms, type EndpointConfig } from '@shared/voice-capture.js';
import type { VoiceCapture, VoiceListen } from '@shared/voice.js';
import { BAND_EDGES_HZ, LEVEL_BANDS, LEVEL_HOP_MS } from '@shared/speech-levels.js';

let busy = false;

window.skynet.on('voice:listen', (request) => {
  // A follow-up window (docs/07 § Voice) asks for its own silence budget; everything else about
  // the capture is the same: the same endpointer, the same 8 s of sentence, the tracks stopped.
  const noSpeechMs = request.noSpeechMs === undefined ? DEFAULT_ENDPOINT.noSpeechMs : Math.max(2000, Math.min(8000, Number(request.noSpeechMs) || DEFAULT_ENDPOINT.noSpeechMs));
  void listen(request, noSpeechMs === DEFAULT_ENDPOINT.noSpeechMs ? DEFAULT_ENDPOINT : { ...DEFAULT_ENDPOINT, noSpeechMs });
});

/*
 * A profile line (docs/11 § Voice profiles): the same microphone, the same endpointer, one line,
 * with more room to read it (up to 15 s) and more patience before giving up (6 s of silence). The
 * capture label is whatever the last `voice:listen` used; main asks for a line only while voice is
 * on, so one has always arrived first.
 */
let lastLabel = '';
window.skynet.on('voice:record', (request) => {
  const maxMs = Math.max(2000, Math.min(15_000, Number(request.maxMs) || 12_000));
  void listen({ captureLabel: lastLabel }, { ...DEFAULT_ENDPOINT, maxMs, noSpeechMs: 6000 });
});

/** A microphone whose name contains `label`, if Windows has told this page the names yet. */
async function pickDevice(label: string): Promise<string | null> {
  if (!label) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const wanted = label.toLowerCase();
  return devices.find((device) => device.kind === 'audioinput' && device.label.toLowerCase().includes(wanted))?.deviceId ?? null;
}

const join = (parts: Float32Array[]): Float32Array => {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/**
 * Levels from an AnalyserNode: the same eight log-spaced bands the speech side uses, each the mean
 * magnitude of its bins, against a slowly forgetting peak so a quiet room still moves the globe a
 * little and a shout does not pin it. Posts until `stop` is called.
 */
function startLevels(context: AudioContext, source: MediaStreamAudioSourceNode): () => void {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const time = new Uint8Array(analyser.fftSize);
  const binHz = context.sampleRate / analyser.fftSize;
  let peak = 0.05;
  const timer = window.setInterval(() => {
    analyser.getByteFrequencyData(data);
    analyser.getByteTimeDomainData(time);
    const sums = new Array<number>(LEVEL_BANDS).fill(0);
    const counts = new Array<number>(LEVEL_BANDS).fill(0);
    for (let k = 1; k < data.length; k++) {
      const hz = k * binHz;
      if (hz < BAND_EDGES_HZ[0]!) continue;
      let b = LEVEL_BANDS - 1;
      for (let e = 0; e < BAND_EDGES_HZ.length - 1; e++) if (hz < BAND_EDGES_HZ[e + 1]!) { b = e; break; }
      sums[b] = sums[b]! + data[k]! / 255;
      counts[b] = counts[b]! + 1;
    }
    let sq = 0;
    for (let i = 0; i < time.length; i++) { const v = (time[i]! - 128) / 128; sq += v * v; }
    const loud = Math.sqrt(sq / time.length);
    peak = Math.max(loud, peak * 0.995, 0.02);
    const bands = sums.map((s, b) => (counts[b]! > 0 ? Math.min(1, s / counts[b]!) : 0));
    void window.skynet['voice:levels']({ t: Date.now(), bands, rms: Math.min(1, loud / peak) }).catch(() => undefined);
  }, LEVEL_HOP_MS);
  return () => {
    window.clearInterval(timer);
    try { source.disconnect(analyser); } catch { /* already gone */ }
    try { analyser.disconnect(); } catch { /* already gone */ }
  };
}

async function listen(request: VoiceListen, config: EndpointConfig): Promise<void> {
  if (busy) return;
  busy = true;
  lastLabel = request.captureLabel;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let stopLevels: (() => void) | null = null;

  const close = async (): Promise<void> => {
    // The microphone first. Everything after this line works on audio already in memory.
    if (stopLevels) { stopLevels(); stopLevels = null; }
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
    context = null;
  };
  const deliver = async (capture: VoiceCapture): Promise<void> => {
    busy = false;
    await window.skynet['voice:captured'](capture);
  };

  try {
    const deviceId = await pickDevice(request.captureLabel);
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        // A desk microphone next to speakers benefits from these; whisper does not mind them.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    const device = stream.getAudioTracks()[0]?.label ?? '';
    context = new AudioContext();
    await context.resume();
    const rate = context.sampleRate;
    const frameSize = Math.max(1, Math.round((rate * config.frameMs) / 1000));
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const endpointer = createEndpointer(config);
    const chunks: Float32Array[] = [];
    let pending = new Float32Array(0);
    stopLevels = startLevels(context, source);

    const outcome = await new Promise<'done' | 'nothing'>((resolve) => {
      const backstop = window.setTimeout(() => resolve('nothing'), config.noSpeechMs + config.maxMs + 1500);
      processor.onaudioprocess = (event) => {
        const fresh = new Float32Array(event.inputBuffer.getChannelData(0));
        chunks.push(fresh);
        const buffer = join([pending, fresh]);
        let offset = 0;
        while (buffer.length - offset >= frameSize) {
          const state = endpointer.push(rms(buffer.subarray(offset, offset + frameSize)));
          offset += frameSize;
          if (state === 'done' || state === 'nothing') {
            window.clearTimeout(backstop);
            resolve(state);
            return;
          }
        }
        pending = buffer.slice(offset);
      };
      source.connect(processor);
      // The processor only runs while connected to an output; it writes nothing, so it is silent.
      processor.connect(context!.destination);
    });

    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    await close();

    const span = endpointer.span();
    if (outcome !== 'done' || !span) {
      await deliver({ reason: 'nothing', device });
      return;
    }
    const all = join(chunks);
    const sentence = all.subarray(span.start * frameSize, Math.min(all.length, span.end * frameSize));
    await deliver({ wav: encodeWav(downsample(sentence, rate)), device });
  } catch (err) {
    await close();
    await deliver({ reason: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
