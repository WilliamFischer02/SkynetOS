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
 */

import { DEFAULT_ENDPOINT, createEndpointer, downsample, encodeWav, rms } from '@shared/voice-capture.js';
import type { VoiceCapture, VoiceListen } from '@shared/voice.js';

let busy = false;

window.skynet.on('voice:listen', (request) => {
  void listen(request);
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

async function listen(request: VoiceListen): Promise<void> {
  if (busy) return;
  busy = true;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;

  const close = async (): Promise<void> => {
    // The microphone first. Everything after this line works on audio already in memory.
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
    const frameSize = Math.max(1, Math.round((rate * DEFAULT_ENDPOINT.frameMs) / 1000));
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const endpointer = createEndpointer();
    const chunks: Float32Array[] = [];
    let pending = new Float32Array(0);

    const outcome = await new Promise<'done' | 'nothing'>((resolve) => {
      const backstop = window.setTimeout(() => resolve('nothing'), DEFAULT_ENDPOINT.noSpeechMs + DEFAULT_ENDPOINT.maxMs + 1500);
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
