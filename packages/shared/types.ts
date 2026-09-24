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
  'agent.code', 'agent.audit', 'agent.chat', 'agent.jarvis', 'agent.prompt', 'agent.prompt-to-node',
  'drive.room',
  'store.repo', 'store.folder', 'store.explorer', 'store.cloud',
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
/**
 * How far an aesthetic asset is turned, in degrees clockwise.
 *
 * Quarter turns ONLY. An arbitrary angle would resample the pixels and produce the one blurred
 * thing on the board, which docs/02 §Anti-mush treats as a crash-severity bug. A quarter turn is a
 * pure permutation of whole pixels — it is exact, and it is also what board furniture wants: an
 * elbow, a tee, a ribbon and a grille all have an orientation and no need for any angle between.
 */
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

export function isRotation(value: unknown): value is Rotation {
  return (ROTATIONS as readonly unknown[]).includes(value);
}

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
/**
 * What a click on a node does.
 *
 * `office` is document-only: it hands an online document to the DESKTOP Word/Excel/PowerPoint
 * through the `ms-word:` family of URI schemes instead of opening it in a browser tab. It needs a
 * direct document URL and falls back to the browser, with an explanation, when it does not get
 * one. See packages/shared/office.ts.
 */
export type OpenWith = 'explorer' | 'default' | 'browser' | 'terminal' | 'vscode' | 'office' | 'notepadpp' | 'obsidian';

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
  /**
   * Start this agent's sessions with Claude Code's own Remote Control (`claude --remote-control`),
   * so the session can be read and driven from the Claude app on a phone. Off unless set. The
   * reach is William's Anthropic login, not anything SkynetOS opens: see docs/07 "Sessions from
   * the phone".
   */
  remoteControl?: boolean;
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

  // agent.prompt — the quick-chat box. See packages/shared/prompt.ts.
  /** The agent.jarvis or agent.chat node this box sends to. Absent: the board's JARVIS head. */
  promptTarget?: string;
  /** What Enter does: `send` (the default) or `draft` (leave it in the conversation's own box). */
  promptMode?: 'send' | 'draft';

  // drive.room
  boardFile?: string;
  engraving?: string;

  // store.* / file.*
  path?: string;
  /**
   * store.explorer only: the folder its window opens at, inside `path`. Absent means the root. Set
   * from the window's SET AS RESTING FOLDER button, so it is an ordinary, undoable node.update.
   */
  restPath?: string;
  localPath?: string;
  remote?: string;
  openWith?: OpenWith;

  // file.artifact
  glob?: string;
  exclude?: string[];
  versionPattern?: string;

  /**
   * Quarter-turn rotation for an aesthetic asset — `decor.part` and `decor.image`.
   *
   * Applied where the pixels are made, never by rotating a sprite's transform: a part turns in UV
   * space through the atlas texture's own `rotate`, and a backdrop is baked turned by the mosaic
   * service. Both are exact. A transform rotation by `Math.PI / 2` is not — the float is off by
   * ~6e-17, which is enough to resample every pixel.
   */
  rotation?: Rotation;
  /**
   * How big the logo badge is, as a percentage of its default box. 10-300, default 100.
   *
   * The default box is derived from the footprint (`logoBoxTiles`), which is a reasonable guess and
   * nothing more — a wordmark wants to be wide and small, a character portrait wants to be big.
   * This is the dial for that, and it scales the box the image is FITTED INTO, so the aspect ratio
   * is never touched.
   */
  logoScale?: number;

  // file.exe
  args?: string[];
  confirmBeforeLaunch?: boolean;
  /**
   * Ask Windows to start this program as administrator.
   *
   * Opt in per node, never inherited and never a default — docs/07: "elevation is user-only", and
   * SkynetOS itself stays non-elevated. Setting this means a UAC prompt on every single launch,
   * which is not avoidable for an app that is not itself elevated, and is the correct trade: the
   * alternative is a board editor running as administrator all day.
   *
   * Confirmed every time regardless of `confirmBeforeLaunch`, because the question it answers —
   * "do you want to run this at all" — is not the question elevation asks.
   */
  elevated?: boolean;

  // service.process
  startCommand?: string;
  port?: number;
  healthUrl?: string;

  // task.scheduled
  schedule?: string;
  action?: Record<string, unknown>;
  enabled?: boolean;
  /**
   * task.scheduled, as the journal: the Obsidian vault its note is written into. Set, and a click
   * writes today's SkynetOS journal note there. See src/main/services/journal.ts.
   */
  journalVault?: string;
  /** Vault-relative folder for the journal's notes. Empty: the vault's daily-notes folder, `/SkynetOS`. */
  journalFolder?: string;
  /**
   * task.scheduled with `{"type":"agent.run"}`: which agent.code node the run starts a fresh
   * session on (by id, on this board or the root board). Empty: the root board's JARVIS Prime.
   * See packages/shared/schedule.ts.
   */
  taskTarget?: string;
  /** A markdown brief inside the SkynetOS repo, read at run time, e.g. `codex/briefs/morning-maintenance.md`. */
  taskBrief?: string;
  /** Extra instructions appended after the brief. */
  taskPrompt?: string;
  /** How long after a missed slot (the app was closed) the task still runs ONCE on opening. Default 4, max 48. */
  catchUpHours?: number;

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
   * Where the logo comes from: `file` (the `logo` image above, the default), `avatar` (the JARVIS
   * avatar's still face, assets/avatar/jarvis/idle.png) or `none`. `showLogo: false` still hides
   * whichever it is. See packages/shared/logo-source.ts.
   */
  logoSource?: 'file' | 'avatar' | 'avatar-live' | 'none';
  /**
   * For a GIF wallpaper or logo: play it (the default) or hold its first frame. Each frame is
   * dithered onto the room's palette like any image; see packages/shared/gif.ts for the caps.
   */
  imageAnimate?: boolean;

  /**
   * The JARVIS face window beside this node's window (services/avatar-window.ts). Only JARVIS
   * iterations have one: the Face, JARVIS Prime, and anything tagged `jarvis`
   * (packages/shared/avatar-window.ts `isJarvisIteration`). `false` switches it off for this node;
   * it never grants a face to a node that is not JARVIS. Absent means on.
   */
  avatarWindow?: boolean;

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

  /*
   * Effect modifiers and the effects added on 2026-09-11. William: "more checkboxes that enable
   * different animated / visual effects like the light pulse, and when those effects are enabled
   * color and speed modifiers for the animation." Speeds are percentages (100 = the tuned
   * default, 25 to 400) so they stay whole numbers in the board file. Colours are palette tokens.
   * See src/renderer/board/effects.ts.
   */
  /**
   * monitor.system: draw the live system-performance widget on the node's face. Default on.
   * Off shows the node's own wallpaper and logo like any other component. William: "the psu /
   * live data widgets should have a togglable switch for 'display system performance graphics',
   * otherwise it should show the selected images."
   */
  showSystemGraphics?: boolean;

  /** Pulse glow speed, percent. */
  pulseSpeed?: number;
  /** The colour at the pulse's crest. Absent: two rungs up the room's own ramp. */
  pulseColor?: PaletteToken;
  /** Text glow speed, percent. */
  textGlowSpeed?: number;
  /** The colour at the text glow's peak. Absent: two rungs up the room's own ramp. */
  textGlowColor?: PaletteToken;
  /** A run of light travelling clockwise round the node's edge. */
  chase?: boolean;
  chaseColor?: PaletteToken;
  chaseSpeed?: number;
  /** A line sweeping down across the node's face. */
  scan?: boolean;
  scanColor?: PaletteToken;
  scanSpeed?: number;
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

/**
 * A wire's stroke pattern. William: "more wire type variations (dotted and dashed and solid strokes
 * and fills, stroke width modifier". Drawn as whole-pixel rectangles along the route, never as an
 * antialiased dashed line; see src/renderer/board/wire-geometry.ts.
 */
export const WIRE_DASHES = ['solid', 'dashed', 'dotted'] as const;
export type WireDash = (typeof WIRE_DASHES)[number];

export const ANCHOR_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type AnchorSide = (typeof ANCHOR_SIDES)[number];

/**
 * Where a wire meets a node, pinned by hand: a side, and how far along it (0 = the side's start,
 * top-left going clockwise for top/right, and the left or top end for bottom/left; 1 = its end).
 * A fraction rather than a tile, so the pin stays at the same place on the node when it is moved or
 * resized. William: "reposition both endpoints of a wire to a desired point along a nodes edge and
 * it sticks to that point".
 */
export interface WireAnchor {
  side: AnchorSide;
  offset: number;
}

export interface BoardEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** The run's stroke pattern. Absent: solid, except a `depends` wire, which is dashed by kind. */
  dash?: WireDash;
  /** The outline's own pattern. Absent: the outline follows the run, dash for dash. */
  outlineDash?: WireDash;
  /** The black edge's width in px, 0 to 3. 0 draws no outline. Absent: 1. */
  outlineWidth?: 0 | 1 | 2 | 3;
  /** Where the wire leaves `from`, pinned by hand. Absent: the router picks. */
  fromAnchor?: WireAnchor;
  /** Where the wire arrives at `to`, pinned by hand. Absent: the router picks. */
  toAnchor?: WireAnchor;
  /** Run width in px, 1 to 4. 2 = normal, 3 = primary. Width means importance, not throughput. */
  width?: 1 | 2 | 3 | 4;
  /**
   * The copper run's colour, as a wire token (see WIRE_TOKENS in palette.ts), never a hex, so a
   * board cannot name an off-palette colour and `signal` stays each room's own accent. Absent
   * means copper.
   */
  color?: string;
  /** The outline's colour, as a wire token. Absent means ink: every wire carries a black edge. */
  stroke?: string;
  waypoints?: [number, number][];
  label?: string;
  /**
   * A board id. Draws this trace's inner strand in that room's signal colour, so a wire that
   * leads somewhere else carries that place's identity. Colour only — no routing effect.
   */
  relation?: string;
}

/**
 * A room's overall look, on top of its theme. Every field optional; absent means the board exactly
 * as it was drawn before this existed. See packages/shared/look.ts and docs/03 §Board look.
 */
export interface BoardLook {
  /** Whole-board hue rotation, degrees, -180..180. */
  hue?: number;
  /** Percent, 0..200. 100 is unchanged. */
  saturation?: number;
  /** Percent, 50..150. 100 is unchanged. */
  brightness?: number;
  /** Percent, 50..150. 100 is unchanged. */
  contrast?: number;
  /** A dithered, pixel-art darkening toward the screen edges. */
  vignette?: boolean;
  /** 1..4. How far in the dither reaches and how dense it gets at the corners. */
  vignetteStrength?: number;
  /** A wire token (palette token or `ink`). Absent means ink. */
  vignetteColor?: string;
  /** A square image, tiled across the whole board in place of the procedural substrate. */
  tileImage?: string;
  /** The tiled background is used only while this is on. Off keeps the path for later. */
  tileEnabled?: boolean;
  /** Integer screen scale of one tile, 1..4. */
  tileScale?: number;
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
  /** Whole-board colour, vignette and tiled background. Absent means the default look. */
  look?: BoardLook;
  nodes: BoardNode[];
  edges: BoardEdge[];
  /**
   * Recommended nodes: JARVIS's sketches of what should go here next, drawn as phantoms with a
   * tick and a cross. Not nodes — nothing resolves, nothing collides, nothing activates — until
   * William approves one, which turns it into a real node in one undoable command. At most
   * MAX_PHANTOMS_PER_BOARD (packages/shared/phantoms.ts). See docs/03 §Phantoms.
   */
  phantoms?: Phantom[];
}

/** A proposed wire from a phantom to a node that already exists. */
export interface PhantomLink {
  to: string;
  kind: EdgeKind;
}

export interface Phantom {
  id: string;
  kind: NodeKind;
  /** What the real node would be called. */
  name: string;
  /** Why it belongs here, in a sentence or two. Shown on the phantom's plate. */
  description: string;
  pos: GridPos;
  footprint?: Footprint;
  /** Binding and appearance fields the real node gets on approval: path, url, cwd, frame… */
  fields?: Partial<BoardNode>;
  connect?: PhantomLink[];
  /** Who sketched it: 'user', 'jarvis', or an agent's name. */
  proposedBy: string;
  /** ISO timestamp. */
  proposedAt: string;
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
  // A drive audit is a Claude Code chip with a whole drive under it: a size up, so it reads as one.
  'agent.audit': { w: 4, h: 4 },
  'agent.chat': { w: 4, h: 4 },
  // A message box is wide and short, like the one it imitates: room for two lines and a toolbar.
  'agent.prompt': { w: 11, h: 3 },
  // The same box plus one row for its PROMPT → NODE title tab, so the text keeps the same room.
  'agent.prompt-to-node': { w: 11, h: 4 },
  'drive.room': { w: 6, h: 4 },
  'store.repo': { w: 4, h: 3 },
  'store.folder': { w: 4, h: 3 },
  // A window onto a folder: wide enough to read as a screen rather than as another drive.
  'store.explorer': { w: 6, h: 4 },
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
    'agent.audit': 'component.chip_audit',
    'agent.chat': 'component.chip_qfp',
    'agent.prompt': 'component.prompt_box',
    'agent.prompt-to-node': 'component.prompt_to_node',
    'agent.jarvis': 'component.cpu_jarvis',
    'drive.room': 'component.ssd_room',
    'store.repo': 'component.hdd',
    'store.folder': 'component.hdd',
    'store.explorer': 'component.explorer',
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
