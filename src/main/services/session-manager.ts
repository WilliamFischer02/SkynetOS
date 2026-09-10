import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeArgs, elevatedCommand, popoutCommand } from './launch-args.js';
import { app, BrowserWindow, dialog } from 'electron';
import type { BoardNode, LaunchMode } from '@shared/types.js';
import type { SessionInfo, SessionStartResult } from '@shared/ipc.js';
import {
  endSession,
  insertSession,
  isProcessAlive,
  lastClaudeSessionId,
  liveSessions,
  recordEvent,
  setSessionPid
} from './db.js';
import { resolveNodeTarget } from './target-resolver.js';
import { getSettings } from './settings.js';

/**
 * Launching real Claude Code sessions, and tracking the ones that are alive.
 *
 * The whole project stands or falls on this: clicking a chip has to open a terminal in the right
 * repo, on *that node's own conversation*, not a fresh one.
 *
 * How the command line is built lives in ./launch-args.ts — that part is pure policy and is
 * tested on its own. This module owns the side effects: confirmation dialogs, spawning, the
 * database rows, and reconciling what the OS is actually running against what we think it is.
 *
 * The conversation id is written to `sessions` BEFORE the process starts, so even a crash during
 * launch leaves it recorded and the next click resumes rather than orphaning the conversation.
 */

interface Tracked {
  info: SessionInfo;
  child?: ChildProcess;
}

const tracked = new Map<string, Tracked>();

export type SessionListener = (sessions: SessionInfo[]) => void;
const listeners = new Set<SessionListener>();

export function onSessionsChanged(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  const list = listSessions();
  for (const listener of listeners) listener(list);
}

/**
 * Stage a node's initial prompt on disk so that it never touches a command line.
 *
 * A prompt is prose a human typed into the node editor. It contains apostrophes, dashes and
 * semicolons today and will contain newlines tomorrow, and every one of those is a metacharacter
 * to somebody in the chain wt.exe -> pwsh -> claude. Writing it to a file and reading it back
 * with `Get-Content -Raw` deletes the whole class of problem rather than escaping it one
 * character at a time. The semicolon story is in launch-args.ts.
 *
 * One file per node, overwritten each launch: nothing accumulates, and after a launch that went
 * wrong the exact text that was sent is sitting on disk to be read.
 */
function stagePrompt(boardId: string, nodeId: string, prompt: string): string {
  const dir = join(app.getPath('userData'), 'prompts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${boardId}.${nodeId}.txt`.replace(/[^a-zA-Z0-9._-]/g, '_'));
  writeFileSync(file, prompt, 'utf8');
  return file;
}

function hasWindowsTerminal(): boolean {
  const local = process.env['LOCALAPPDATA'];
  return Boolean(local && existsSync(`${local}\\Microsoft\\WindowsApps\\wt.exe`));
}

export function listSessions(): SessionInfo[] {
  return [...tracked.values()]
    .map((t) => t.info)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function sessionForNode(boardId: string, nodeId: string): SessionInfo | undefined {
  return [...tracked.values()]
    .map((t) => t.info)
    .find((s) => s.boardId === boardId && s.nodeId === nodeId && s.state === 'running');
}

/**
 * Start (or focus) a session for an `agent.code` node.
 *
 * docs/03: "If a session already exists, focus it instead of spawning a second one." Two Claude
 * Code processes in the same repo on the same conversation is a genuinely bad outcome — they
 * would fight over the same session file — so this refuses rather than racing.
 */
export async function startSession(
  boardId: string,
  node: BoardNode,
  options: { fresh?: boolean } = {}
): Promise<SessionStartResult> {
  if (node.kind !== 'agent.code') {
    return { ok: false, error: `${node.kind} IS NOT A CLAUDE CODE AGENT` };
  }

  /*
   * `fresh` is the difference between the chip's two buttons, and it used to be a lie.
   *
   * The old flag was `force`, which only skipped the already-running guard — it still handed the
   * stored conversation id to `--resume`, so the button labelled "New session (fresh context)"
   * reopened the SAME conversation with the same history. Now it means what it says: a new
   * conversation id, the node's initial prompt sent again, and a second process allowed, because
   * a DIFFERENT conversation in the same repo is not the collision docs/03 refuses.
   */
  const existing = sessionForNode(boardId, node.id);
  if (existing && !options.fresh) {
    return { ok: true, session: existing, focused: true, note: 'A SESSION IS ALREADY RUNNING FOR THIS CHIP' };
  }

  const target = resolveNodeTarget(node);
  if (target.state !== 'ok' && target.state !== 'outside-dev-root') {
    return { ok: false, error: target.detail ?? 'WORKING DIRECTORY DID NOT RESOLVE' };
  }
  const cwd = target.resolved;
  if (!cwd) return { ok: false, error: 'WORKING DIRECTORY DID NOT RESOLVE' };

  const mode: LaunchMode = node.launch ?? 'popout';

  if (mode === 'embedded') {
    // Being honest beats pretending: node-pty has no working build on this machine and nothing
    // imports it yet. The chip should say so rather than silently opening a popout instead.
    return { ok: false, error: 'EMBEDDED TERMINAL NOT BUILT YET — SET LAUNCH TO POPOUT' };
  }

  // docs/07: outside a dev root means confirm on EVERY activation. A session is the most
  // consequential thing a click can do, so this is not cached.
  if (target.state === 'outside-dev-root') {
    const approved = await confirm(
      'Launch a session outside your dev roots?',
      `${node.designator ? node.designator + ' — ' : ''}${node.name}`,
      `${cwd}\n\nNot under any configured dev root (${getSettings().devRoots.join(', ')}) or your user profile.`
    );
    if (!approved) return { ok: false, error: 'CANCELLED' };
  }

  if (mode === 'popout-elevated') {
    // docs/07: elevation is opt-in per node, and SkynetOS itself never runs elevated — it asks
    // Windows to launch an elevated child, which is a UAC prompt every single time.
    const approved = await confirm(
      'Launch this session ELEVATED?',
      `${node.designator ? node.designator + ' — ' : ''}${node.name}`,
      `${cwd}\n\nWindows will show a UAC prompt. An elevated agent can change anything on this machine.\nSkynetOS itself stays non-elevated.`
    );
    if (!approved) return { ok: false, error: 'CANCELLED' };
  }

  const claudeSessionId = options.fresh ? null : lastClaudeSessionId(boardId, node.id);
  const { args, sessionId, resumed, initialPrompt } = claudeArgs(node, claudeSessionId);
  const promptFile = initialPrompt ? stagePrompt(boardId, node.id, initialPrompt) : undefined;

  const rowId = randomUUID();
  const startedAt = new Date().toISOString();

  // Recorded BEFORE spawning. If the launch crashes the machine, the conversation id is still on
  // disk and the next click resumes rather than orphaning the conversation.
  insertSession({
    id: rowId,
    node_id: node.id,
    board_id: boardId,
    kind: mode,
    cwd,
    claude_session_id: sessionId,
    pid: null,
    started_at: startedAt
  });

  try {
    const child = mode === 'popout-elevated'
      ? spawnElevated(cwd, args, promptFile)
      : spawnPopout(cwd, args, promptFile);

    setSessionPid(rowId, child.pid ?? null);

    const info: SessionInfo = {
      id: rowId,
      boardId,
      nodeId: node.id,
      nodeName: node.name,
      designator: node.designator ?? null,
      mode,
      cwd,
      claudeSessionId: sessionId,
      pid: child.pid ?? null,
      startedAt,
      state: 'running',
      resumed
    };
    tracked.set(rowId, { info, child });

    child.on('exit', (code) => {
      const entry = tracked.get(rowId);
      if (entry) {
        entry.info.state = 'exited';
        entry.info.exitCode = code ?? null;
        // Keep it in the dock briefly so a session that dies instantly is visible rather than
        // vanishing before anyone can read why.
        setTimeout(() => { tracked.delete(rowId); notify(); }, 30_000);
      }
      endSession(rowId, code ?? null);
      recordEvent(boardId, node.id, 'session.exit', 1, { exitCode: code });
      notify();
    });

    child.on('error', (err) => {
      const entry = tracked.get(rowId);
      if (entry) { entry.info.state = 'error'; entry.info.error = err.message; }
      endSession(rowId, null, err.message);
      notify();
    });

    child.unref();
    recordEvent(boardId, node.id, 'session.start', 2, { mode, resumed });
    notify();

    return {
      ok: true,
      session: info,
      focused: false,
      note: resumed
        ? `RESUMED CONVERSATION ${sessionId.slice(0, 8)}`
        : `NEW CONVERSATION ${sessionId.slice(0, 8)}`
    };
  } catch (err) {
    endSession(rowId, null, (err as Error).message);
    return { ok: false, error: `LAUNCH FAILED — ${(err as Error).message}` };
  }
}

function spawnPopout(cwd: string, claudeArgv: string[], promptFile?: string): ChildProcess {
  const { file, args } = popoutCommand(cwd.replace(/\//g, '\\'), claudeArgv, hasWindowsTerminal(), promptFile);
  return spawn(file, args, {
    cwd: cwd.replace(/\//g, '\\'),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
}

function spawnElevated(cwd: string, claudeArgv: string[], promptFile?: string): ChildProcess {
  const windowsCwd = cwd.replace(/\//g, '\\');
  const { file, args } = elevatedCommand(windowsCwd, claudeArgv, promptFile);
  return spawn(file, args, { cwd: windowsCwd, detached: true, stdio: 'ignore', windowsHide: true });
}

/**
 * Stop a session.
 *
 * A popout owns its own terminal window, and killing the launcher process does not close the
 * window the user is looking at — so this reports what it actually did rather than claiming the
 * session is gone. `taskkill /T` takes the tree with it, which is what "Kill" has to mean.
 */
export function stopSession(sessionId: string): { ok: boolean; error?: string } {
  const entry = tracked.get(sessionId);
  if (!entry) return { ok: false, error: 'NO SUCH SESSION' };

  const pid = entry.info.pid;
  if (pid === null) {
    entry.info.state = 'exited';
    endSession(sessionId, null, 'no pid');
    notify();
    return { ok: true };
  }

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    entry.info.state = 'exited';
    endSession(sessionId, null, 'stopped by user');
    recordEvent(entry.info.boardId, entry.info.nodeId, 'session.stop', 1);
    notify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Drop sessions whose process has gone without us noticing. The `exit` event covers processes we
 * spawned, but a detached popout can be closed in ways that do not reach us.
 */
export function sweepSessions(): void {
  let changed = false;
  for (const [id, entry] of tracked) {
    if (entry.info.state !== 'running' || entry.info.pid === null) continue;
    if (!isProcessAlive(entry.info.pid)) {
      entry.info.state = 'exited';
      endSession(id, null, 'process gone');
      changed = true;
    }
  }
  if (changed) notify();
}

/** Re-adopt sessions the database says are live and whose processes really are. */
export function restoreSessions(): number {
  let restored = 0;
  for (const row of liveSessions()) {
    if (row.pid === null || !isProcessAlive(row.pid)) continue;
    tracked.set(row.id, {
      info: {
        id: row.id,
        boardId: row.board_id,
        nodeId: row.node_id,
        nodeName: row.node_id,
        designator: null,
        mode: row.kind as LaunchMode,
        cwd: row.cwd,
        claudeSessionId: row.claude_session_id,
        pid: row.pid,
        startedAt: row.started_at,
        state: 'running',
        resumed: true
      }
    });
    restored++;
  }
  if (restored) console.log(`[sessions] re-adopted ${restored} still-running session(s)`);
  return restored;
}

async function confirm(title: string, message: string, detail: string): Promise<boolean> {
  const win = BrowserWindow.getAllWindows()[0];
  const options = {
    type: 'warning' as const,
    buttons: ['Launch', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title,
    message,
    detail,
    noLink: true
  };
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return response === 0;
}
