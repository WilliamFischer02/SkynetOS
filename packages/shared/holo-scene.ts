/**
 * The hologram's scene: what orbits the globe and what is drawn at its centre.
 *
 * William, 2026-09-26: every file, folder and program gets a permanent coordinate on a gridded
 * globe; when Claude accesses one it is drawn in from its pinned position, "maximised" at the
 * centre with a rendering of its contents, and sent back when the next one comes. Documents scroll
 * on a tall sheet of paper, code appears in a small terminal being typed, models are crude
 * wireframes.
 *
 * This file is the CONTRACT between the producer (src/main/services/activity-feed.ts, which tails
 * Claude Code transcripts and decides what deserves the centre) and the renderer
 * (src/renderer/hologram/, WebGL2). Types and pure helpers only. Main pushes a `HoloScene` to the
 * hologram window on the `hologram:scene` event whenever it changes; the renderer keeps the last
 * one and animates towards it.
 */

export type HoloKind = 'doc' | 'code' | 'model' | 'folder' | 'exe' | 'image' | 'other';

/** One thing pinned to the globe. `lat`/`lon` in degrees, fixed forever for a given path. */
export interface HoloItem {
  /** Stable id: the normalised path. */
  id: string;
  path: string;
  /** Short display name: the file or folder name. */
  name: string;
  kind: HoloKind;
  lat: number;
  lon: number;
  /** A small PNG as a data URL (Electron's file icon), when one could be read. */
  icon?: string;
  /** Higher wins the centre when several accesses land close together. */
  priority: number;
  /** ms since epoch of the last access. */
  lastSeen: number;
}

export type HoloAction = 'read' | 'edit' | 'write' | 'run' | 'open' | 'browse' | 'search';

export interface PaperContent {
  type: 'paper';
  /** Already wrapped to the paper's column width by the producer. */
  lines: string[];
  /** Line index the scroll starts at (the edited region, or 0). */
  scrollFrom: number;
  title: string;
}

/** A text edit, coalesced so the terminal types a little and never flickers. */
export interface TerminalOp {
  /** ms offset from `HoloFocus.since` at which the op begins. */
  at: number;
  line: number;
  text: string;
  kind: 'insert' | 'delete' | 'replace';
}

export interface TerminalContent {
  type: 'terminal';
  /** The lines before the ops play. */
  lines: string[];
  ops: TerminalOp[];
  title: string;
  language?: string;
}

export interface WireframeContent {
  type: 'wire';
  /** Unit-cube normalised vertices. */
  verts: [number, number, number][];
  edges: [number, number][];
  title: string;
}

export interface FolderContent {
  type: 'folder';
  entries: { name: string; kind: HoloKind }[];
  title: string;
}

export interface NoneContent { type: 'none'; title: string }

export type HoloContent = PaperContent | TerminalContent | WireframeContent | FolderContent | NoneContent;

export interface HoloFocus {
  item: HoloItem;
  content: HoloContent;
  /** ms since epoch when this item took the centre. */
  since: number;
  action: HoloAction;
}

export interface HoloScene {
  /** Recent items, most recent first, capped by the producer (about 24). */
  orbit: HoloItem[];
  focus: HoloFocus | null;
  /** How many accesses are waiting behind the focus; the renderer may show it as a faint count. */
  queue: number;
  /** The Claude Code session the focus came from, for the caption. */
  session?: string;
  /**
   * Every Claude Code session seen in the last ten minutes, most recent first (the filtered one is
   * kept even when older). More than one turns the caption's session label into a picker
   * (packages/shared/holo-sessions.ts).
   */
  sessions: HoloSession[];
  /** The session the globe is showing alone (`hologram:setSessionFilter`); absent or null is all of them. */
  filter?: string | null;
}

/** One Claude Code session, for the picker: `SkynetOS · 4a2cf476`. */
export interface HoloSession {
  id: string;
  /** The cwd's last folder and the id's first eight characters. */
  label: string;
  /** ms since epoch of its last transcript line. */
  lastSeen: number;
}

export const EMPTY_SCENE: HoloScene = { orbit: [], focus: null, queue: 0, sessions: [] };

/**
 * Stream mode (docs/07 § Streaming safety): the globe still shows WHAT was touched, never what
 * it says. Every centre panel becomes a bare `none` with its title; pins, icons and names stay.
 */
export function redactScene(scene: HoloScene): HoloScene {
  if (!scene.focus || scene.focus.content.type === 'none') return scene;
  return { ...scene, focus: { ...scene.focus, content: { type: 'none', title: scene.focus.content.title } } };
}

/** Priority by what happened and to what. Writes outrank reads; documents outrank folders. */
export function accessPriority(kind: HoloKind, action: HoloAction): number {
  const byAction: Record<HoloAction, number> = { write: 5, edit: 5, run: 4, open: 4, read: 3, search: 1, browse: 1 };
  const byKind: Record<HoloKind, number> = { doc: 2, code: 2, model: 2, image: 2, exe: 2, folder: 1, other: 1 };
  return byAction[action] * 10 + byKind[kind];
}
