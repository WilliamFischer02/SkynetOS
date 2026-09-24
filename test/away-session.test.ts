import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { startAwayRun, type AwayChild, type AwayRunEnd } from '../src/main/services/away-session.js';
import type { AwayLine, AwayLogItem } from '../packages/shared/away.js';

/**
 * The away runner against a FAKE claude process. A real headless run spends usage and edits files,
 * so none is started here: the fake reads its prompt from stdin, emits canned stream-json, and
 * exits (or hangs until killed).
 */

const EDIT = JSON.stringify({
  type: 'assistant',
  message: { id: 'm1', content: [
    { type: 'text', text: 'Updating the roadmap.' },
    { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'C:/dev/SkynetOS/docs/06-ROADMAP.md' } }
  ], usage: { input_tokens: 10, output_tokens: 5 } }
});
const READ = (id: string): string => JSON.stringify({
  type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: 'C:/dev/x.md' } }] }
});
const RESULT = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', usage: { input_tokens: 10, output_tokens: 5 } });

function fakeChild(lines: string[], opts: { exit: boolean }): AwayChild & { prompt: () => string; killed: () => boolean } {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let prompt = '';
  let killed = false;
  const child = {
    pid: 4242,
    exitCode: null as number | null,
    stdin,
    stdout,
    stderr,
    on: (event: string, listener: (...a: never[]) => void) => { emitter.on(event, listener as (...a: unknown[]) => void); return child; },
    kill: () => {
      killed = true;
      setImmediate(() => { child.exitCode = 1; emitter.emit('exit', 1); });
      return true;
    },
    prompt: () => prompt,
    killed: () => killed
  };
  stdin.on('data', (d: Buffer) => { prompt += d.toString(); });
  stdin.on('finish', () => {
    for (const line of lines) stdout.write(`${line}\n`);
    if (opts.exit) {
      stdout.end();
      setTimeout(() => { child.exitCode = 0; emitter.emit('exit', 0); }, 20);
    }
  });
  return child as unknown as AwayChild & { prompt: () => string; killed: () => boolean };
}

function run(child: AwayChild, extra: { wallClockMs?: number; maxToolCalls?: number } = {}) {
  const lines: AwayLine[] = [];
  const items: AwayLogItem[] = [];
  const trees: number[] = [];
  let spawned: { exe: string; args: string[]; cwd: string } | null = null;
  const ended = new Promise<AwayRunEnd>((resolve) => {
    const handle = startAwayRun({
      exe: 'claude.exe', args: ['-p', '--output-format', 'stream-json'], cwd: 'C:\\dev', prompt: 'AWAY SESSION. Do the thing.',
      wallClockMs: extra.wallClockMs ?? 60_000, maxToolCalls: extra.maxToolCalls ?? 100,
      onLine: (l) => lines.push(l), onItem: (i) => items.push(i), onEnd: resolve
    }, {
      spawn: (exe, args, options) => { spawned = { exe, args, cwd: options.cwd }; return child; },
      killTree: (pid) => trees.push(pid),
      graceMs: 50
    });
    (run as unknown as { last: typeof handle }).last = handle;
  });
  return { lines, items, trees, ended, spawned: () => spawned, handle: () => (run as unknown as { last: ReturnType<typeof startAwayRun> }).last };
}

describe('the away runner', () => {
  it('streams a whole run: prompt on stdin, lines and items out, a finished end', async () => {
    const child = fakeChild([EDIT, 'not json', RESULT], { exit: true });
    const r = run(child);
    const end = await r.ended;
    expect(child.prompt()).toBe('AWAY SESSION. Do the thing.');
    expect(r.spawned()).toEqual({ exe: 'claude.exe', args: ['-p', '--output-format', 'stream-json'], cwd: 'C:\\dev' });
    expect(r.lines.map((l) => l.kind)).toEqual(['text', 'tool', 'result']);
    expect(r.items.map((i) => i.kind)).toEqual(['roadmap']);
    expect(end.reason).toBe('finished');
    expect(end.tally.summary).toBe('Done.');
    expect(r.trees).toEqual([]);
  });

  it('stops on request: kill, then the whole tree', async () => {
    const child = fakeChild([EDIT], { exit: false });
    const r = run(child);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await r.handle().stop('stopped');
    const end = await r.ended;
    expect(child.killed()).toBe(true);
    expect(r.trees).toEqual([4242]);
    expect(end.reason).toBe('stopped');
    expect(end.tally.files).toEqual(['SkynetOS/docs/06-ROADMAP.md']);
  });

  it('stops itself at the tool-call ceiling', async () => {
    const child = fakeChild([READ('a'), READ('b'), READ('c')], { exit: false });
    const end = await run(child, { maxToolCalls: 2 }).ended;
    expect(end.reason).toBe('tool-cap');
  });

  it('stops itself at the wall-clock cap', async () => {
    const child = fakeChild([], { exit: false });
    const end = await run(child, { wallClockMs: 30 }).ended;
    expect(end.reason).toBe('wall-clock');
  });

  it('reports a process that could not start as crashed', async () => {
    const lines: AwayLine[] = [];
    const end = await new Promise<AwayRunEnd>((resolve) => {
      startAwayRun({
        exe: 'claude.exe', args: [], cwd: 'C:\\dev', prompt: 'x', wallClockMs: 1000, maxToolCalls: 1,
        onLine: (l) => lines.push(l), onItem: () => undefined, onEnd: resolve
      }, { spawn: () => { throw new Error('spawn claude.exe ENOENT'); }, killTree: () => undefined });
    });
    expect(end.reason).toBe('crashed');
    expect(end.stderr).toContain('ENOENT');
  });
});
