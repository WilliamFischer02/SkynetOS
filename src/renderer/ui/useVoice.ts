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
 * William, 2026-09-24: "it opened a U1 jarvis window in claude web and said nothing in response
 * to me - my goal is for instead, it to talk back to me conversationally and me to be able to
 * continue by saying my next command. No need for the claude web window to open."
 *
 * So there are two kinds of sentence, and the grammar (packages/shared/intent.ts) is what tells them
 * apart. A command it understands runs through the same `actOnIntent` a gesture uses, and the
 * one-line result is spoken. A sentence it does not understand AT ALL is a question, and JARVIS
 * answers it himself: `converse:ask` composes a spoken reply in main and says it (docs/11
 * § Conversation). The Face (claude.ai) is reached only by asking for it in words: "ask the face …",
 * which is the `faceSend` view action in actOnIntent. A command it understood but could not carry
 * out ("I do not see anything here called…") is neither, and is only shown and said.
 *
 * Deletion is unchanged: `actOnIntent` refuses it for every producer, and a microphone is not an approval.
 */

/** How long the answer stays in the middle of the screen. */
const SHOW_MS = 2600;

export function useVoice(): void {
  useEffect(() => {
    const store = useBoardStore;
    if (typeof window.skynet['voice:status'] !== 'function') return;
    void window.skynet['voice:status']().then((status) => store.getState().setVoiceStatus(status)).catch(() => undefined);

    let clearTimer: number | null = null;
    const clearLater = (ms: number): void => {
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => store.getState().setVoiceMoment(null), ms);
    };

    /** A question: JARVIS answers it out loud from main. Nothing goes to claude.ai. */
    const answer = async (text: string): Promise<void> => {
      const state = store.getState();
      if (typeof window.skynet['converse:ask'] !== 'function') {
        state.setVoiceMoment({ stage: 'did', text, say: 'Restart SkynetOS to talk: the running copy predates it.' });
        clearLater(SHOW_MS);
        return;
      }
      state.setVoiceMoment({ stage: 'thinking', text });
      try {
        const result = await window.skynet['converse:ask']({ text, source: 'voice' });
        store.getState().setVoiceMoment({ stage: 'did', text, say: result.reply });
        clearLater(Math.max(SHOW_MS, Math.min(9000, result.reply.length * 60)));
      } catch (err) {
        const why = (err as Error).message || 'NO ANSWER';
        store.getState().setVoiceMoment({ stage: 'did', text, say: why });
        store.getState().toast('fault', `NO ANSWER — ${why}`);
        clearLater(SHOW_MS);
      }
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
        await answer(sentence.text);
        return;
      }
      const said = await actOnIntent(intent);
      store.getState().setVoiceMoment({ stage: 'did', text: sentence.text, say: said });
      clearLater(SHOW_MS);
      // JARVIS says the answer as well as showing it (docs/11). Never for a deletion: a refusal is
      // shown, not performed, and a microphone is not an approval. A `faceSend` speaks its own
      // one-line confirmation like any other view action.
      if (intent.kind !== 'confirm' && said && typeof window.skynet['speech:say'] === 'function') {
        void window.skynet['speech:status']()
          .then((status) => (status.enabled ? window.skynet['speech:say']({ text: said }) : undefined))
          .catch(() => undefined);
      }
    };

    const offState = window.skynet.on('voice:state', (status) => {
      store.getState().setVoiceStatus(status);
      if (status.phase === 'thinking') store.getState().setVoiceMoment({ stage: 'thinking' });
      if (status.phase === 'off' || status.phase === 'unavailable') store.getState().setVoiceMoment(null);
    });
    const offWake = window.skynet.on('voice:wake', () => {
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      store.getState().setVoiceMoment({ stage: 'listening' });
    });
    const offHeard = window.skynet.on('voice:heard', (sentence) => {
      void heard(sentence);
    });

    // Esc clears whatever is on screen; nothing is pending that could be cancelled any more.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (store.getState().voiceMoment) { store.getState().setVoiceMoment(null); }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      offState();
      offWake();
      offHeard();
      window.removeEventListener('keydown', onKey);
      if (clearTimer !== null) window.clearTimeout(clearTimer);
    };
  }, []);
}
