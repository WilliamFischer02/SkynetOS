import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { createAwayTracker, type AwayLine, type AwayLogItem, type AwayTally } from '@shared/away.js';

/**
 * One away run: a headless `claude -p` process, its stream-json read line by line.
 *
 * Deliberately knows nothing about settings, boards or Electron. presence.ts decides when to run
 * and with what; this spawns, streams, counts and stops. `spawn` and `killTree` are injectable so
 * test/away-session.test.ts can drive it with a fake process instead of spending real usage.
 */

export type AwayEndReason = 'finished' | 'stopped' | 'wall-clock' | 'tool-cap' | 'crashed';

export interface AwayRunEnd {
  reason: AwayEndReason;
  exitCode: number | null;
  tally: AwayTally;
  /** The tail of stderr, for a run that crashed. */
  stderr: string;
}

/** The part of a ChildProcess this module uses, so a test can hand it a fake. */
export interface AwayChild {
  pid?: number;
  exitCode: number | null;
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface AwayRunOptions {
  exe: string;
  args: string[];
  cwd: string;
  /** Written to stdin and closed. Never on the command line. */
  prompt: string;
  wallClockMs: number;
  maxToolCalls: number;
  onLine: (line: AwayLine) => void;
  onItem: (item: AwayLogItem) => void;
  onEnd: (end: AwayRunEnd) => void;
}

export interface AwayRunDeps {
  spawn?: (exe: string, args: string[], options: { cwd: string; windowsHide: boolean; stdio: ['pipe', 'pipe', 'pipe'] }) => AwayChild;
  killTree?: (pid: number) => void;
  now?: () => number;
  /** How long a stop waits for a clean exit before the tree is killed. */
  graceMs?: number;
}

export interface AwayRun {
  readonly running: boolean;
  tally(): AwayTally;
  /** Stop the run: kill, wait, then kill the whole tree. Resolves once it has ended. */
  stop(reason?: AwayEndReason): Promise<void>;
}

/**
 * `taskkill /T` takes the process tree: claude, its MCP server, and any shell it had open. A plain
 * kill on Windows is TerminateProcess on claude.exe alone.
 */
function defaultKillTree(pid: number): void {
  try {
    const killer = nodeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => undefined);
  } catch { /* already gone */ }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function startAwayRun(opts: AwayRunOptions, deps: AwayRunDeps = {}): AwayRun {
  const spawnImpl = deps.spawn ?? ((exe, args, options) => nodeSpawn(exe, args, options) as unknown as AwayChild);
  const killTree = deps.killTree ?? defaultKillTree;
  const now = deps.now ?? Date.now;
  const graceMs = deps.graceMs ?? 3000;
  const tracker = createAwayTracker();

  let running = true;
  let endReason: AwayEndReason | null = null;
  let stderr = '';
  let stopping: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveExit: (code: number | null) => void = () => undefined;
  const exited = new Promise<number | null>((resolve) => { resolveExit = resolve; });

  const finish = (code: number | null): void => {
    if (!running) return;
    running = false;
    if (timer) clearTimeout(timer);
    const tally = tracker.tally();
    const reason = endReason ?? (tally.finished || code === 0 ? 'finished' : 'crashed');
    opts.onEnd({ reason, exitCode: code, tally, stderr: stderr.trim() });
  };

  let child: AwayChild;
  try {
    child = spawnImpl(opts.exe, opts.args, { cwd: opts.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    stderr = (err as Error).message;
    endReason = 'crashed';
    const run: AwayRun = { get running() { return false; }, tally: () => tracker.tally(), stop: () => Promise.resolve() };
    queueMicrotask(() => finish(null));
    return run;
  }

  const run: AwayRun = {
    get running() { return running; },
    tally: () => tracker.tally(),
    stop(reason: AwayEndReason = 'stopped'): Promise<void> {
      if (!running) return Promise.resolve();
      if (stopping) return stopping;
      endReason = reason;
      stopping = (async () => {
        try { child.kill(); } catch { /* already gone */ }
        const clean = await Promise.race([exited.then(() => true), delay(graceMs).then(() => false)]);
        if (child.pid) killTree(child.pid);
        if (!clean) await Promise.race([exited, delay(graceMs)]);
        finish(child.exitCode ?? null);
      })();
      return stopping;
    }
  };

  child.on('error', (err) => {
    stderr += err.message;
    endReason ??= 'crashed';
    resolveExit(null);
    finish(null);
  });
  child.on('exit', (code) => {
    resolveExit(code);
    finish(code);
  });

  if (child.stdout) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      const { lines, items } = tracker.ingest(line, now());
      for (const l of lines) opts.onLine(l);
      for (const i of items) opts.onItem(i);
      if (running && !stopping && tracker.tally().toolCalls >= opts.maxToolCalls) void run.stop('tool-cap');
    });
  }
  child.stderr?.on('data', (chunk: Buffer | string) => { stderr = (stderr + chunk.toString()).slice(-4000); });

  // The prompt goes in on stdin and stdin is closed: `claude -p` reads it, then runs to the end.
  child.stdin?.on('error', () => undefined);
  child.stdin?.end(opts.prompt, 'utf8');

  timer = setTimeout(() => { void run.stop('wall-clock'); }, opts.wallClockMs);
  if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref(): void }).unref();

  return run;
}
