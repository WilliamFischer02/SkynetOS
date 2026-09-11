import type { BoardNode } from '@shared/types.js';
import type { MailboxMessage } from '@shared/mailbox.js';
import { loadBoard } from './board-store.js';
import { archiveMail, listMail } from './mailbox.js';
import { startSession } from './session-manager.js';
import { getSettings } from './settings.js';

/**
 * Head → Prime: a message that starts the work instead of waiting to be read.
 *
 * ── What this is for ─────────────────────────────────────────────────────────────────────────
 *
 * William: "Jarvis (head) should be able to write to Jarvis Prime and trigger it to do things as
 * if I'm speaking to it. If I tell Jarvis Head I want xyz, I want it to communicate that to jarvis
 * prime somehow and jarvis can autonimously start the task."
 *
 * The mailbox already carried the words across. What it could not do was make anything happen: a
 * message sat in `to-hands/` until someone clicked the chip, which means the Face could ask but
 * never act. This is the missing half — a message carrying `run:` opens a real session on the
 * Hands node with its body as the task.
 *
 * ── The line this does not cross ─────────────────────────────────────────────────────────────
 *
 * Autonomy was asked for and is what this delivers. It is still bounded, and every bound below is
 * from docs/07-SECURITY.md rather than invented here:
 *
 *   - Opt in per message. A bare note is still a note. If every message launched a process the
 *     Face could not say anything without doing something, and the mailbox would be unusable for
 *     the conversation it exists to carry.
 *   - Never elevated. A node set to `popout-elevated` is REFUSED rather than quietly downgraded —
 *     elevation is a decision William made about that node, and answering a UAC prompt he did not
 *     ask for is not something an agent gets to arrange. docs/07: SkynetOS never runs elevated,
 *     and elevation is opt-in per node by a human.
 *   - Rate limited. docs/07 rate-limits agent-to-session messages at three an hour; the same
 *     number applies here, because this is the same act with a launch attached. A loop in the Face
 *     cannot turn into a hundred terminals.
 *   - Only nodes the board already declares, with the working directory the board already gives
 *     them. There is no path in this file that names a directory — the node does.
 *   - Archived before launching, so a message can never fire twice. See the note below on why
 *     that order matters.
 */

/** docs/07 §Agent authority: "Send a message to a running session — rate-limited, 3/hour". */
const MAX_RUNS_PER_HOUR = 3;

/** When each dispatched run happened, epoch ms. Trimmed to the last hour on every check. */
const recentRuns: number[] = [];

export interface DispatchResult {
  file: string;
  subject: string;
  ok: boolean;
  nodeId?: string;
  error?: string;
}

/**
 * Which node the Hands are, on a board.
 *
 * Prefers what the message asked for. Falling back on a search rather than a hard-coded id is
 * deliberate: William renamed this node from "JARVIS Hands" to "JARVIS Prime" mid-project, and an
 * id written into a source file would have survived that rename only by luck. The board is the
 * source of truth about what is on the board.
 */
export function findHandsNode(boardId: string, wanted: string): BoardNode | null {
  const load = loadBoard(boardId);
  if (!load.ok) return null;

  if (wanted) return load.board.nodes.find((n) => n.id === wanted) ?? null;

  const agents = load.board.nodes.filter((n) => n.kind === 'agent.code');
  return (
    agents.find((n) => n.tags?.includes('hands')) ??
    agents.find((n) => /jarvis/i.test(n.name)) ??
    null
  );
}

/** How a message reads to the session that receives it. */
export function taskFromMessage(message: MailboxMessage): string {
  return [
    `This task came from JARVIS Head by way of the SkynetOS mailbox (${message.file}).`,
    `It is what William asked the Face for, relayed to you because you are the half with hands.`,
    '',
    message.subject ? `**${message.subject}**` : '',
    '',
    message.body,
    '',
    'When you are done, reply into codex/mailbox/to-face/ so the Face knows what happened.'
  ].filter((line, i) => line !== '' || i > 0).join('\n');
}

/**
 * Look for flagged post and act on it. Called on a timer and after any mailbox write.
 *
 * Returns what it did, so the caller can log it and the UI can show it. An autonomous launch that
 * leaves no trace is the one thing worse than no autonomous launch.
 */
export async function dispatchMail(boardId = 'root'): Promise<DispatchResult[]> {
  if (getSettings().autoRunMail === false) return [];

  const flagged = listMail('hands').filter((m) => m.run !== null);
  if (!flagged.length) return [];

  const results: DispatchResult[] = [];
  const hourAgo = Date.now() - 3_600_000;
  while (recentRuns.length && (recentRuns[0] ?? 0) < hourAgo) recentRuns.shift();

  for (const message of flagged) {
    if (recentRuns.length >= MAX_RUNS_PER_HOUR) {
      /*
       * Left in the inbox, NOT archived. A message refused for rate limiting has not been dealt
       * with — it is still the Face asking for something — so it stays where it is, gets folded
       * into the next briefing like any other post, and is reconsidered on the next sweep.
       */
      results.push({
        file: message.file,
        subject: message.subject,
        ok: false,
        error: `RATE LIMITED — ${MAX_RUNS_PER_HOUR} autonomous runs per hour. Left in the inbox.`
      });
      continue;
    }

    const node = findHandsNode(boardId, message.run ?? '');
    if (!node) {
      results.push({
        file: message.file,
        subject: message.subject,
        ok: false,
        error: message.run
          ? `NO SUCH NODE — "${message.run}" on board "${boardId}"`
          : `NO AGENT NODE ON BOARD "${boardId}" TO RUN THIS ON`
      });
      continue;
    }

    if (node.launch === 'popout-elevated') {
      // Refused, not downgraded. See the header.
      results.push({
        file: message.file,
        subject: message.subject,
        ok: false,
        nodeId: node.id,
        error: `${node.name} LAUNCHES ELEVATED — an agent may not trigger a UAC prompt. Start it yourself.`
      });
      continue;
    }

    /*
     * Archive BEFORE launching.
     *
     * If the launch is what marks a message handled, then a launch that throws — or a crash
     * between the two — leaves the message flagged, and the next sweep runs it again. A task
     * repeated because the app restarted is a genuinely bad outcome: the work may be half done,
     * and "fix the mod" twice is not the same as "fix the mod". So the message is consumed first
     * and the outcome is reported separately. A dispatch that fails is visible in the log and the
     * archive, which is recoverable; a dispatch that repeats is not.
     */
    const archived = archiveMail('hands', message.file);
    if (!archived.ok) {
      results.push({ file: message.file, subject: message.subject, ok: false, error: archived.error ?? 'COULD NOT ARCHIVE' });
      continue;
    }

    recentRuns.push(Date.now());
    try {
      const started = await startSession(boardId, node, { prompt: taskFromMessage(message) });
      results.push({
        file: message.file,
        subject: message.subject,
        nodeId: node.id,
        ok: started.ok,
        ...(started.ok ? {} : { error: started.error ?? 'LAUNCH FAILED' })
      });
    } catch (err) {
      results.push({ file: message.file, subject: message.subject, nodeId: node.id, ok: false, error: (err as Error).message });
    }
  }

  return results;
}

/** Reset the rate-limit window. Tests only. */
export function clearDispatchHistory(): void {
  recentRuns.length = 0;
}
