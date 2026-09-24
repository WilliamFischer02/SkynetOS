import { useEffect } from 'react';
import { resolveIntent } from '@shared/intent.js';
import type { VoiceHeard } from '@shared/voice.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { actOnIntent, intentContext } from './actOnIntent.js';

/**
 * What the board does with a spoken sentence.
 *
 * William, 2026-09-11: "the wake phrase 'hey jarvis' should take the persistent chat box from the
 * bottom left corner, center / scale it up as well as the catchphrase box widget above it … if what
 * followed 'hey jarvis' wasn't one of the skynetos functionality phrases but a question, it sends
 * that transcribed text as a message to the jarvis head/face."
 *
 * So there are two kinds of sentence, and the grammar (packages/shared/intent.ts) is what tells them
 * apart. A command it understands runs through the same `actOnIntent` a gesture uses. A sentence it
 * does not understand AT ALL is a question, and goes to the Face — after a short pause in which the
 * transcript is on screen and Esc cancels it, because whisper occasionally mishears, and a misheard
 * sentence sent to a conversation cannot be unsent. A command it understood but could not carry out
 * ("I do not see anything here called…") is not a question, and is not sent.
 *
 * Deletion is unchanged: `actOnIntent` refuses it for every producer, and a microphone is not an approval.
 */

/** How long the answer stays in the middle of the screen. */
const SHOW_MS = 2600;
/** The pause before a question is sent, during which Esc cancels it. */
const ASK_DELAY_MS = 2200;
/** The Face lives on the root board. */
const FACE_BOARD = 'root';

export function useVoice(): void {
  useEffect(() => {
    const store = useBoardStore;
    if (typeof window.skynet['voice:status'] !== 'function') return;
    void window.skynet['voice:status']().then((status) => store.getState().setVoiceStatus(status)).catch(() => undefined);

    let clearTimer: number | null = null;
    let askTimer: number | null = null;
    const clearLater = (ms: number): void => {
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => store.getState().setVoiceMoment(null), ms);
    };
    const cancelAsk = (): void => {
      if (askTimer !== null) window.clearTimeout(askTimer);
      askTimer = null;
    };

    const ask = async (text: string): Promise<void> => {
      askTimer = null;
      const state = store.getState();
      state.setVoiceMoment({ stage: 'sending', text });
      try {
        const result = await window.skynet['prompt:send']({ boardId: FACE_BOARD, text, files: [] });
        state.toast(result.stage === 'failed' ? 'fault' : result.ok ? 'ok' : 'warn', result.message);
      } catch (err) {
        state.toast('fault', `NOT SENT — ${(err as Error).message}`);
      }
      clearLater(900);
    };

    const heard = async (sentence: VoiceHeard): Promise<void> => {
      const state = store.getState();
      if (sentence.error) state.toast('warn', sentence.error);
      if (!sentence.text) {
        state.setVoiceMoment({ stage: 'nothing' });
        clearLater(1800);
        return;
      }
      const context = intentContext('voice');
      if (!context) {
        state.setVoiceMoment({ stage: 'did', text: sentence.text, say: 'The board is not loaded yet.' });
        clearLater(SHOW_MS);
        return;
      }
      const intent = resolveIntent(sentence.text, context);
      if (intent.kind === 'unknown' && !intent.understood) {
        state.setVoiceMoment({ stage: 'asking', text: sentence.text });
        cancelAsk();
        askTimer = window.setTimeout(() => void ask(sentence.text), ASK_DELAY_MS);
        return;
      }
      const said = await actOnIntent(intent);
      store.getState().setVoiceMoment({ stage: 'did', text: sentence.text, say: said });
      clearLater(SHOW_MS);
    };

    const offState = window.skynet.on('voice:state', (status) => {
      store.getState().setVoiceStatus(status);
      if (status.phase === 'thinking') store.getState().setVoiceMoment({ stage: 'thinking' });
      if (status.phase === 'off' || status.phase === 'unavailable') {
        cancelAsk();
        store.getState().setVoiceMoment(null);
      }
    });
    const offWake = window.skynet.on('voice:wake', () => {
      cancelAsk();
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      store.getState().setVoiceMoment({ stage: 'listening' });
    });
    const offHeard = window.skynet.on('voice:heard', (sentence) => {
      void heard(sentence);
    });

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || askTimer === null) return;
      cancelAsk();
      store.getState().setVoiceMoment({ stage: 'did', say: 'Not sent.' });
      clearLater(1200);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      offState();
      offWake();
      offHeard();
      window.removeEventListener('keydown', onKey);
      cancelAsk();
      if (clearTimer !== null) window.clearTimeout(clearTimer);
    };
  }, []);
}
