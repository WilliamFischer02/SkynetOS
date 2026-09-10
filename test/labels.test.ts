import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { footprintOf, type Board } from '../packages/shared/types.js';
import { labelTokens, layoutLabel } from '../src/renderer/board/sprites.js';

/**
 * The board must say "U1 JARVIS", not just "U1".
 *
 * `measure` is injected so this runs in plain Node with no canvas. Departure Mono is monospace at
 * 6px advance per character at 11px, which is what the real renderer measures — so these numbers
 * are the real fit, not an approximation.
 */
const ADVANCE = 6;
const measure = (text: string) => text.length * ADVANCE;
const TILE = 16;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '.snapshots') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.board.json')) out.push(p);
  }
  return out;
}

const boards = walk(join(process.cwd(), 'board')).map(
  (f) => JSON.parse(readFileSync(f, 'utf8')) as Board
);

describe('layoutLabel', () => {
  it('puts designator and name on one line when they fit', () => {
    // JARVIS is 8x6 tiles = 128x96px. "U1 JARVIS" is 9 chars = 54px. Easily fits.
    const layout = layoutLabel('U1', 'JARVIS', 8 * TILE, 6 * TILE, measure);
    expect(layout.kind).toBe('one-line');
    expect(layout.lines).toEqual(['U1 JARVIS']);
  });

  it('uppercases both — board copy is engraved industrial labelling', () => {
    const layout = layoutLabel('u1', 'jarvis', 8 * TILE, 6 * TILE, measure);
    expect(layout.lines[0]).toBe('U1 JARVIS');
  });

  it('wraps a long name on spaces rather than dropping it', () => {
    // "THE OBSERVER" is 72px, wider than a 4x4 chip's 58px of usable width. Wrapping on the
    // space gets it printed; before this it silently fell back to "U1" alone.
    const layout = layoutLabel('U1', 'THE OBSERVER', 4 * TILE, 4 * TILE, measure);
    expect(layout.kind).toBe('stacked');
    expect(layout.lines).toEqual(['U1 THE', 'OBSERVER']);
  });

  it('wraps a hyphenated part number after its hyphens', () => {
    // These names are part numbers with no spaces. A real board breaks them at the hyphen.
    const layout = layoutLabel('U1', 'CC-TQR-ENGINE', 4 * TILE, 4 * TILE, measure);
    expect(layout.kind).toBe('stacked');
    expect(layout.lines).toEqual(['U1 CC-', 'TQR-', 'ENGINE']);
  });

  it('wraps a camelCase repo name at its capitals', () => {
    // "TruthQuestRetro" has no spaces and no hyphens. Splitting at the capitals is the only
    // thing that gets it printed on a 4x3 drive, and it is how the name reads anyway.
    const layout = layoutLabel('S1', 'TruthQuestRetro', 4 * TILE, 3 * TILE, measure);
    expect(layout.kind).toBe('stacked');
    expect(layout.lines).toEqual(['S1 TRUTH', 'QUEST', 'RETRO']);
  });

  it('keeps the designator on the first line, not on a line of its own', () => {
    // A dedicated designator line would need one more row than the footprint has, and the name
    // would be dropped entirely. Wrapping them together is what makes tight footprints work.
    const layout = layoutLabel('U2', 'CC-FORGE', 4 * TILE, 3 * TILE, measure);
    expect(layout.lines[0]!.startsWith('U2')).toBe(true);
    expect(layout.lines.join(' ')).toContain('FORGE');
  });

  it('falls back to the designator alone when the name cannot fit either way', () => {
    // 2x2 = 32x32px, usable 26px wide. Only 4 characters fit.
    const layout = layoutLabel('J1', 'GITHUB', 2 * TILE, 2 * TILE, measure);
    expect(layout.kind).toBe('designator-only');
    expect(layout.lines).toEqual(['J1']);
  });

  it('prints nothing when even the designator will not fit', () => {
    const layout = layoutLabel('U1', 'JARVIS', 1 * TILE, 1 * TILE, measure);
    expect(layout.kind).toBe('none');
    expect(layout.lines).toEqual([]);
  });

  it('prints nothing when there is nothing to print', () => {
    expect(layoutLabel('', undefined, 8 * TILE, 6 * TILE, measure).kind).toBe('none');
    expect(layoutLabel('  ', '  ', 8 * TILE, 6 * TILE, measure).kind).toBe('none');
  });

  it('uses the name alone when a node has no designator', () => {
    const layout = layoutLabel('', 'PSU', 4 * TILE, 4 * TILE, measure);
    expect(layout.lines).toEqual(['PSU']);
  });

  it('splits on whitespace, hyphens and camelCase', () => {
    expect(labelTokens('THE OBSERVER')).toEqual(['THE', 'OBSERVER']);
    expect(labelTokens('CC-TQR-ENGINE')).toEqual(['CC-', 'TQR-', 'ENGINE']);
    expect(labelTokens('TruthQuestRetro')).toEqual(['TRUTH', 'QUEST', 'RETRO']);
    expect(labelTokens('SkynetOS')).toEqual(['SKYNET', 'OS']);
    expect(labelTokens('  spaced   out  ')).toEqual(['SPACED', 'OUT']);
    expect(labelTokens('')).toEqual([]);
  });

  it('never returns a line wider than the usable width', () => {
    for (const w of [1, 2, 3, 4, 6, 8]) {
      for (const h of [1, 2, 3, 4, 6]) {
        const layout = layoutLabel('U12', 'CC-PACEKEEPER', w * TILE, h * TILE, measure);
        for (const line of layout.lines) {
          expect(measure(line), `${w}x${h} produced an overflowing line "${line}"`)
            .toBeLessThanOrEqual(w * TILE - 6);
        }
      }
    }
  });

  it('never returns more lines than fit vertically', () => {
    for (const h of [1, 2, 3, 4, 6]) {
      const layout = layoutLabel('U1', 'JARVIS', 8 * TILE, h * TILE, measure);
      expect(layout.lines.length * 11).toBeLessThanOrEqual(Math.max(0, h * TILE - 6) + 11);
    }
  });
});

describe('every mounted node in the seeded boards gets a readable label', () => {
  const mounted = boards.flatMap((b) =>
    b.nodes
      .filter((n) => n.kind !== 'note.silk' && n.kind !== 'group.zone')
      .map((n) => ({ board: b.id, node: n }))
  );

  it('found nodes to check', () => {
    expect(mounted.length).toBeGreaterThan(40);
  });

  it('shows at least the designator on every node that has one', () => {
    const unlabelled: string[] = [];
    for (const { board, node } of mounted) {
      if (!node.designator) continue;
      const fp = footprintOf(node);
      const layout = layoutLabel(node.designator, node.name, fp.w * TILE, fp.h * TILE, measure);
      if (!layout.lines.length) unlabelled.push(`${board}/${node.id} (${fp.w}x${fp.h})`);
    }
    // A 2x1 task.scheduled crystal is genuinely too small for print — a real crystal has no
    // room for a part number either. Assert on the SHAPE rather than a list of ids, so adding
    // another node cannot quietly start losing labels without this failing.
    expect(unlabelled.every((entry) => entry.endsWith('(2x1)'))).toBe(true);
  });

  it('shows the full name on every node big enough for it', () => {
    const named = mounted.filter(({ node }) => {
      const fp = footprintOf(node);
      return fp.w >= 4 && fp.h >= 3 && node.designator;
    });
    expect(named.length).toBeGreaterThan(5);
    for (const { board, node } of named) {
      const fp = footprintOf(node);
      const layout = layoutLabel(node.designator!, node.name, fp.w * TILE, fp.h * TILE, measure);
      // Compare against the TOKENS, not the raw string: a wrapped name is printed across lines
      // and `TruthQuestRetro` legitimately appears as `TRUTH` `QUEST` `RETRO`. What matters is
      // that every piece of the name reached the board, and that the designator is still first.
      const printed = layout.lines.join(' ');
      for (const token of labelTokens(node.name)) {
        expect(printed, `${board}/${node.id} lost "${token}" from its name`).toContain(token);
      }
      expect(layout.lines[0], `${board}/${node.id} lost its designator`)
        .toContain(node.designator!.toUpperCase());
    }
  });
});
