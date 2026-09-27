/**
 * What is drawn at the centre of the globe when an item is summoned: a document wrapped onto a
 * tall sheet of paper, a code file as a small terminal being typed into, a 3D model as a crude
 * wireframe, a folder as its listing.
 *
 * William, 2026-09-26: "documents rendered on a gradually autoscrolling render of a tall piece of
 * paper … code gets a mini rendered command line; when code is being written it's rendered
 * appearing here, when deleted or replaced it appears or disappears, animating as though being
 * typed … rove between changes at a slight delay that allows it to do less adding and removing."
 *
 * Pure over text the caller has already read. Nothing here opens a file.
 */
import type { FolderContent, HoloKind, PaperContent, TerminalContent, TerminalOp, WireframeContent } from './holo-scene.js';

/* ────────────────────────── paper ────────────────────────── */

export const PAPER_COLUMNS = 42;
export const PAPER_MAX_LINES = 400;

/** Word-wrap one source line to `columns`; a word longer than the column is cut. */
export function wrapLine(line: string, columns: number): string[] {
  const text = line.replace(/\t/g, '  ').replace(/\r$/, '');
  if (text.length <= columns) return [text];
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    if (current.length + word.length <= columns) { current += word; continue; }
    if (current.trim()) out.push(current.replace(/\s+$/, ''));
    current = '';
    let rest = word.replace(/^\s+/, '');
    while (rest.length > columns) { out.push(rest.slice(0, columns)); rest = rest.slice(columns); }
    current = rest;
  }
  if (current.trim() || !out.length) out.push(current.replace(/\s+$/, ''));
  return out;
}

export function paperFrom(text: string, title: string, opts: { columns?: number; maxLines?: number; focusLine?: number } = {}): PaperContent {
  const columns = opts.columns ?? PAPER_COLUMNS;
  const maxLines = opts.maxLines ?? PAPER_MAX_LINES;
  const wrapped: string[] = [];
  const sourceStart: number[] = [];
  const source = text.split('\n');
  source.forEach((line, i) => {
    sourceStart.push(wrapped.length);
    wrapped.push(...wrapLine(line, columns));
  });
  let lines = wrapped;
  let scrollFrom = 0;
  if (wrapped.length > maxLines) {
    const focus = opts.focusLine !== undefined ? (sourceStart[Math.min(Math.max(0, opts.focusLine), sourceStart.length - 1)] ?? 0) : 0;
    const start = Math.max(0, Math.min(focus - Math.floor(maxLines / 3), wrapped.length - maxLines));
    lines = wrapped.slice(start, start + maxLines);
    scrollFrom = Math.max(0, focus - start);
  } else if (opts.focusLine !== undefined) {
    scrollFrom = sourceStart[Math.min(Math.max(0, opts.focusLine), sourceStart.length - 1)] ?? 0;
  }
  return { type: 'paper', lines, scrollFrom, title };
}

/* ────────────────────────── terminal ────────────────────────── */

/** Typing speed the terminal animates at. */
export const TYPE_CHARS_PER_S = 30;
/** The pause the caret takes between one change and the next. */
export const ROVE_MS = 120;
/** Ops that would start closer together than this play together. */
export const MERGE_MS = 200;
/** A delete is one motion, not typed. */
export const DELETE_MS = 150;
/** Above this many lines on either side, the diff is not worth computing; the file is rewritten. */
export const DIFF_MAX_LINES = 2_000;

type Step = { kind: 'equal' } | { kind: 'delete'; text: string } | { kind: 'insert'; text: string };

/** Line-level LCS diff. O(n·m) with n, m ≤ DIFF_MAX_LINES. */
export function diffLines(before: readonly string[], after: readonly string[]): Step[] {
  const n = before.length;
  const m = after.length;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = before[i] === after[j]
        ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) { steps.push({ kind: 'equal' }); i++; j++; }
    else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) { steps.push({ kind: 'delete', text: before[i]! }); i++; }
    else { steps.push({ kind: 'insert', text: after[j]! }); j++; }
  }
  while (i < n) { steps.push({ kind: 'delete', text: before[i]! }); i++; }
  while (j < m) { steps.push({ kind: 'insert', text: after[j]! }); j++; }
  return steps;
}

/**
 * The terminal for a change: the lines before it, and the ops that turn them into the lines
 * after, timed as typing. A delete followed by an insert on the same line is one `replace`.
 */
export function terminalFrom(before: string, after: string, title: string, language?: string): TerminalContent {
  const oldLines = before ? before.split('\n') : [];
  const newLines = after ? after.split('\n') : [];
  if (oldLines.length > DIFF_MAX_LINES || newLines.length > DIFF_MAX_LINES) {
    return { type: 'terminal', lines: newLines.slice(0, DIFF_MAX_LINES), ops: [], title: `${title} (rewritten)`, language };
  }
  const steps = diffLines(oldLines, newLines);
  const ops: TerminalOp[] = [];
  let line = 0;
  let clock = 0;
  let lastStart = -Infinity;
  const schedule = (op: Omit<TerminalOp, 'at'>, duration: number) => {
    let at = clock;
    if (at - lastStart < MERGE_MS && ops.length) at = lastStart;
    ops.push({ ...op, at });
    lastStart = at;
    clock = at + duration + ROVE_MS;
  };
  // Walk the script as hunks: a run of deletes and inserts between equal lines. Inside a hunk the
  // deletes and inserts pair up as replaces (the LCS walk may order them either way), and what is
  // left over is typed or removed on its own.
  let s = 0;
  while (s < steps.length) {
    const step = steps[s]!;
    if (step.kind === 'equal') { line++; s++; continue; }
    const deletes: string[] = [];
    const inserts: string[] = [];
    while (s < steps.length && steps[s]!.kind !== 'equal') {
      const h = steps[s]!;
      if (h.kind === 'delete') deletes.push(h.text);
      else if (h.kind === 'insert') inserts.push(h.text);
      s++;
    }
    const pairs = Math.min(deletes.length, inserts.length);
    for (let k = 0; k < pairs; k++) {
      const text = inserts[k]!;
      schedule({ line, text, kind: 'replace' }, DELETE_MS + (text.length / TYPE_CHARS_PER_S) * 1000);
      line++;
    }
    for (let k = pairs; k < deletes.length; k++) {
      schedule({ line, text: deletes[k]!, kind: 'delete' }, DELETE_MS);
    }
    for (let k = pairs; k < inserts.length; k++) {
      const text = inserts[k]!;
      schedule({ line, text, kind: 'insert' }, (text.length / TYPE_CHARS_PER_S) * 1000);
      line++;
    }
  }
  return { type: 'terminal', lines: oldLines, ops: ops.map((o) => ({ ...o, at: Math.round(o.at) })), title, language };
}

/* ────────────────────────── wireframe ────────────────────────── */

export const WIRE_MAX_EDGES = 4_000;

type V3 = [number, number, number];

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function normaliseVerts(verts: V3[]): V3[] {
  if (!verts.length) return verts;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, v[k]!); max[k] = Math.max(max[k]!, v[k]!); }
  const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) || 1;
  const centre: V3 = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
  return verts.map((v) => [(v[0]! - centre[0]!) / extent, (v[1]! - centre[1]!) / extent, (v[2]! - centre[2]!) / extent] as V3);
}

function decimate(edges: [number, number][], cap: number): [number, number][] {
  if (edges.length <= cap) return edges;
  const step = Math.ceil(edges.length / cap);
  const out: [number, number][] = [];
  for (let i = 0; i < edges.length; i += step) out.push(edges[i]!);
  return out;
}

/** Wavefront OBJ: `v x y z` and `f a b c …` (indices 1-based, `a/b/c` forms allowed, negatives allowed). */
export function wireFromObj(text: string, title: string): WireframeContent {
  const verts: V3[] = [];
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.slice(2).trim().split(/\s+/).map(Number);
      if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) verts.push([p[0]!, p[1]!, p[2]!]);
    } else if (line.startsWith('f ')) {
      const idx = line.slice(2).trim().split(/\s+/).map((t) => {
        const n = Number(t.split('/')[0]);
        return n < 0 ? verts.length + n : n - 1;
      }).filter((n) => Number.isInteger(n) && n >= 0 && n < verts.length);
      for (let k = 0; k < idx.length; k++) {
        const a = idx[k]!;
        const b = idx[(k + 1) % idx.length]!;
        if (a === b) continue;
        const key = edgeKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  return { type: 'wire', verts: normaliseVerts(verts), edges: decimate(edges, WIRE_MAX_EDGES), title };
}

function readAsciiStl(text: string): V3[][] {
  const facets: V3[][] = [];
  let current: V3[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('vertex')) {
      const p = line.slice(6).trim().split(/\s+/).map(Number);
      if (p.length >= 3) current.push([p[0]!, p[1]!, p[2]!]);
    } else if (line.startsWith('endfacet')) {
      if (current.length === 3) facets.push(current);
      current = [];
    }
  }
  return facets;
}

function readBinaryStl(bytes: Uint8Array): V3[][] {
  if (bytes.length < 84) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const facets: V3[][] = [];
  let offset = 84;
  for (let f = 0; f < count && offset + 50 <= bytes.length; f++) {
    const tri: V3[] = [];
    for (let v = 0; v < 3; v++) {
      const base = offset + 12 + v * 12;
      tri.push([view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true)]);
    }
    facets.push(tri);
    offset += 50;
  }
  return facets;
}

/** True when the bytes are a binary STL: not an ASCII `solid` file whose size disagrees with the facet count. */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (84 + count * 50 === bytes.length) return true;
  const head = String.fromCharCode(...bytes.subarray(0, 5)).toLowerCase();
  return head !== 'solid';
}

export function wireFromStl(data: Uint8Array | string, title: string): WireframeContent {
  const facets = typeof data === 'string'
    ? readAsciiStl(data)
    : isBinaryStl(data) ? readBinaryStl(data) : readAsciiStl(new TextDecoder().decode(data));
  const verts: V3[] = [];
  const index = new Map<string, number>();
  const at = (v: V3): number => {
    const key = v.map((n) => Math.round(n * 1e5) / 1e5).join(',');
    let i = index.get(key);
    if (i === undefined) { i = verts.length; verts.push(v); index.set(key, i); }
    return i;
  };
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  for (const tri of facets) {
    const ids = tri.map(at);
    for (let k = 0; k < 3; k++) {
      const a = ids[k]!;
      const b = ids[(k + 1) % 3]!;
      if (a === b) continue;
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }
  return { type: 'wire', verts: normaliseVerts(verts), edges: decimate(edges, WIRE_MAX_EDGES), title };
}

/** By extension. Unknown model formats (gltf, fbx, blend) get an empty frame with the title. */
export function wireFrom(data: Uint8Array | string, ext: string, title: string): WireframeContent {
  const e = ext.toLowerCase().replace(/^\./, '');
  if (e === 'obj') return wireFromObj(typeof data === 'string' ? data : new TextDecoder().decode(data), title);
  if (e === 'stl') return wireFromStl(data, title);
  return { type: 'wire', verts: [], edges: [], title };
}

/* ────────────────────────── folder ────────────────────────── */

export const FOLDER_MAX_ENTRIES = 60;

export function folderFrom(entries: readonly { name: string; kind: HoloKind }[], title: string): FolderContent {
  const sorted = [...entries].sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
  return { type: 'folder', entries: sorted.slice(0, FOLDER_MAX_ENTRIES), title };
}
