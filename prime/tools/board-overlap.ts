import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { footprintOf, isPrinted } from '../../packages/shared/types.js';
import type { BoardNode } from '../../packages/shared/types.js';

/**
 * Mounted nodes that overlap, or leave the grid, on every board.
 *
 * Earlier sessions wrote this check inline each time they edited a board on disk (the mod grid on
 * 2026-09-15, the room restyle before it). Now it is one command: `npm run board:overlap`. Printed
 * kinds (`note.silk`, `group.zone`, `decor.*`, per `isPrinted`) occupy nothing and are skipped,
 * whatever footprint they carry, which is the same rule the validators and the router use. Exit code 1 when anything is found, so it can gate.
 */

interface Board {
  grid?: { width?: number; height?: number };
  nodes?: BoardNode[];
}

interface Box { id: string; x: number; y: number; w: number; h: number }

function boardFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === '.snapshots') continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...boardFiles(full));
    else if (entry.endsWith('.board.json')) out.push(full);
  }
  return out.sort();
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function checkBoard(board: Board): { pairs: [string, string][]; outside: string[] } {
  const boxes: Box[] = [];
  for (const node of board.nodes ?? []) {
    if (isPrinted(node.kind)) continue;
    const fp = footprintOf(node);
    if (fp.w === 0 || fp.h === 0) continue;
    boxes.push({ id: node.id, x: node.pos.x, y: node.pos.y, w: fp.w, h: fp.h });
  }
  const pairs: [string, string][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (overlaps(a, b)) pairs.push([a.id, b.id]);
    }
  }
  const width = board.grid?.width ?? Infinity;
  const height = board.grid?.height ?? Infinity;
  const outside = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > width || b.y + b.h > height).map((b) => b.id);
  return { pairs, outside };
}

function main(): void {
  const root = join(process.cwd(), 'board');
  let faults = 0;
  for (const file of boardFiles(root)) {
    const rel = relative(process.cwd(), file).replace(/\\/g, '/');
    let board: Board;
    try {
      board = JSON.parse(readFileSync(file, 'utf8')) as Board;
    } catch (err) {
      console.log(`FAULT ${rel}: ${(err as Error).message}`);
      faults++;
      continue;
    }
    const { pairs, outside } = checkBoard(board);
    const mounted = (board.nodes ?? []).filter((n) => !isPrinted(n.kind)).length;
    if (!pairs.length && !outside.length) {
      console.log(`ok    ${rel}  (${mounted} mounted, no overlap, all inside ${board.grid?.width ?? '?'}x${board.grid?.height ?? '?'})`);
      continue;
    }
    faults += pairs.length + outside.length;
    for (const [a, b] of pairs) console.log(`OVERLAP ${rel}: ${a} and ${b}`);
    for (const id of outside) console.log(`OUTSIDE ${rel}: ${id} leaves the grid`);
  }
  console.log(faults ? `\n${faults} fault(s). Move something.` : '\nEvery mounted node has its own space.');
  process.exitCode = faults ? 1 : 0;
}

// Run only as a script; the test imports the two pure functions above. vite-node strips the script
// path out of process.argv, so the script cannot recognise itself there; vitest sets VITEST instead.
if (!process.env['VITEST']) main();
