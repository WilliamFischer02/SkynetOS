import type { Board, BoardNode, GridPos, NodeKind } from '@shared/types.js';
import { DEFAULT_FOOTPRINT } from '@shared/types.js';

/**
 * Making a new node from nothing but a kind.
 *
 * Drop-in ingestion (services/ingest.ts) covers "I dragged a real thing onto the board". This
 * covers the other half William asked for: the sorting furniture. A `group.zone` bracket and a
 * `note.silk` heading do not correspond to anything on disk, so there is nothing to drag — and
 * without a way to make one, the brackets around MinecraftOS's mod clusters were permanent
 * fixtures of a file you had to hand-edit.
 *
 * Everything here is a plain object. It goes through the same `node.create` command, the same
 * schema validation and the same undo stack as any other mutation — this module decides WHAT to
 * create, never how it is written.
 */

/**
 * The id prefix per kind, matching the convention the seeded boards already use: `u` for the
 * things with jurisdiction, `s` for storage, `d` for drives, `a` for artifacts, `j` for jacks.
 */
function prefixFor(kind: NodeKind): string {
  if (kind.startsWith('agent')) return 'u';
  if (kind === 'store.repo' || kind === 'store.folder' || kind === 'store.cloud') return 's';
  if (kind === 'drive.room') return 'd';
  if (kind === 'file.artifact') return 'a';
  if (kind === 'link.url') return 'j';
  if (kind === 'service.process') return 'v';
  if (kind === 'task.scheduled') return 't';
  if (kind === 'monitor.system') return 'm';
  if (kind === 'note.silk') return 'n';
  if (kind === 'group.zone') return 'g';
  if (kind === 'decor.image') return 'bg';
  return 'f';
}

/**
 * The designator letter per kind — a real board's reference designators, so U is a chip, J is a
 * connector, D is a drive. `note.silk` and `group.zone` get none: they are PRINTED on the board,
 * not mounted to it, and a printed bracket with a part number would be nonsense.
 */
function designatorLetterFor(kind: NodeKind): string | null {
  if (kind.startsWith('agent')) return 'U';
  if (kind === 'drive.room') return 'D';
  if (kind === 'store.repo' || kind === 'store.folder') return 'S';
  if (kind === 'store.cloud' || kind === 'link.url') return 'J';
  if (kind === 'file.artifact') return 'A';
  if (kind === 'file.document' || kind === 'file.exe') return 'F';
  if (kind === 'service.process') return 'V';
  if (kind === 'task.scheduled') return 'T';
  if (kind === 'monitor.system') return 'M';
  return null;
}

/** A free id of the form `<prefix>_<base>`, `<prefix>_<base>_2`, and so on. */
export function freeNodeId(board: Board, kind: NodeKind, base: string): string {
  const prefix = prefixFor(kind);
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'node';
  const taken = new Set(board.nodes.map((n) => n.id));
  const first = `${prefix}_${slug}`;
  if (!taken.has(first)) return first;
  for (let i = 2; i < 500; i++) {
    const candidate = `${prefix}_${slug}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${prefix}_${slug}_${Date.now()}`;
}

/**
 * The next free designator for a kind, per room.
 *
 * Scans what is actually on this board rather than counting, so deleting U2 and adding a chip
 * reuses U2 instead of jumping to U4. On a real board the designators are dense, and a gap reads
 * as "something used to be here".
 */
export function nextDesignator(board: Board, kind: NodeKind): string | undefined {
  const letter = designatorLetterFor(kind);
  if (!letter) return undefined;
  const taken = new Set(
    board.nodes
      .map((n) => n.designator)
      .filter((d): d is string => Boolean(d))
      .filter((d) => d.startsWith(letter))
  );
  for (let i = 1; i < 1000; i++) {
    const candidate = `${letter}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return undefined;
}

/** The default name a new node of this kind gets. Uppercase, because it goes on silkscreen. */
function defaultName(kind: NodeKind): string {
  switch (kind) {
    case 'group.zone': return 'NEW CLUSTER';
    case 'note.silk': return 'NEW NOTE';
    case 'agent.code': return 'NEW AGENT';
    case 'agent.chat': return 'NEW CONVERSATION';
    case 'agent.jarvis': return 'JARVIS';
    case 'drive.room': return 'NEW ROOM';
    case 'store.repo': return 'NEW REPO';
    case 'store.folder': return 'NEW FOLDER';
    case 'store.cloud': return 'NEW CLOUD';
    case 'file.document': return 'NEW DOCUMENT';
    case 'file.exe': return 'NEW PROGRAM';
    case 'file.artifact': return 'NEW BUILD';
    case 'link.url': return 'NEW LINK';
    case 'service.process': return 'NEW SERVICE';
    case 'task.scheduled': return 'NEW TASK';
    case 'monitor.system': return 'MONITOR';
    case 'decor.image': return 'BACKDROP';
    default: return 'NEW NODE';
  }
}

/**
 * Build a new node of `kind` at `pos`.
 *
 * It is deliberately created UNBOUND and `provisional`. A store.repo with no path resolves broken,
 * and that is correct and useful: the board shows an unpopulated footprint — a real PCB convention
 * for "something goes here" — until you point it at something. Prime directive 1 says never
 * fabricate a target, so a new node points at nothing and says so.
 */
export function makeNode(board: Board, kind: NodeKind, pos: GridPos): BoardNode {
  const name = defaultName(kind);
  const node: BoardNode = {
    id: freeNodeId(board, kind, name),
    kind,
    name,
    pos: { x: Math.max(0, Math.round(pos.x)), y: Math.max(0, Math.round(pos.y)) }
  };

  const designator = nextDesignator(board, kind);
  if (designator) node.designator = designator;

  /*
   * Printed kinds need a starting shape, because they have no default footprint worth speaking of
   * (both are 0x0 in DEFAULT_FOOTPRINT — they occupy no grid and never collide). A bracket you
   * cannot see is a bracket you cannot grab, so a new zone arrives big enough to hold something
   * and is then dragged to fit.
   */
  if (kind === 'group.zone') {
    node.footprint = { w: 10, h: 6 };
    node.members = [];
  }
  if (kind === 'note.silk') {
    node.text = 'NEW NOTE';
    node.size = 11;
  }
  if (kind === 'decor.image') {
    // A backdrop with no name printed over it: the picture is the point, and a nameplate floating
    // above a background element reads as a mistake.
    node.showName = false;
    node.showDesignator = false;
  }

  // Anything that binds to a real target starts explicitly unpopulated rather than pretending.
  const bindsToSomething = DEFAULT_FOOTPRINT[kind].w > 0;
  if (bindsToSomething && kind !== 'monitor.system') node.provisional = true;

  return node;
}
