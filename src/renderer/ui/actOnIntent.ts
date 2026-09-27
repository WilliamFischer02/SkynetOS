import type { Intent, IntentContext } from '@shared/intent.js';
import { resolveIntent } from '@shared/intent.js';
import type { Actor } from '@shared/commands.js';
import { replyFor } from '@shared/desktop.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * Words to action, for every producer that speaks them.
 *
 * The Face's brief: "One intent bus, several producers: voice, gesture, the panel, you." This is
 * the consumer end in the renderer — the single place that turns a resolved intent into something
 * happening, so a gesture and a spoken sentence that mean the same thing do the same thing, by
 * construction rather than by two implementations agreeing.
 *
 * A trained gesture carries WORDS (packages/shared/gesture-library.ts), which is what makes this
 * possible: "THUMBS UP" does not map to a handler, it maps to "undo", and undo is resolved here
 * exactly as it would be if it had been said out loud.
 */

/** Everything the grammar needs to know about the board right now. */
export function intentContext(actor: Actor): IntentContext | null {
  const state = useBoardStore.getState();
  if (!state.board) return null;
  return {
    boardId: state.boardId,
    nodes: state.board.nodes,
    edges: state.board.edges,
    selectedId: state.selectedId,
    actor,
    apps: state.desktopApps,
    monitors: state.desktopMonitors
  };
}

/**
 * Do what the intent says, and report what happened in one line.
 *
 * Returns the sentence to show the user — every path says something, because a gesture or a spoken
 * command that silently does nothing is indistinguishable from one that was not recognised.
 */
export async function actOnIntent(intent: Intent): Promise<string> {
  const store = useBoardStore.getState();

  switch (intent.kind) {
    case 'command': {
      // Attributed to whoever produced it: the history says which hand moved a node.
      store.setInputSource(intent.request.actor === 'gesture' ? 'gesture' : 'user');
      const result = await store.runCommand(intent.request.command, intent.request.label);
      store.setInputSource('user');
      return result.ok ? intent.say : result.error;
    }

    case 'confirm': {
      /*
       * Deletion. docs/07: a human confirms it in the same exchange, and neither a microphone nor a
       * camera is one. The request carries no approval, so it is not sent — the user is told to do
       * it by hand instead, which is the whole point of the refusal.
       */
      store.toast('warn', intent.say);
      return intent.say;
    }

    case 'view': {
      const action = intent.action;
      switch (action.type) {
        case 'select': store.select(action.nodeId); break;
        case 'clearSelection': store.select(null); break;
        case 'open': await store.openNode(action.nodeId); break;
        case 'descend': await store.descend(action.nodeId); break;
        case 'ascend': await store.ascend(); break;
        case 'undo': await store.undo(); break;
        case 'redo': await store.redo(); break;
        case 'zoom': {
          // Zoom lives in the canvas's key handling, so the same key is pressed.
          const code = action.to === 'out' ? 'Minus' : 'Equal';
          if (typeof action.to === 'number') {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: String(action.to), code: `Digit${action.to}`, bubbles: true }));
          } else {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: action.to === 'out' ? '-' : '+', code, bubbles: true }));
          }
          break;
        }
        case 'gestureControl':
          await store.setGestureEnabled(action.on);
          break;
        case 'voiceControl':
          await store.setVoiceEnabled(action.on);
          break;
        case 'faceSend': {
          // The only path from a sentence to claude.ai, and only because William named the Face.
          store.setVoiceMoment({ stage: 'sending', text: action.text });
          try {
            const result = await window.skynet['prompt:send']({ boardId: 'root', text: action.text, files: [] });
            store.toast(result.stage === 'failed' ? 'fault' : result.ok ? 'ok' : 'warn', result.message);
            return result.ok ? intent.say : result.message;
          } catch (err) {
            const why = `NOT SENT — ${(err as Error).message}`;
            store.toast('fault', why);
            return why;
          }
        }
        case 'matrix':
          store.setMatrixOpen(action.open);
          break;
        case 'stop': {
          // "Jarvis, stop": what Esc does in the hologram window. Speech, the desktop, the caption.
          store.setVoiceMoment(null);
          if (typeof window.skynet['speech:stop'] === 'function') void window.skynet['speech:stop']().catch(() => undefined);
          if (typeof window.skynet['desktop:halt'] === 'function') void window.skynet['desktop:halt']().catch(() => undefined);
          break;
        }
      }
      return intent.say;
    }

    case 'hologram': {
      /*
       * A control in the JARVIS Voice window, by voice. Main opens the window if it must and hands
       * the control to it; the renderer there presses the element with that data-control id, so a
       * spoken "go to the train panel" and a click on TRAIN are the same event.
       */
      if (typeof window.skynet['hologram:control'] !== 'function') return 'RESTART SKYNETOS TO DRIVE THE JARVIS WINDOW BY VOICE — THE RUNNING COPY PREDATES IT';
      try {
        const result = await window.skynet['hologram:control'](intent.control);
        if (!result.ok) {
          const why = result.error ?? 'THE JARVIS WINDOW DID NOT ANSWER';
          store.toast('warn', why);
          return why;
        }
        return intent.say;
      } catch (err) {
        const why = (err as Error).message || 'THE JARVIS WINDOW DID NOT ANSWER';
        store.toast('fault', why);
        return why;
      }
    }

    case 'action': {
      // A saved desktop action by name. Main says which one it found before it moves anything,
      // and refuses in the desktop's own words when desktop control is off.
      if (typeof window.skynet['hologram:runAction'] !== 'function') return 'RESTART SKYNETOS TO RUN SAVED ACTIONS — THE RUNNING COPY PREDATES IT';
      try {
        const result = await window.skynet['hologram:runAction'](intent.name);
        if (!result.ok) {
          const why = result.error ?? 'THAT ACTION DID NOT RUN';
          store.toast('warn', why);
          return why;
        }
        return `${result.name ?? intent.name} done.`;
      } catch (err) {
        const why = (err as Error).message || 'THAT ACTION DID NOT RUN';
        store.toast('fault', why);
        return why;
      }
    }

    case 'desktop': {
      /*
       * The desktop, through the user-only `desktop:run`. Main refuses unless desktop control is
       * switched on, and the refusal is a sentence, so it is shown and spoken like any result.
       */
      if (typeof window.skynet['desktop:run'] !== 'function') return 'RESTART SKYNETOS TO CONTROL THE DESKTOP — THE RUNNING COPY PREDATES IT';
      try {
        const result = await window.skynet['desktop:run'](intent.plan);
        const reply = replyFor(intent.plan, result);
        if (!result.ok) store.toast('warn', reply);
        return reply;
      } catch (err) {
        const reply = (err as Error).message || 'THE DESKTOP DID NOT ANSWER';
        store.toast('fault', reply);
        return reply;
      }
    }

    case 'ambiguous':
      store.toast('warn', intent.say);
      return intent.say;

    case 'unknown':
      store.toast('warn', intent.say);
      return intent.say;
  }
}

/** Resolve and act in one step, for a producer that has words and nothing else. */
export async function sayAndAct(words: string, actor: Actor): Promise<string> {
  const context = intentContext(actor);
  if (!context) return 'THE BOARD IS NOT LOADED YET';
  return actOnIntent(resolveIntent(words, context));
}
