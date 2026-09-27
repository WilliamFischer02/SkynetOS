import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, screen } from 'electron';
import {
  conversePrompt,
  converseSystemPrompt,
  fallbackReply,
  pushTurn,
  trimReply,
  type ConverseTurn
} from '@shared/converse.js';
import { getSettings } from './settings.js';
import { which } from './which.js';
import { say } from './speech.js';
import { desktopStatus } from './desktop.js';
import { skynetRoot } from './target-resolver.js';

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

function context(): { desktopEnabled: boolean; monitors: number; apps: number; timeLocal: string } {
  const desktop = desktopStatus();
  return {
    desktopEnabled: desktop.enabled,
    monitors: desktop.monitors.length || screen.getAllDisplays().length,
    apps: desktop.apps,
    timeLocal: localTime()
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

/** One `claude -p` run: the prompt on stdin, the text on stdout, nothing else granted. */
function askModel(prompt: string): Promise<{ text: string | null; reason: 'missing' | 'timeout' | 'error' | null }> {
  const exe = which('claude.exe') ?? which('claude');
  if (!exe) return Promise.resolve({ text: null, reason: 'missing' });
  const s = getSettings().converse;
  const args = [
    '-p',
    '--output-format', 'text',
    '--model', s.model,
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--mcp-config', emptyMcpConfig(),
    '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'NotebookEdit',
    '--append-system-prompt', converseSystemPrompt()
  ];
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (result: { text: string | null; reason: 'missing' | 'timeout' | 'error' | null }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { cwd: skynetRoot(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (spawnErr) {
      console.warn('[converse] could not start claude:', (spawnErr as Error).message);
      finish({ text: null, reason: 'error' });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* going anyway */ }
      finish({ text: null, reason: 'timeout' });
    }, s.timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
    child.on('error', (spawnErr) => { console.warn('[converse] claude failed:', spawnErr.message); finish({ text: null, reason: 'error' }); });
    child.on('close', (code) => {
      if (code !== 0) console.warn(`[converse] claude exited ${code}: ${err.trim().slice(0, 300)}`);
      finish({ text: code === 0 ? out : null, reason: code === 0 ? null : 'error' });
    });
    child.stdin?.end(prompt, 'utf8');
  });
}

/**
 * Answer one sentence: compose (or fall back), remember, speak. Concurrent questions wait for the
 * one in flight, because two answers over each other are worse than one late.
 */
export async function converse(text: string, source: 'voice' | 'typed'): Promise<{ reply: string; source: 'model' | 'fallback'; ms: number }> {
  const clean = (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
  if (!clean) return { reply: 'I heard nothing I could answer.', source: 'fallback', ms: 0 };
  if (inFlight) await inFlight.catch(() => undefined);
  inFlight = (async () => {
    const started = Date.now();
    const s = getSettings().converse;
    let reply: string;
    let from: 'model' | 'fallback' = 'fallback';
    if (!s.enabled) {
      reply = fallbackReply(clean, 'off');
    } else {
      const prompt = conversePrompt(history, context(), clean, s.maxTurns);
      const answer = await askModel(prompt);
      const trimmed = trimReply(answer.text);
      if (trimmed) { reply = trimmed; from = 'model'; }
      else reply = fallbackReply(clean, answer.reason ?? 'error');
    }
    remember('william', `${clean}${source === 'typed' ? ' (typed)' : ''}`);
    remember('jarvis', reply);
    const ms = Date.now() - started;
    console.log(`[converse] ${from} in ${ms} ms: ${reply}`);
    void say({ text: reply, interrupt: false }).catch((err: unknown) => console.warn('[converse] could not speak:', (err as Error).message));
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
