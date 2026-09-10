import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import { briefingModeOf, buildBriefing, claudeArgs } from './launch-args.js';
import { BrowserWindow, dialog } from 'electron';
import type { BoardNode, LaunchMode } from '@shared/types.js';
import type { SessionInfo, SessionStartResult } from '@shared/ipc.js';
import { primeStepsFor } from '@shared/prime-steps.js';
import {
  claudeSessionIdsForNode,
  endSession,
  insertSession,
  isProcessAlive,
  liveSessions,
  recordEvent,
  setSessionPid
} from './db.js';
import { conversationExists } from './conversations.js';
import { openTerminal, readLivePid, stagePrompt } from './terminal.js';
import { resolveNodeTarget } from './target-resolver.js';
import { getSettings, trustedRoots, normaliseRoot } from './settings.js';
import { loadBoard } from './board-store.js';

/**
 * Launching real Claude Code sessions, and tracking the ones that are alive.
 *
 * The whole project stands or falls on this: clicking a chip has to open a terminal in the right
 * repo, on *that node's own conversation*, not a fresh one and not nothing at all.
 *
 * The mechanics live next door and are tested on their own — ./launch-args.ts decides what the
 * command says, ./launch-script.ts writes the script that runs, ./terminal.ts opens the window
 * and proves it opened, ./conversations.ts answers whether a conversation is real. This module
 * is the policy in between: confirmation dialogs, the database rows, and reconciling what the OS
 * is actually running against what we think it is.
 */

interface Tracked {
  info: SessionInfo;
  /** The pid file the staged script maintains. Liveness comes from here, not from a child handle. */
  pidFile?: string;
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

export function listSessions(): SessionInfo[] {
  return [...tracked.values()]
    .map((t) => t.info)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function sessionForNode(boardId: string, nodeId: string): SessionInfo | undefined {
  return [...tracked.values()]
    .map((t) => t.info)
    .find((s) => s.boardId === boardId && s.nodeId === nodeId && (s.state === 'running' || s.state === 'starting'));
}

/** Windows spelling, so everything downstream compares like with like. */
function win(path: string): string {
  return path.replace(/\//g, '\\');
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function underTrustedRoot(path: string): boolean {
  const normalised = normaliseRoot(path.replace(/\\/g, '/'));
  return trustedRoots().some((root) => normalised === root || normalised.startsWith(`${root}/`));
}

/**
 * Resolve the extra directories a chip has been granted, and drop the ones that are not real.
 *
 * A granted directory that does not exist is not an error worth refusing a launch over — the
 * repo may simply not be cloned on this machine yet — but it must not be passed to `--add-dir`
 * either, because Claude Code rejects the whole invocation over one bad path. So it is dropped,
 * and the caller says so. Prime directive 1: show it broken, do not pretend.
 */
export interface ResolvedAddDirs {
  granted: string[];
  missing: string[];
  /** Granted directories that fall outside every dev root — docs/07 wants these confirmed. */
  untrusted: string[];
}

export function resolveAddDirs(node: BoardNode): ResolvedAddDirs {
  const granted: string[] = [];
  const missing: string[] = [];
  const untrusted: string[] = [];
  for (const raw of node.addDirs ?? []) {
    const path = win(raw.trim());
    if (!path) continue;
    if (!isAbsolute(path) || !existsSync(path) || !isDirectory(path)) { missing.push(path); continue; }
    granted.push(path);
    if (!underTrustedRoot(path)) untrusted.push(path);
  }
  return { granted, missing, untrusted };
}

/**
 * What this session reads before it does anything.
 *
 * Derived from what the node already declares, so binding a chip to a persona file is the same
 * act as telling it to read one. Every entry is checked against the disk here rather than in the
 * prompt, so the briefing can state what is missing instead of sending the agent after it.
 */
export function resolveReading(node: BoardNode, cwd: string): { reading: string[]; missing: string[] } {
  const declared = node.readOnLaunch ?? [
    'CLAUDE.md',
    ...(node.persona ? [node.persona] : []),
    ...(node.codexRef ? [node.codexRef] : [])
  ];

  const reading: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const raw of declared) {
    const rel = raw.trim().replace(/\\/g, '/');
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    const abs = isAbsolute(rel) ? win(rel) : join(cwd, win(rel));
    // Never let a board file reach outside its own repo by way of `..` — docs/07 §Path policy.
    if (!resolvePath(abs).toLowerCase().startsWith(resolvePath(cwd).toLowerCase())) { missing.push(rel); continue; }
    if (existsSync(abs)) reading.push(rel);
    else missing.push(rel);
  }
  return { reading, missing };
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

  const existing = sessionForNode(boardId, node.id);
  if (existing && !options.fresh) {
    return { ok: true, session: existing, focused: true, note: 'A SESSION IS ALREADY RUNNING FOR THIS CHIP' };
  }

  const target = resolveNodeTarget(node);
  if (target.state !== 'ok' && target.state !== 'outside-dev-root') {
    return { ok: false, error: target.detail ?? 'WORKING DIRECTORY DID NOT RESOLVE' };
  }
  const cwd = target.resolved ? win(target.resolved) : null;
  if (!cwd) return { ok: false, error: 'WORKING DIRECTORY DID NOT RESOLVE' };

  const mode: LaunchMode = node.launch ?? 'popout';

  if (mode === 'embedded') {
    // Being honest beats pretending: node-pty has no working build on this machine and nothing
    // imports it yet. The chip should say so rather than silently opening a popout instead.
    return { ok: false, error: 'EMBEDDED TERMINAL NOT BUILT YET — SET LAUNCH TO POPOUT' };
  }
  if (mode === 'headless') {
    return { ok: false, error: 'HEADLESS SESSIONS ARRIVE WITH THE SUPERVISION LOOP — SET LAUNCH TO POPOUT' };
  }

  const label = `${node.designator ? node.designator + ' — ' : ''}${node.name}`;

  // docs/07: outside a dev root means confirm on EVERY activation. A session is the most
  // consequential thing a click can do, so this is not cached.
  if (target.state === 'outside-dev-root') {
    const approved = await confirm(
      'Launch a session outside your dev roots?',
      label,
      `${cwd}\n\nNot under any configured dev root (${getSettings().devRoots.join(', ')}) or your user profile.`
    );
    if (!approved) return { ok: false, error: 'CANCELLED' };
  }

  const addDirs = resolveAddDirs(node);
  if (addDirs.untrusted.length) {
    // A granted directory is a second working directory with the same powers. It gets the same
    // question the working directory itself gets.
    const approved = await confirm(
      'Grant this agent directories outside your dev roots?',
      label,
      `${addDirs.untrusted.join('\n')}\n\nThe agent will be able to read and write these exactly as if they were part of ${cwd}.`
    );
    if (!approved) return { ok: false, error: 'CANCELLED' };
  }

  if (mode === 'popout-elevated') {
    // docs/07: elevation is opt-in per node, and SkynetOS itself never runs elevated — it asks
    // Windows to launch an elevated child, which is a UAC prompt every single time.
    const approved = await confirm(
      'Launch this session ELEVATED?',
      label,
      `${cwd}\n\nWindows will show a UAC prompt. An elevated agent can change anything on this machine.\nSkynetOS itself stays non-elevated.`
    );
    if (!approved) return { ok: false, error: 'CANCELLED' };
  }

  /*
   * Pick the conversation to resume: the newest recorded id that is actually on disk.
   *
   * Walking the list rather than taking the newest is what recovers a chip whose last launch
   * failed. The id was recorded before the spawn (so a crash cannot orphan a conversation), which
   * means a failure leaves a phantom at the top of the list with the real history underneath it.
   * See conversations.ts for how that went unnoticed for two sessions.
   */
  let storedSessionId: string | null = null;
  let phantomCount = 0;
  if (!options.fresh && node.resume !== false) {
    for (const id of claudeSessionIdsForNode(boardId, node.id)) {
      if (conversationExists(id, cwd)) { storedSessionId = id; break; }
      phantomCount++;
    }
  }

  const invocation = claudeArgs({
    node,
    storedSessionId,
    storedIsReal: storedSessionId !== null,
    fresh: options.fresh ?? false,
    addDirs: addDirs.granted
  });

  const { reading, missing } = resolveReading(node, cwd);
  const boardName = boardNameFor(boardId);
  const briefing = buildBriefing({
    node,
    boardName,
    cwd,
    reading,
    missing: [...missing, ...addDirs.missing.map((d) => `${d} (granted directory, not on disk)`)],
    addDirs: addDirs.granted,
    fresh: !invocation.resumed
  });

  const key = `${boardId}.${node.id}`;
  const promptFile = briefing ? stagePrompt(key, briefing) : undefined;

  const rowId = randomUUID();
  const startedAt = new Date().toISOString();

  // Recorded BEFORE the launch. If the machine dies mid-launch the conversation id is still on
  // disk; the resume walk above is what makes an unproven id harmless rather than poisonous.
  insertSession({
    id: rowId,
    node_id: node.id,
    board_id: boardId,
    kind: mode,
    cwd,
    claude_session_id: invocation.sessionId,
    pid: null,
    started_at: startedAt
  });

  const info: SessionInfo = {
    id: rowId,
    boardId,
    nodeId: node.id,
    nodeName: node.name,
    designator: node.designator ?? null,
    mode,
    cwd,
    claudeSessionId: invocation.sessionId,
    pid: null,
    startedAt,
    state: 'starting',
    resumed: invocation.resumed
  };
  tracked.set(rowId, { info });
  // Pushed before the await: the dock shows STARTING while the terminal is coming up, and an
  // elevated launch sitting on a UAC prompt looks like what it is instead of like a hang.
  notify();

  const primeSteps = primeStepsFor(node.prelaunch);

  const result = await openTerminal({
    key,
    cwd,
    elevated: mode === 'popout-elevated',
    spec: {
      title: `SkynetOS — ${label}`,
      banner: [
        cwd,
        `board ${boardName}  ·  ${invocation.resumed ? `resuming conversation ${invocation.sessionId.slice(0, 8)}` : 'new conversation'}`,
        ...(addDirs.granted.length ? [`granted: ${addDirs.granted.join('  ')}`] : [])
      ],
      prime: primeSteps,
      ...(promptFile ? { claude: { args: invocation.args, promptFile } } : { claude: { args: invocation.args } })
    }
  });

  if (!result.ok) {
    const entry = tracked.get(rowId);
    if (entry) { entry.info.state = 'error'; entry.info.error = result.error ?? 'LAUNCH FAILED'; }
    endSession(rowId, null, result.error ?? 'launch failed');
    recordEvent(boardId, node.id, 'session.failed', 2, { error: result.error });
    // Kept in the dock briefly so a failure is readable rather than a toast that has already gone.
    setTimeout(() => { tracked.delete(rowId); notify(); }, 30_000);
    notify();
    return { ok: false, error: result.error ?? 'LAUNCH FAILED' };
  }

  const entry = tracked.get(rowId);
  if (entry) {
    entry.info.state = 'running';
    entry.info.pid = result.pid;
    entry.pidFile = result.pidFile;
  }
  setSessionPid(rowId, result.pid);
  recordEvent(boardId, node.id, 'session.start', 2, { mode, resumed: invocation.resumed });
  notify();

  const notes: string[] = [];
  notes.push(invocation.resumed
    ? `RESUMED CONVERSATION ${invocation.sessionId.slice(0, 8)}`
    : `NEW CONVERSATION ${invocation.sessionId.slice(0, 8)}`);
  if (invocation.recoveredFrom) {
    notes.push(`PREVIOUS CONVERSATION ${invocation.recoveredFrom.slice(0, 8)} NO LONGER EXISTS — STARTED OVER`);
  } else if (phantomCount > 0) {
    notes.push(`SKIPPED ${phantomCount} DEAD CONVERSATION ID${phantomCount === 1 ? '' : 'S'}`);
  }
  if (primeSteps.length) notes.push(`PRIMING: ${primeSteps.map((s) => s.id).join(', ')}`);

  return {
    ok: true,
    session: tracked.get(rowId)?.info ?? info,
    focused: false,
    note: notes.join(' · ')
  };
}

/**
 * Stop a session.
 *
 * The pid is the SHELL the staged script runs in, not a launcher stub, so `taskkill /T` really
 * does take the session and its child `claude` with it — which is what "Kill" has to mean.
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
 * Drop sessions whose shell has gone.
 *
 * There is no child-process `exit` event to rely on any more, and there never really was: the
 * process SkynetOS spawns is a launcher that exits within a second of a successful launch. The
 * pid file the staged script maintains is the actual signal, and this is the only thing that
 * moves a session out of `running`.
 */
export function sweepSessions(): void {
  let changed = false;
  for (const [id, entry] of tracked) {
    if (entry.info.state !== 'running') continue;
    const alive = entry.pidFile
      ? readLivePid(entry.pidFile) !== null
      : entry.info.pid !== null && isProcessAlive(entry.info.pid);
    if (!alive) {
      entry.info.state = 'exited';
      endSession(id, null, 'shell closed');
      recordEvent(entry.info.boardId, entry.info.nodeId, 'session.exit', 1);
      // Held briefly so a session that dies on startup is visible rather than vanishing.
      setTimeout(() => { tracked.delete(id); notify(); }, 30_000);
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

/** The room's display name, for the briefing's first line. Falls back to the id. */
function boardNameFor(boardId: string): string {
  const load = loadBoard(boardId);
  return load.ok ? (load.board.engraving ?? load.board.name) : boardId;
}

/** True when this node's briefing would be sent on the next launch. For the inspector. */
export function briefingActive(node: BoardNode): boolean {
  return briefingModeOf(node) !== 'none';
}

async function confirm(title: string, message: string, detail: string): Promise<boolean> {
  const win_ = BrowserWindow.getAllWindows()[0];
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
  const { response } = win_
    ? await dialog.showMessageBox(win_, options)
    : await dialog.showMessageBox(options);
  return response === 0;
}
