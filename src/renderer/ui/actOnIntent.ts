import type { Intent, IntentContext } from '@shared/intent.js';
import { resolveIntent } from '@shared/intent.js';
import type { Actor } from '@shared/commands.js';
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
    actor
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
        case 'matrix':
          store.setMatrixOpen(action.open);
          break;
      }
      return intent.say;
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
