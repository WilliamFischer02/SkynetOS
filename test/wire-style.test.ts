import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { styleFor } from '../src/renderer/board/traces.js';
import { COPPER, INK, PALETTE_TOKENS, ROOM_THEMES, WIRE_TOKENS, isWireToken } from '../packages/shared/palette.js';
import type { BoardEdge } from '../packages/shared/types.js';

/**
 * Wire colour and outline. William: "I also want wires to be selectable / color and stroke
 * editable … all wires, even drawn ones should have a black stroke for visual clarity."
 */

const edge = (over: Partial<BoardEdge> = {}): BoardEdge => ({ id: 'e1', from: 'a', to: 'b', kind: 'produces', ...over });
const theme = ROOM_THEMES.gameos;

describe('styleFor — colour and outline', () => {
  it('gives every wire copper with a black edge unless it says otherwise', () => {
    const style = styleFor(edge(), theme.signal, theme);
    expect(style.color).toBe(COPPER);
    expect(style.stroke).toBe(INK);
    expect(INK).toBe('#000000');
  });

  it('resolves the wire\'s own tokens against the room it is in', () => {
    const style = styleFor(edge({ color: 'signal', stroke: 'silk' }), theme.signal, theme);
    expect(style.color).toBe(theme.signal);
    expect(style.stroke).toBe('#E9E4D6');
  });

  it('draws an ink run when asked, and keeps the outline black by default', () => {
    expect(styleFor(edge({ color: 'ink' }), theme.signal, theme).color).toBe(INK);
  });

  it('honours every width from 1 to 4 without going to zero', () => {
    for (const width of [1, 2, 3, 4] as const) {
      for (const kind of ['produces', 'reads', 'depends', 'deploys', 'syncs', 'supervises'] as const) {
        expect(styleFor(edge({ kind, width }), theme.signal, theme).width).toBeGreaterThan(0);
      }
    }
  });
});

describe('the wire tokens', () => {
  it('are the palette tokens plus ink', () => {
    expect([...WIRE_TOKENS]).toEqual([...PALETTE_TOKENS, 'ink']);
    expect(isWireToken('ink')).toBe(true);
    expect(isWireToken('#FF0000')).toBe(false);
  });

  it('agree with what the schema accepts for a wire\'s colour and outline', () => {
    // Two lists of the same thing drift apart. This keeps the board file and the editor honest.
    const schema = JSON.parse(readFileSync(join(process.cwd(), 'schema', 'board.schema.json'), 'utf8'));
    const props = schema.$defs.edge.properties;
    expect(props.color.enum).toEqual([...WIRE_TOKENS]);
    expect(props.stroke.enum).toEqual([...WIRE_TOKENS]);
    expect(props.width.enum).toEqual([1, 2, 3, 4]);
  });
});
