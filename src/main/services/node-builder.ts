import { PROMPT_LIMITS, PROMPT_TO_NODE_KIND, type PromptSendRequest, type PromptSendResult } from '@shared/prompt.js';
import { pickHandsNode } from '@shared/face-brief.js';
import { buildNodePrompt } from '@shared/node-build.js';
import { loadBoard } from './board-store.js';
import { startSession } from './session-manager.js';
import { describePromptFiles } from './prompt-send.js';

/** The board the Hands live on. JARVIS Prime is a root-board chip, whichever room the box is in. */
const HANDS_BOARD = 'root';

/**
 * A PROMPT → NODE box's send: brief a FRESH JARVIS Prime session to build the node William described.
 *
 * Fresh, like a summons, for the same reason: a resumed Prime is mid-way through something else,
 * and the running-session guard would refuse the task outright. Attachments go as PATHS in the brief,
 * because Claude Code reads files itself. Only claude.ai needs the bytes, so the quick-chat box's
 * byte caps do not apply here, only the count cap and "the file is really there".
 */
export async function buildNodeFromPrompt(request: PromptSendRequest): Promise<PromptSendResult> {
  const text = String(request?.text ?? '').slice(0, PROMPT_LIMITS.maxTextChars);
  const paths = Array.isArray(request?.files) ? request.files.filter((p): p is string => typeof p === 'string') : [];
  const fail = (message: string): PromptSendResult => ({ ok: false, stage: 'failed', attached: 0, message });

  if (!text.trim()) return fail('SAY WHAT NODE TO BUILD — THE BOX IS EMPTY');

  const load = loadBoard(request.boardId);
  if (!load.ok) return fail(load.error);
  const box = load.board.nodes.find((n) => n.id === request.nodeId);
  if (!box || box.kind !== PROMPT_TO_NODE_KIND) return fail('THAT IS NOT A PROMPT → NODE BOX');

  if (paths.length > PROMPT_LIMITS.maxFiles) return fail(`AT MOST ${PROMPT_LIMITS.maxFiles} FILES`);
  const described = describePromptFiles(paths);
  const missing = described.find((f) => f.error);
  if (missing) return fail(`CANNOT ATTACH ${missing.name}: ${missing.error}`);

  const home = request.boardId === HANDS_BOARD ? load : loadBoard(HANDS_BOARD);
  if (!home.ok) return fail(home.error);
  const hands = pickHandsNode(home.board.nodes);
  if (!hands) return fail('NO JARVIS PRIME CHIP ON THE ROOT BOARD — TAG ONE "hands"');

  const prompt = buildNodePrompt({
    boardId: request.boardId,
    boardName: load.board.name,
    box,
    text,
    files: described.map((f) => f.path)
  });

  const result = await startSession(HANDS_BOARD, hands, { fresh: true, prompt });
  if (!result.ok) return fail(result.error);
  const withFiles = described.length ? ` WITH ${described.length} FILE${described.length === 1 ? '' : 'S'}` : '';
  return {
    ok: true,
    stage: 'sent',
    attached: described.length,
    message: `JARVIS PRIME IS BUILDING IT${withFiles} — A FRESH TERMINAL IS OPEN`
  };
}
