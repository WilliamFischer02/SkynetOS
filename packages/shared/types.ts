/**
 * Board types. These mirror schema/board.schema.json exactly.
 *
 * The schema is the authority — it is what `npm run validate:board` enforces and what an agent
 * writing board JSON is held to. This file exists so TypeScript agrees with it. When one changes,
 * the other changes in the same commit, or the "data before pixels" rule is already broken.
 */

import type { NodeFrame } from './frames.js';
import type { PaletteToken } from './palette.js';
import type { PrimeStepId } from './prime-steps.js';

export type Hex = `#${string}`;

/**
 * When a node's session briefing is sent. Mirrors `BriefingMode` in
 * src/main/services/launch-args.ts, which is where the briefing is actually composed.
 */
export type BriefingMode = 'none' | 'first' | 'every';

export const NODE_KINDS = [
  'agent.code', 'agent.chat', 'agent.jarvis',
  'drive.room',
  'store.repo', 'store.folder', 'store.cloud',
  'file.document', 'file.exe', 'file.artifact',
  'link.url', 'service.process', 'task.scheduled',
  'monitor.system', 'note.silk', 'group.zone', 'decor.image', 'decor.part'
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_KINDS = ['produces', 'reads', 'depends', 'deploys', 'syncs', 'supervises'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/**
 * The aesthetic furniture of the board: the parts that make it look like a board.
 *
 * Every one is a real sprite cut from the Kenney 1-bit sheet and baked into assets/atlas — see
 * the `decor.*` entries in assets/sprites/manifest.json for the exact cell each came from. They
 * are decoration and nothing else: no target, no click, no state. What they buy is that a room
 * with three components in it still reads as hardware rather than as three boxes on a grid.
 *
 * The `led_*` parts carry a two-frame pulse, which is the only thing on the board that moves for
 * its own sake. They stop under reducedMotion like everything else.
 */
export const DECOR_PARTS = [
  'via', 'screw', 'testpoint',
  'junction', 'elbow', 'tee', 'junction_thin', 'elbow_thin',
  'grille', 'pads', 'padgrid', 'fins', 'cap', 'ribbon',
  'fiducial', 'panel',
  'led_ok', 'led_warn', 'led_fault', 'led_idle', 'led_white'
] as const;
export type DecorPart = (typeof DECOR_PARTS)[number];

export function isDecorPart(value: string): value is DecorPart {
  return (DECOR_PARTS as readonly string[]).includes(value);
}

export type LaunchMode = 'popout' | 'popout-elevated' | 'embedded' | 'headless';
export type OpenWith = 'explorer' | 'default' | 'browser' | 'terminal' | 'vscode';

/** Grid position, in tiles from the board origin. Never pixels. */
export interface GridPos { x: number; y: number }
/** Footprint, in tiles. */
export interface Footprint { w: number; h: number }

export interface BoardTheme {
  maskDark: Hex;
  maskLight: Hex;
  signal: Hex;
  substrateSeed?: number;
}

export interface BoardGrid {
  /** Always 16. The whole visual language is built on it. */
  tile: 16;
  /** In tiles. */
  width: number;
  height: number;
}

export interface BoardNode {
  id: string;
  /** U4, J2, D7 — a real board's reference designator. Auto-assigned per room. */
  designator?: string;
  kind: NodeKind;
  name: string;
  pos: GridPos;
  footprint?: Footprint;
  tags?: string[];
  notes?: string;
  /** An unpopulated footprint: a TODO printed on the board, a real PCB convention. */
  provisional?: boolean;
  codexRef?: string;

  // agent.code
  cwd?: string;
  launch?: LaunchMode;
  model?: string;
  resume?: boolean;
  initialPrompt?: string;
  mcpServers?: string[];

  /**
   * Named update steps this terminal runs BEFORE handing over — `claude`, `git-fetch`,
   * `npm-install`. Ids only: the shell text lives in packages/shared/prime-steps.ts, because
   * docs/07 forbids board JSON from carrying executable strings. Absent means the safe default;
   * an empty array means "prime nothing".
   */
  prelaunch?: PrimeStepId[];

  /**
   * Directories outside `cwd` that this agent may read and write, passed as `claude --add-dir`.
   *
   * This is how one agent oversees repos scattered across the disk without anything being moved:
   * a chip in C:/dev/SkynetOS can be granted D:/work/OtherThing and treat it as part of the job.
   * Every entry is confirmed against docs/07's dev-root policy on launch, like any other target.
   */
  addDirs?: string[];

  /**
   * Documents the session must read before it does anything, repo-relative and in order.
   *
   * Absent means SkynetOS derives the list from what the node already declares — CLAUDE.md, the
   * `persona` brief, the `codexRef` entry — which is usually the right answer and needs no
   * typing. Set it to take control; set it to `[]` to open with no reading at all.
   */
  readOnLaunch?: string[];

  /**
   * When the session briefing is sent: `none`, `first` (new conversations only, the default and
   * the old `initialPrompt` behaviour), or `every` (re-orient on resume too).
   */
  briefing?: BriefingMode;

  // agent.chat / agent.jarvis / link.url / store.cloud
  url?: string;
  partition?: string;
  persona?: string;

  // drive.room
  boardFile?: string;
  engraving?: string;

  // store.* / file.*
  path?: string;
  localPath?: string;
  remote?: string;
  openWith?: OpenWith;

  // file.artifact
  glob?: string;
  exclude?: string[];
  versionPattern?: string;

  // file.exe
  args?: string[];
  confirmBeforeLaunch?: boolean;

  // service.process
  startCommand?: string;
  port?: number;
  healthUrl?: string;

  // task.scheduled
  schedule?: string;
  action?: Record<string, unknown>;
  enabled?: boolean;

  // note.silk / group.zone
  text?: string;
  size?: 11 | 22;
  members?: string[];

  /**
   * A board id. On a group.zone, draws the outline in that room's signal colour to mark the
   * cluster as related to it. Colour only — no behaviour. See palette.signalOf.
   */
  relation?: string;

  /**
   * The node's WALLPAPER: any image on disk, stretched to fill the whole footprint.
   *
   * Downsampled to the footprint and dithered onto the room's six palette colours, then drawn as
   * the component's face. The source is never copied or modified. See src/main/services/mosaic.ts.
   */
  image?: string;

  /**
   * Which piece of board furniture a `decor.part` is. See DECOR_PARTS.
   */
  part?: DecorPart;

  /**
   * The node's LOGO: a smaller image centred on top of the wallpaper, aspect preserved.
   *
   * Two images per component, because they do different jobs. The wallpaper says what this thing
   * FEELS like and fills the footprint; the logo says what it IS and has to stay recognisable,
   * which means it must not be stretched to a 6x4 rectangle. Sized by `logoBoxTiles` below and
   * given its own bevel so it reads as a badge sitting on the face rather than part of it.
   */
  logo?: string;

  /**
   * What this node prints on the board. All four default to ON and are independent, so a node can
   * be a wallpaper alone, a badge alone, a designator alone, a title alone, or any combination —
   * which is how you keep a dense room readable without renaming anything.
   *
   * `showThumbnail` governs the WALLPAPER and `showLogo` the BADGE, separately, because they are
   * separately useful: a node can carry a recognisable logo on a drawn package with no photograph
   * behind it, or a photograph with no badge over it.
   */
  showDesignator?: boolean;
  showName?: boolean;
  showThumbnail?: boolean;
  showLogo?: boolean;

  /* ── how this node is dressed ───────────────────────────────────────────────────────────── */

  /**
   * The copper that hangs off the edge of this node: pin legs, connector fingers, mounting tabs,
   * a socket ring, a pad array. See NODE_FRAMES in src/renderer/board/component-art.ts.
   *
   * Independent of kind and of whether the node shows a picture — a frame is a styling choice, not
   * a consequence of what a node IS. It draws in a margin OUTSIDE the footprint, the way the
   * nameplate does, so collision and routing still run on the grid the board file describes.
   */
  frame?: NodeFrame;

  /**
   * How important this node is, 0-5, shown as physical height.
   *
   * Each level is two pixels of long shadow cast down and to the right, drawn behind the body. A
   * priority-3 node sits six pixels proud — visible across a room, and never so tall that the
   * board looks like a city. 0 is flat.
   */
  priority?: number;

  /* ── how this node's text is printed ────────────────────────────────────────────────────── */

  /**
   * Colour of the node's printed text — its `note.silk` body, or its nameplate.
   *
   * A palette TOKEN, never a hex string. `signal`, `mask-dark` and `mask-light` mean something
   * different in every room, so a note that says "signal" keeps its room's own accent; one that
   * said `#7FE0B0` would carry SkynetOS's green into a room that is not green. See palette.ts.
   */
  textColor?: PaletteToken;

  /** A 1px outline stamped around every glyph, in this token's colour. Absent means none. */
  textStroke?: PaletteToken;

  /**
   * Print the text on a plate: a filled box with a 1px border and its corner pixels omitted,
   * sized to the text every time it is drawn. What keeps a legend readable where the board is
   * busy — over traces, over a backdrop, under couriers.
   */
  textPlate?: boolean;
  plateColor?: PaletteToken;
  plateBorder?: PaletteToken;

  /**
   * Pulse the text brighter and back along the room's own colour ramp. The text equivalent of
   * `pulseGlow`, and a palette shift for the same reason — docs/02 has no room for a halo.
   */
  textGlow?: boolean;

  /**
   * Animate the wallpaper as a wave of energy travelling outward from the node's centre.
   *
   * Not a glow in the CSS sense — a gradient at low opacity would violate four of docs/02's
   * anti-mush rules at once. It is a palette shift: the room's six colours are already a
   * brightness ramp, and an expanding ring pushes the pixels it crosses one or two rungs up it.
   * Every frame holds exactly the six colours the image already had. See board/glow.ts.
   */
  pulseGlow?: boolean;
}

/** What a node prints on the board, with the defaults applied. */
export interface NodeDisplay {
  designator: boolean;
  name: boolean;
  /** The wallpaper that fills the footprint. */
  thumbnail: boolean;
  /** The badge centred on it. */
  logo: boolean;
}

/**
 * Resolve a node's display toggles. Absent means ON — a node that has never been touched prints
 * everything, which is the behaviour every board had before the toggles existed.
 */
export function displayOf(
  node: Pick<BoardNode, 'showDesignator' | 'showName' | 'showThumbnail' | 'showLogo'>
): NodeDisplay {
  return {
    designator: node.showDesignator !== false,
    name: node.showName !== false,
    thumbnail: node.showThumbnail !== false,
    logo: node.showLogo !== false
  };
}

export interface BoardEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** 2 = normal, 3 = primary. Width means importance, not throughput. */
  width?: 2 | 3;
  waypoints?: [number, number][];
  label?: string;
  /**
   * A board id. Draws this trace's inner strand in that room's signal colour, so a wire that
   * leads somewhere else carries that place's identity. Colour only — no routing effect.
   */
  relation?: string;
}

export interface Board {
  schemaVersion: 1;
  id: string;
  name: string;
  engraving?: string;
  parent?: string | null;
  theme: BoardTheme;
  grid: BoardGrid;
  agentEditPolicy?: 'require-approval' | 'auto';
  /** Board ids this room is related to. Declarative; drives shared colour, nothing else. */
  relatedBoards?: string[];
  nodes: BoardNode[];
  edges: BoardEdge[];
}

/**
 * Default footprints per kind, in tiles. Kept in sync with tools/validate-board.mjs — the
 * validator uses them for its overlap check, the renderer uses them to size a node that
 * declares no explicit footprint, and a placeholder sprite is drawn at exactly this size.
 *
 * note.silk and group.zone are 0x0 because they are printed on the board rather than mounted
 * to it: they occupy no space and never collide with anything.
 */
export const DEFAULT_FOOTPRINT: Record<NodeKind, Footprint> = {
  'agent.jarvis': { w: 8, h: 6 },
  'agent.code': { w: 3, h: 3 },
  'agent.chat': { w: 4, h: 4 },
  'drive.room': { w: 6, h: 4 },
  'store.repo': { w: 4, h: 3 },
  'store.folder': { w: 4, h: 3 },
  'store.cloud': { w: 4, h: 3 },
  'file.document': { w: 2, h: 2 },
  'file.exe': { w: 2, h: 2 },
  'file.artifact': { w: 3, h: 2 },
  'link.url': { w: 2, h: 2 },
  'service.process': { w: 3, h: 2 },
  'task.scheduled': { w: 2, h: 1 },
  'monitor.system': { w: 4, h: 4 },
  'note.silk': { w: 0, h: 0 },
  'group.zone': { w: 0, h: 0 },
  /*
   * A backdrop wants to be big by default — small enough to place, big enough to see. Like the
   * other printed kinds it never collides, so this is a starting size rather than a reservation.
   */
  'decor.image': { w: 12, h: 8 },
  // One tile. A via is one tile on a real board too.
  'decor.part': { w: 1, h: 1 }
};

/**
 * Kinds that are PRINTED on the board rather than MOUNTED to it.
 *
 * They occupy no grid at all: they obstruct nothing, nothing obstructs them, the router does not
 * route around them, the validators do not count them in an overlap, and a drag of one is bounded
 * only by the board edge.
 *
 * This exists because that rule was previously written out five separate times — in
 * `tools/validate-board.mjs`, `board-store.graphProblems`, `layout.findFreeSpace`, `drag.canDrop`
 * and the A* obstacle filter — and adding a kind meant finding all five. Adding `decor.image`
 * missed one and the app refused to load a valid board; adding `decor.part` missed a different one
 * and every trace on the root board started cutting through components. One list.
 */
export const PRINTED_KINDS: readonly NodeKind[] = ['note.silk', 'group.zone', 'decor.image', 'decor.part'];

export function isPrinted(kind: NodeKind): boolean {
  return PRINTED_KINDS.includes(kind);
}

export function footprintOf(node: Pick<BoardNode, 'kind' | 'footprint'>): Footprint {
  return node.footprint ?? DEFAULT_FOOTPRINT[node.kind] ?? { w: 2, h: 2 };
}

/**
 * The largest footprint a node may be scaled to, in tiles.
 *
 * Kind-aware, because "how big may this get" is a different question for a thing MOUNTED on the
 * board than for a thing PRINTED on it. A component is an object you can pick out at a glance and
 * 48 tiles is already three quarters of the root board; a `group.zone` is a bracket drawn around
 * a cluster and is supposed to span a room, which is why MinecraftOS has zones 26 tiles wide. A
 * single cap large enough for the second is no cap at all for the first.
 */
export const MAX_FOOTPRINT = 48;
export const MAX_ZONE_FOOTPRINT = 512;

export function maxFootprintFor(kind: NodeKind): number {
  // A zone is a bracket meant to span a room and a decor image is a backdrop meant to fill one.
  // Both are printed rather than mounted, so neither is bounded by "an object you pick out at a
  // glance" the way a component is.
  if (kind === 'group.zone' || kind === 'decor.image') return MAX_ZONE_FOOTPRINT;
  // A part is drawn at an integer scale of a 16px cell, so it stays crisp but should not be huge.
  if (kind === 'decor.part') return 8;
  return MAX_FOOTPRINT;
}

/**
 * Clamp a requested footprint to something drawable. Whole tiles only — a fractional footprint
 * cannot be represented in board JSON and would put every edge of the component on a half pixel.
 */
export function clampFootprint(fp: Footprint, max: number = MAX_FOOTPRINT): Footprint {
  const clamp = (v: number) => Math.min(max, Math.max(1, Math.round(v)));
  return { w: clamp(fp.w), h: clamp(fp.h) };
}

/**
 * The square, in TILES, that a node's centred logo occupies.
 *
 * Proportional rather than fixed, so the badge reads the same on a 3x3 chip and an 8x6 CPU, and
 * always at least one whole tile so it never lands on a fractional pixel. It is deliberately
 * smaller than the footprint on both axes: a logo that touches the edges is a wallpaper.
 */
export function logoBoxTiles(fp: Footprint): number {
  const shortest = Math.min(fp.w, fp.h);
  if (shortest <= 1) return 1;
  return Math.max(1, Math.min(shortest - 1, Math.floor(shortest * 0.6)));
}

/**
 * The sprite key a node asks the atlas for. The renderer only ever deals in keys — never a file
 * path — so that swapping a kitbash for hand-drawn art is a manifest edit and nothing more.
 * A key with no atlas entry draws as a labelled placeholder rectangle. See docs/05-ASSETS.md.
 */
export function spriteKeyOf(node: Pick<BoardNode, 'kind' | 'part'>, state = 'idle'): string {
  /*
   * A decor part names its own sprite directly and has no states. It is the first kind whose art
   * comes from the atlas rather than from a drawn placeholder, which is the whole point of it:
   * `decor.via` is one cell of a real tilesheet, recoloured to copper by the baker.
   */
  if (node.kind === 'decor.part') {
    return node.part ? `decor.${node.part}` : 'decor.via';
  }
  const byKind: Partial<Record<NodeKind, string>> = {
    'agent.code': 'component.chip_dip',
    'agent.chat': 'component.chip_qfp',
    'agent.jarvis': 'component.cpu_jarvis',
    'drive.room': 'component.ssd_room',
    'store.repo': 'component.hdd',
    'store.folder': 'component.hdd',
    'store.cloud': 'component.jack_link',
    'file.document': 'component.eprom_doc',
    'file.exe': 'component.switch_exe',
    'file.artifact': 'component.cartridge',
    'link.url': 'component.jack_link',
    'service.process': 'component.vreg_service',
    'task.scheduled': 'component.xtal_task',
    'monitor.system': 'component.psu_monitor'
    // decor.image has no package art at all: it IS its picture.
  };
  const base = byKind[node.kind];
  return base ? `${base}.${state}` : `component.unknown.${state}`;
}
