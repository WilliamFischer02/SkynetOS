import type { SessionStartResult } from '@shared/ipc.js';
import { pickHandsNode } from '@shared/face-brief.js';
import { summonPrompt } from '@shared/summon.js';
import { loadBoard } from './board-store.js';
import { resolveNodeTarget } from './target-resolver.js';
import { startSession } from './session-manager.js';

/** The board the Hands live on. JARVIS Prime is a root-board chip, whichever room you are in. */
const HANDS_BOARD = 'root';

/**
 * "Summon JARVIS" on a node: open a fresh JARVIS Prime session whose task is that node.
 *
 * Fresh rather than resumed. A resumed Prime is in the middle of whatever it was last doing, and
 * the running-session guard would refuse the task outright ("THE TASK WAS NOT DELIVERED"). A
 * summons is its own conversation with its own target. User-only: it is not in AGENT_METHODS, so
 * an agent cannot open terminals on William's desktop by summoning itself.
 */
export async function summonJarvis(boardId: string, nodeId: string, directive: string): Promise<SessionStartResult> {
  const load = loadBoard(boardId);
  if (!load.ok) return { ok: false, error: load.error };
  const node = load.board.nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, error: `NO SUCH NODE — "${nodeId}"` };

  const home = boardId === HANDS_BOARD ? load : loadBoard(HANDS_BOARD);
  if (!home.ok) return { ok: false, error: home.error };
  const hands = pickHandsNode(home.board.nodes);
  if (!hands) return { ok: false, error: 'NO JARVIS PRIME CHIP ON THE ROOT BOARD — TAG ONE "hands"' };

  const target = resolveNodeTarget(node);
  const names = new Map(load.board.nodes.map((n) => [n.id, n.name]));
  const neighbours = load.board.edges
    .filter((e) => e.from === node.id || e.to === node.id)
    .map((e) => names.get(e.from === node.id ? e.to : e.from))
    .filter((name): name is string => Boolean(name));

  const prompt = summonPrompt(
    {
      node,
      boardId,
      boardName: load.board.name,
      resolved: target.resolved,
      state: target.state,
      neighbours: [...new Set(neighbours)]
    },
    directive
  );

  return startSession(HANDS_BOARD, hands, { fresh: true, prompt });
}
