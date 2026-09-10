/**
 * Node frames: the copper that hangs off the edge of a component.
 *
 * Declared here rather than in the renderer because board JSON stores the name and the schema has
 * to enumerate it — and `packages/shared` is the one place both sides may look at. The DRAWING
 * lives in src/renderer/board/component-art.ts, which is where every other pixel of the board is
 * decided.
 *
 * William: "with some nodes you've added an excellent copper leg sort of effect that looks like
 * mini copper wiring cascading from the side of a node; I want a variety of variations of these
 * sorts of effects to be togglable on each node so the user can visually design each node to
 * taste."
 */
export const NODE_FRAMES = [
  'none', 'dip', 'quad', 'bga', 'fingers', 'tabs', 'rails', 'socket', 'castellated'
] as const;
export type NodeFrame = (typeof NODE_FRAMES)[number];

export function isNodeFrame(value: string): value is NodeFrame {
  return (NODE_FRAMES as readonly string[]).includes(value);
}

/** One line each, for the editor's tooltip. */
export const FRAME_BLURB: Record<NodeFrame, string> = {
  none: 'No frame. The node is its own edge.',
  dip: 'Pin legs down the left and right, like a DIP chip. The original copper-leg look.',
  quad: 'Pin legs on all four sides, like a QFP. Reads as a bigger, more central part.',
  bga: 'A pad array peeking out from underneath on every side — a chip whose pins are hidden.',
  fingers: 'Edge-connector fingers along the bottom, like a cartridge.',
  tabs: 'Mounting tabs with holes at the four corners. A bracket, bolted down.',
  rails: 'A power rail across the top and bottom, with vias along it.',
  socket: 'A socket ring around the node — the component sits IN something.',
  castellated: 'Half-holes cut all the way round, like a solder-down module.'
};

/** Height levels a node can be raised to. 0 is flat. */
export const MAX_PRIORITY = 5;
