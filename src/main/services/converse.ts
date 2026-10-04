import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, screen } from 'electron';
import {
  conversePrompt,
  converseSystemPrompt,
  fallbackReply,
  pushTurn,
  trimReply,
  type ConverseContext,
  type ConverseTurn
} from '@shared/converse.js';
import { boardBlock, type BoardContextSession } from '@shared/board-context.js';
import { boardContext } from './board-context.js';
import { listSessions } from './session-manager.js';
import { getSettings } from './settings.js';
import { askClaude } from './headless-claude.js';
import { markTurn } from './turn-timing.js';
import { say } from './speech.js';
import { desktopStatus } from './desktop.js';
import { currentTurnId, dispatch as turnDispatch, finishTurn, turnState } from './turn.js';

/**
 * JARVIS answers back (docs/11-JARVIS-VOICE.md § Conversation; rules in docs/07 § JARVIS Voice).
 *
 * A sentence the grammar does not understand is answered by a headless `claude -p` with the JARVIS
 * register appended as its system prompt, no tools and no MCP servers, and then SPOKEN from here.
 * That call to `say` is main answering William's own sentence, which he began with the wake word or
 * typed himself; it is not an agent putting words in JARVIS's mouth. The model can compose a reply.
 * It cannot start speech on its own, open the Face, or act: the only channel is `converse:ask`,
 * user-only, and the only thing the process is given is the prompt on stdin.
 *
 * The exchange is appended to `userData/conversation.jsonl`, never to the repo.
 */

const MAX_TEXT_CHARS = 600;

let history: ConverseTurn[] = [];
let inFlight: Promise<{ reply: string; source: 'model' | 'fallback'; ms: number }> | null = null;

function logFile(): string {
  return join(app.getPath('userData'), 'conversation.jsonl');
}

/** An MCP config that loads nothing: with `--strict-mcp-config` it is the whole server set. */
function emptyMcpConfig(): string {
  const dir = app.getPath('userData');
  const file = join(dir, 'converse-mcp.json');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: {} }, null, 2) + '\n', 'utf8');
  }
  return file;
}

function localTime(now = new Date()): string {
  return now.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function context(turnPhase: string): ConverseContext {
  const desktop = desktopStatus();
  const board = boardContext();
  let sessions: BoardContextSession[] = [];
  try { sessions = listSessions().map((s) => ({ designator: s.designator, name: s.nodeName, state: s.state })); } catch { sessions = []; }
  return {
    desktopEnabled: desktop.enabled,
    monitors: desktop.monitors.length || screen.getAllDisplays().length,
    apps: desktop.apps,
    timeLocal: localTime(),
    ...(board ? { boardName: board.roomName } : {}),
    // What the board window last reported, read-only (services/board-context.ts, docs/11).
    board: boardBlock(board, sessions, turnPhase)
  };
}

function remember(who: ConverseTurn['who'], text: string): void {
  const turn: ConverseTurn = { at: new Date().toISOString(), who, text };
  history = pushTurn(history, turn, getSettings().converse.maxTurns);
  try {
    appendFileSync(logFile(), JSON.stringify(turn) + '\n', 'utf8');
  } catch (err) {
    console.warn('[converse] could not append the log:', (err as Error).message);
  }
}

/** One `claude -p` run: the prompt on stdin, the text on stdout, nothing else granted (headless-claude.ts). */
function askModel(prompt: string): Promise<{ text: string | null; reason: 'missing' | 'timeout' | 'error' | null }> {
  const s = getSettings().converse;
  return askClaude(prompt, { model: s.model, system: converseSystemPrompt(), mcpConfig: emptyMcpConfig(), timeoutMs: s.timeoutMs, tag: 'converse' });
}

/**
 * Answer one sentence: compose (or fall back), remember, speak. Concurrent questions wait for the
 * one in flight, because two answers over each other are worse than one late.
 */
export async function converse(text: string, source: 'voice' | 'typed'): Promise<{ reply: string; source: 'model' | 'fallback'; ms: number }> {
  const clean = (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
  if (!clean) return { reply: 'I heard nothing I could answer.', source: 'fallback', ms: 0 };
  if (inFlight) await inFlight.catch(() => undefined);
  // One turn at a time (services/turn.ts): THINKING · ASKING CLAUDE until the reply is composed;
  // then SPEAKING; the turn is DONE only once the reply has been said, and only then may the
  // follow-up window open.
  // What JARVIS was doing when the sentence arrived, for the BOARD block (before THINKING replaces it).
  const phaseBefore = turnState().phase;
  markTurn('intent', { path: 'converse' });
  turnDispatch({ type: 'thinking', detail: getSettings().converse.enabled ? 'ASKING CLAUDE' : 'COMPOSING A REPLY' });
  const turnId = currentTurnId();
  inFlight = (async () => {
    const started = Date.now();
    const s = getSettings().converse;
    let reply: string;
    let from: 'model' | 'fallback' = 'fallback';
    if (!s.enabled) {
      reply = fallbackReply(clean, 'off');
    } else {
      const prompt = conversePrompt(history, context(`answering William (the turn was ${phaseBefore})`), clean, s.maxTurns);
      markTurn('modelAsked');
      const answer = await askModel(prompt);
      markTurn('modelAnswered');
      const trimmed = trimReply(answer.text);
      if (trimmed) { reply = trimmed; from = 'model'; }
      else reply = fallbackReply(clean, answer.reason ?? 'error');
    }
    remember('william', `${clean}${source === 'typed' ? ' (typed)' : ''}`);
    remember('jarvis', reply);
    const ms = Date.now() - started;
    console.log(`[converse] ${from} in ${ms} ms: ${reply}`);
    void (async () => {
      await say({ text: reply, interrupt: false }).catch((err: unknown) => console.warn('[converse] could not speak:', (err as Error).message));
      await finishTurn(turnId, reply);
    })();
    return { reply, source: from, ms };
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/** For a later inspector: what has been said this run, newest last. */
export function conversationHistory(): readonly ConverseTurn[] {
  return history;
}

export function clearConversation(): void {
  history = [];
}
