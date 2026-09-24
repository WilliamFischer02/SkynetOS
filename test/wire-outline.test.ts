import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { WIRE_DASHES, type Board, type BoardEdge } from '../packages/shared/types.js';
import { ROOM_THEMES } from '../packages/shared/palette.js';
import { makeNode } from '../src/main/services/node-factory.js';
import { outlinePieces, runPieces, styleFor, type Point } from '../src/renderer/board/traces.js';
import { LANE_GAP, separateParallel } from '../src/renderer/board/wire-lanes.js';

/**
 * The new wire fields end to end: what the schema accepts, how a style is resolved from them, and
 * how the outline and the lanes respond. See test/wire-geometry.test.ts for the pieces themselves.
 */

const schema = JSON.parse(readFileSync(join(process.cwd(), 'schema', 'board.schema.json'), 'utf8'));
const validate = addFormats(new Ajv2020({ allErrors: true, strict: false })).compile(schema);

function boardWith(edge: Record<string, unknown>): Board {
  const board: Board = {
    schemaVersion: 1,
    id: 'test',
    name: 'TEST',
    theme: { maskDark: '#0E1A14', maskLight: '#16261D', signal: '#7FE0B0' },
    grid: { tile: 16, width: 32, height: 32 },
    nodes: [],
    edges: []
  };
  const a = makeNode(board, 'decor.part', { x: 2, y: 2 });
  board.nodes.push(a);
  const b = makeNode(board, 'decor.part', { x: 12, y: 12 });
  board.nodes.push(b);
  board.edges.push({ id: 'e1', from: a.id, to: b.id, kind: 'reads', ...edge } as BoardEdge);
  return board;
}

const edge = (over: Partial<BoardEdge> = {}): BoardEdge => ({ id: 'e1', from: 'a', to: 'b', kind: 'produces', ...over });
const theme = ROOM_THEMES.root;

describe('the schema', () => {
  it('accepts every new wire field', () => {
    const ok = validate(boardWith({
      dash: 'dotted',
      outlineDash: 'dashed',
      outlineWidth: 0,
      fromAnchor: { side: 'right', offset: 0.5 },
      toAnchor: { side: 'top', offset: 0 },
      waypoints: [[8, 4], [8, 12]]
    }));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('refuses a pattern, a width or an anchor it does not know', () => {
    expect(validate(boardWith({ dash: 'wavy' }))).toBe(false);
    expect(validate(boardWith({ outlineWidth: 5 }))).toBe(false);
    expect(validate(boardWith({ fromAnchor: { side: 'middle', offset: 0.5 } }))).toBe(false);
    expect(validate(boardWith({ toAnchor: { side: 'top', offset: 1.5 } }))).toBe(false);
    expect(validate(boardWith({ toAnchor: { side: 'top', offset: 0.5, extra: true } }))).toBe(false);
    expect(validate(boardWith({ fromAnchor: { side: 'left' } }))).toBe(false);
  });

  it('names exactly the patterns the editor offers', () => {
    const props = schema.$defs.edge.properties;
    expect(props.dash.enum).toEqual([...WIRE_DASHES]);
    expect(props.outlineDash.enum).toEqual([...WIRE_DASHES]);
    expect(props.outlineWidth.enum).toEqual([0, 1, 2, 3]);
  });
});

describe('styleFor with the new fields', () => {
  it('leaves an untouched wire exactly as it was: solid, a 1px black edge that follows the run', () => {
    const style = styleFor(edge(), theme.signal, theme);
    expect(style.dash).toBeNull();
    expect(style.dashed).toBe(false);
    expect(style.outlineWidth).toBe(1);
    expect(style.outlineDash).toBe('follow');
  });

  it('keeps a depends wire dashed by kind, and lets an explicit solid override it', () => {
    expect(styleFor(edge({ kind: 'depends' }), theme.signal, theme).dashed).toBe(true);
    expect(styleFor(edge({ kind: 'depends', dash: 'solid' }), theme.signal, theme).dashed).toBe(false);
  });

  it('turns a dash style into a pattern scaled by the run', () => {
    const style = styleFor(edge({ dash: 'dashed', width: 2 }), theme.signal, theme);
    expect(style.dash).toEqual({ on: 4 * style.width, off: 3 * style.width });
  });

  it('draws no outline at width 0, a solid sleeve for solid, its own dashes for a pattern', () => {
    const route: Point[] = [{ x: 0, y: 32 }, { x: 128, y: 32 }];
    expect(outlinePieces(route, styleFor(edge({ outlineWidth: 0 }), theme.signal, theme))).toEqual([]);
    const sleeve = styleFor(edge({ dash: 'dotted', outlineDash: 'solid' }), theme.signal, theme);
    expect(outlinePieces(route, sleeve)).toHaveLength(1);
    expect(runPieces(route, sleeve).length).toBeGreaterThan(5);
    const own = styleFor(edge({ outlineDash: 'dashed', outlineWidth: 2 }), theme.signal, theme);
    const pieces = outlinePieces(route, own);
    expect(pieces.length).toBeGreaterThan(2);
    for (const p of pieces) expect(Math.min(p.w, p.h)).toBe(own.width + 4);
  });
});

describe('lanes with a thick outline', () => {
  it('space by the widest run INCLUDING its own outline', () => {
    const lanes = separateParallel([
      { id: 'thick', points: [{ x: 0, y: 64 }, { x: 160, y: 64 }], width: 2, outline: 3 },
      { id: 'plain', points: [{ x: 0, y: 64 }, { x: 160, y: 64 }], width: 2, outline: 1 }
    ]);
    const ya = lanes.get('thick')![0]!.y;
    const yb = lanes.get('plain')![0]!.y;
    expect(Math.abs(ya - yb)).toBe(2 + 2 * 3 + LANE_GAP);
  });
});
