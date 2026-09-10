import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { BoardNode } from '@shared/types.js';
import type { ServiceInfo } from '@shared/ipc.js';
import { endSession, insertSession, isProcessAlive, recordEvent, setSessionPid } from './db.js';
import { expandPath, isInsideTrustedRoot } from './target-resolver.js';

/**
 * `service.process` nodes: a dev server, a game server, anything long-running you start and stop.
 *
 * Unlike an agent session this one is NOT detached — SkynetOS owns the process, keeps a tail of
 * its stdout, and kills it on quit. A dev server you started from the board and cannot see the
 * output of is a dev server you will start twice.
 *
 * docs/07: "Run arbitrary shell — only within a node's declared cwd, and only via a session the
 * node already declares." Both halves are enforced here: the command comes from the node's
 * `startCommand` and nowhere else, and the cwd must resolve inside a trusted root or be
 * confirmed. There is no channel that takes a command string from the renderer.
 */

const TAIL_LINES = 200;

interface Running {
  info: ServiceInfo;
  child: ChildProcess;
  tail: string[];
}

const running = new Map<string, Running>();

export type ServiceListener = (services: ServiceInfo[]) => void;
const listeners = new Set<ServiceListener>();

export function onServicesChanged(listener: ServiceListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  const list = listServices();
  for (const l of listeners) l(list);
}

export function listServices(): ServiceInfo[] {
  return [...running.values()].map((r) => r.info);
}

function key(boardId: string, nodeId: string): string {
  return `${boardId}::${nodeId}`;
}

export function serviceFor(boardId: string, nodeId: string): ServiceInfo | undefined {
  return running.get(key(boardId, nodeId))?.info;
}

export function serviceTail(boardId: string, nodeId: string): string[] {
  return running.get(key(boardId, nodeId))?.tail ?? [];
}

export function startService(boardId: string, node: BoardNode): { ok: boolean; error?: string; info?: ServiceInfo } {
  if (node.kind !== 'service.process') return { ok: false, error: `${node.kind} IS NOT A SERVICE` };
  if (!node.startCommand) return { ok: false, error: 'NO START COMMAND SET' };
  if (!node.cwd) return { ok: false, error: 'NO WORKING DIRECTORY SET' };

  const k = key(boardId, node.id);
  const existing = running.get(k);
  if (existing && existing.info.state === 'running') {
    return { ok: true, info: existing.info, error: undefined };
  }

  const cwd = expandPath(node.cwd);
  if (cwd.includes('..')) return { ok: false, error: `WORKING DIRECTORY CONTAINS ".." — ${cwd}` };
  if (!isInsideTrustedRoot(cwd)) {
    // No dialog here: a service is started from the inspector, which already required a click on
    // this specific node. Refusing outright and saying why is clearer than a second prompt.
    return { ok: false, error: `WORKING DIRECTORY IS OUTSIDE EVERY DEV ROOT — ${cwd}` };
  }

  const rowId = randomUUID();
  const startedAt = new Date().toISOString();
  insertSession({
    id: rowId,
    node_id: node.id,
    board_id: boardId,
    kind: 'service',
    cwd,
    claude_session_id: null,
    pid: null,
    started_at: startedAt
  });

  try {
    // shell: true so `npm run dev` works as written. The command is board data, never renderer
    // input, and the board file is git-tracked and reviewed — which is the whole reason
    // docs/07 says board JSON may only contain shell strings on a node that declares them.
    const child = spawn(node.startCommand, {
      cwd: cwd.replace(/\//g, '\\'),
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    setSessionPid(rowId, child.pid ?? null);

    const info: ServiceInfo = {
      id: rowId,
      boardId,
      nodeId: node.id,
      nodeName: node.name,
      command: node.startCommand,
      cwd,
      port: node.port ?? null,
      pid: child.pid ?? null,
      startedAt,
      state: 'running'
    };
    const entry: Running = { info, child, tail: [] };
    running.set(k, entry);

    const append = (chunk: Buffer, stream: 'out' | 'err') => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        entry.tail.push(stream === 'err' ? `! ${line}` : line);
      }
      while (entry.tail.length > TAIL_LINES) entry.tail.shift();
    };
    child.stdout?.on('data', (c: Buffer) => append(c, 'out'));
    child.stderr?.on('data', (c: Buffer) => append(c, 'err'));

    child.on('exit', (code) => {
      entry.info.state = code === 0 ? 'exited' : 'failed';
      entry.info.exitCode = code ?? null;
      endSession(rowId, code ?? null);
      recordEvent(boardId, node.id, 'service.exit', 1, { exitCode: code });
      notify();
    });
    child.on('error', (err) => {
      entry.info.state = 'failed';
      entry.info.error = err.message;
      entry.tail.push(`! ${err.message}`);
      endSession(rowId, null, err.message);
      notify();
    });

    recordEvent(boardId, node.id, 'service.start', 2, { command: node.startCommand });
    notify();
    return { ok: true, info };
  } catch (err) {
    endSession(rowId, null, (err as Error).message);
    return { ok: false, error: `START FAILED — ${(err as Error).message}` };
  }
}

export function stopService(boardId: string, nodeId: string): { ok: boolean; error?: string } {
  const entry = running.get(key(boardId, nodeId));
  if (!entry) return { ok: false, error: 'NOT RUNNING' };
  const pid = entry.info.pid;
  if (pid === null) return { ok: false, error: 'NO PID' };

  try {
    // A dev server spawns children (node, esbuild, a watcher). /T takes the tree, which is what
    // stopping a service has to mean — otherwise the port stays bound and the next start fails.
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    entry.info.state = 'exited';
    endSession(entry.info.id, null, 'stopped by user');
    recordEvent(boardId, nodeId, 'service.stop', 1);
    notify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Kill everything we own. Called on quit — a dev server outliving the app is a bug, not a feature. */
export function stopAllServices(): void {
  for (const [k, entry] of running) {
    if (entry.info.state !== 'running' || entry.info.pid === null) continue;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(entry.info.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } else {
        process.kill(entry.info.pid, 'SIGTERM');
      }
      endSession(entry.info.id, null, 'app quit');
    } catch { /* going away anyway */ }
    running.delete(k);
  }
}

export function sweepServices(): void {
  let changed = false;
  for (const entry of running.values()) {
    if (entry.info.state !== 'running' || entry.info.pid === null) continue;
    if (!isProcessAlive(entry.info.pid)) {
      entry.info.state = 'exited';
      endSession(entry.info.id, null, 'process gone');
      changed = true;
    }
  }
  if (changed) notify();
}
