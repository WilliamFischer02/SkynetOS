import { cpSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * The click-to-action round trip's main-process half, timed (2026-09-26 audit).
 *
 * `command:apply` is validate → snapshot every board → write → history. Outside Electron the home
 * is the working directory (services/home.ts), so this test copies `board/` and `schema/` into a
 * temp folder, changes into it, and runs twenty `node.move` commands against the copy. The real
 * board is never touched; the snapshots land in the copy's own `.snapshots/`. The bound is
 * generous (this is a table first, a gate second), and the numbers are printed every run.
 */

const REPO = process.cwd();
let tmp = '';

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skynet-perf-'));
  mkdirSync(join(tmp, 'board'), { recursive: true });
  cpSync(join(REPO, 'board'), join(tmp, 'board'), { recursive: true, filter: (src) => !src.includes('.snapshots') });
  cpSync(join(REPO, 'schema'), join(tmp, 'schema'), { recursive: true });
  process.chdir(tmp);
});

afterAll(() => {
  process.chdir(REPO);
});

describe('command:apply round trip (main half)', () => {
  it('moves a node twenty times and reports p50/p95', async () => {
    const { apply } = await import('../src/main/services/command-bus.js');
    const { loadBoard } = await import('../src/main/services/board-store.js');
    const root = loadBoard('root');
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const node = root.board.nodes.find((n) => n.kind === 'agent.code' || n.kind === 'store.repo')!;
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const pos = { x: node.pos.x + (i % 2), y: node.pos.y };
      const t = performance.now();
      const result = apply({ command: { type: 'node.move', boardId: 'root', nodeId: node.id, pos }, actor: 'user', label: `perf ${i}` });
      times.push(performance.now() - t);
      expect(result.ok, result.ok ? '' : result.error).toBe(true);
    }
    const snapshots = readdirSync(join(tmp, 'board', '.snapshots')).length;
    const line = `command:apply node.move × 20 on ${root.board.nodes.length} nodes: p50 ${percentile(times, 50).toFixed(1)} ms · p95 ${percentile(times, 95).toFixed(1)} ms · max ${Math.max(...times).toFixed(1)} ms · ${snapshots} snapshots written`;
    console.log(`[perf] ${line}`);
    expect(percentile(times, 95)).toBeLessThan(400);
  });
});
