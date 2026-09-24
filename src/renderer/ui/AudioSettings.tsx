import { useEffect } from 'react';
import type { VoiceStatus } from '@shared/voice.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * Audio: the switch, the wake phrase, the microphone, and the speech engine.
 *
 * Setting voice up is meant to be followable from this panel alone, so every line says what is true
 * and what to do about it.
 *
 * The one fact that cost an evening is still at the top of the microphone section: the WAKE PHRASE is
 * held by Windows' own recogniser, which listens to the Windows DEFAULT input and nothing else. The
 * first live test heard a keyboard and a fan because the default was a virtual device.
 */

const PHASE_WORDS: Record<VoiceStatus['phase'], string> = {
  off: 'Off',
  unavailable: 'Cannot start',
  starting: 'Loading the speech model',
  waiting: 'Listening for “Hey JARVIS”',
  listening: 'Hearing a sentence',
  thinking: 'Transcribing'
};

export function AudioSettings(): React.JSX.Element {
  const available = typeof window.skynet['voice:setEnabled'] === 'function';
  const status = useBoardStore((s) => s.voiceStatus);
  const setVoiceStatus = useBoardStore((s) => s.setVoiceStatus);
  const setVoiceEnabled = useBoardStore((s) => s.setVoiceEnabled);

  useEffect(() => {
    if (!available) return;
    void window.skynet['voice:status']().then(setVoiceStatus).catch(() => undefined);
  }, [available, setVoiceStatus]);

  if (!available) {
    return <div className="look-note">Restart SkynetOS to use voice: the running copy predates it.</div>;
  }

  const on = status.phase !== 'off';
  const problem = status.error && (status.phase === 'unavailable' || status.phase === 'off') ? status.error : null;

  return (
    <>
      <div className="setting-row">
        <span>Voice</span>
        <button type="button" className="btn tiny" aria-pressed={on} onClick={() => void setVoiceEnabled(!on)}>
          {on ? 'SWITCH OFF' : 'SWITCH ON'}
        </button>
      </div>
      <div className="look-note">
        <strong>{PHASE_WORDS[status.phase]}.</strong> {problem ?? ''} Off is a hard mute: the wake
        phrase, the speech engine and the microphone window are all stopped, not merely ignored. The
        VOICE button beside MANUAL does the same, and so does saying &ldquo;Hey JARVIS, stop listening&rdquo;.
      </div>

      <div className="setting-row">
        <span>Wake phrase</span>
        <span className="value ok-text">&ldquo;Hey JARVIS&rdquo;</span>
      </div>
      <div className="look-note">
        Before it, the only words anything can recognise are the wake phrase itself. After it, the
        microphone opens for ONE sentence and closes the moment you stop speaking. Say the phrase, pause
        until the prompt in the middle of the screen says LISTENING, then speak.
      </div>

      <div className="setting-row">
        <span>Microphone</span>
        <span className="value warn">{status.device || 'Windows default'}</span>
      </div>
      <div className="look-note">
        <strong>Make the microphone you speak into the Windows default input</strong> (Settings → System
        → Sound → Input) and watch its level move as you talk. The wake phrase can only listen to the
        default. The sentence after it uses the same device unless <span className="setting-path">voice.captureLabel</span> in
        settings.json names another — part of its name is enough, such as &ldquo;volt&rdquo;.
      </div>

      <div className="setting-row">
        <span>Speech engine</span>
        <span className={status.phase === 'unavailable' ? 'value warn' : 'value ok-text'}>
          {status.phase === 'unavailable' ? 'NOT RUNNING' : 'ON THIS MACHINE'}
        </span>
      </div>
      <div className="look-note">
        whisper.cpp{status.model ? ` with ${status.model}` : ''}, on the GPU, bound to 127.0.0.1. Measured: under 0.1 s a
        sentence once warm.
        Loading takes a second or two; the first start after a reboot takes longer while CUDA compiles
        for the card. No audio is written to disk and none leaves the computer.
      </div>

      <div className="setting-row">
        <span>What it does with a sentence</span>
        <span className="value ok-text">command or question</span>
      </div>
      <div className="look-note">
        A command the board understands runs, through the same grammar gestures use — &ldquo;zoom
        in&rdquo;, &ldquo;select the stalker&rdquo;, &ldquo;give me manual control&rdquo;. Anything else
        is a question: it is shown for two seconds, Esc cancels it, and then it is sent as text to the
        JARVIS Face. Voice can never delete anything; that still needs your hand on the confirmation.
      </div>
    </>
  );
}
