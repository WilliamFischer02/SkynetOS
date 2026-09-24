/**
 * Recommended nodes — "phantoms".
 *
 * William: "add the ability for you (yourself) to 'sketch' / place confirmable placeholders for
 * other nodes to add to the board / connections to make - these will appear as phantom objects with
 * a title / description of what you think the recommended node for there would be, then a check or
 * x I can select to approve or delete a phantom. You may recommend up to 4 new nodes at a time per
 * room / board."
 *
 * A phantom is a SUGGESTION, stored in the board file beside the nodes but never among them: it
 * resolves nothing, collides with nothing a real node cares about, and cannot be activated. Its
 * whole life is three commands on the bus:
 *
 *   phantom.propose   anyone — William or an agent. Refused past MAX_PHANTOMS_PER_BOARD.
 *   phantom.dismiss   William, or an agent withdrawing its own. Removes a suggestion; no real
 *                     node, trace or file is touched, so it is not a destructive command.
 *   phantom.approve   William ONLY. Creates the real node and its traces and removes the phantom,
 *                     in one command, so one Ctrl+Z puts the phantom back exactly as it was.
 *
 * Everything here is pure and tested (test/phantoms.test.ts). Main decides ids and designators
 * with the same factory `node:add` uses, then hands the finished node to `approvedBoard`.
 */

import {
  EDGE_KINDS,
  NODE_KINDS,
  PRINTED_KINDS,
  footprintOf,
  type Board,
  type BoardEdge,
  type BoardNode,
  type Footprint,
  type GridPos,
  type NodeKind,
  type Phantom,
  type PhantomLink
} from './types.js';
import { fieldsFor, missingRequired } from './node-fields.js';

/** The cap, per board. Enforced here, in the schema (`maxItems`), and stated to every agent. */
export const MAX_PHANTOMS_PER_BOARD = 4;
export const PHANTOM_DESCRIPTION_MAX = 400;
export const PHANTOM_LINKS_MAX = 4;

const ID_PATTERN = /^[a-z0-9_]+$/;

/** Identity is the phantom's own business, not something its `fields` may override. */
const IDENTITY_KEYS: ReadonlySet<string> = new Set(['id', 'kind', 'name', 'pos', 'designator', 'footprint']);

/**
 * What a phantom may pre-fill on the node it becomes: exactly what the node editor offers for that
 * kind, minus identity. The same list the form is built from, so a phantom cannot carry a field a
 * human could not have typed.
 */
export function phantomFieldKeys(kind: NodeKind): string[] {
  return fieldsFor(kind).map((f) => f.key as string).filter((k) => !IDENTITY_KEYS.has(k));
}

function isMounted(kind: NodeKind): boolean {
  return !PRINTED_KINDS.includes(kind);
}

export function phantomFootprint(phantom: Pick<Phantom, 'kind' | 'footprint'>): Footprint {
  return footprintOf({ kind: phantom.kind, footprint: phantom.footprint });
}

function cells(pos: GridPos, fp: Footprint): string[] {
  const out: string[] = [];
  for (let y = pos.y; y < pos.y + fp.h; y++) for (let x = pos.x; x < pos.x + fp.w; x++) out.push(`${x},${y}`);
  return out;
}

/** Grid cells taken by mounted nodes and by other mounted phantoms, with who holds each. */
function occupancy(board: Board, exceptPhantomId?: string): Map<string, string> {
  const taken = new Map<string, string>();
  for (const node of board.nodes) {
    if (!isMounted(node.kind)) continue;
    for (const cell of cells(node.pos, footprintOf(node))) taken.set(cell, node.id);
  }
  for (const other of board.phantoms ?? []) {
    if (other.id === exceptPhantomId || !isMounted(other.kind)) continue;
    for (const cell of cells(other.pos, phantomFootprint(other))) taken.set(cell, other.id);
  }
  return taken;
}

/**
 * Everything wrong with a phantom on this board, as sentences. Empty means it may be proposed.
 *
 * A mounted phantom must sit in FREE space: it is a picture of a component that will be placed
 * exactly there, and a suggestion drawn on top of a chip is a suggestion that cannot be approved.
 */
export function phantomProblems(board: Board, phantom: Phantom): string[] {
  const problems: string[] = [];
  if (!ID_PATTERN.test(phantom.id)) problems.push(`phantom id "${phantom.id}" must be lowercase letters, digits and _`);
  if (!(NODE_KINDS as readonly string[]).includes(phantom.kind)) problems.push(`"${phantom.kind}" is not a node kind`);
  if (!phantom.name?.trim()) problems.push('a phantom needs a name');
  else if (phantom.name.length > 40) problems.push(`name is ${phantom.name.length} characters; the most is 40`);
  if (!phantom.description?.trim()) problems.push('a phantom needs a description: why it belongs here');
  else if (phantom.description.length > PHANTOM_DESCRIPTION_MAX) {
    problems.push(`description is ${phantom.description.length} characters; the most is ${PHANTOM_DESCRIPTION_MAX}`);
  }
  if (!Number.isInteger(phantom.pos?.x) || !Number.isInteger(phantom.pos?.y) || phantom.pos.x < 0 || phantom.pos.y < 0) {
    problems.push('pos must be whole, non-negative tiles');
  }
  if (phantom.footprint && (
    !Number.isInteger(phantom.footprint.w) || !Number.isInteger(phantom.footprint.h) ||
    phantom.footprint.w < 1 || phantom.footprint.h < 1 || phantom.footprint.w > 512 || phantom.footprint.h > 512
  )) {
    problems.push('footprint must be whole tiles, 1 to 512');
  }
  if (problems.length) return problems;

  const allowed = new Set(phantomFieldKeys(phantom.kind));
  for (const key of Object.keys(phantom.fields ?? {})) {
    if (!allowed.has(key)) problems.push(`"${key}" is not a field a ${phantom.kind} can be given`);
  }

  const links = phantom.connect ?? [];
  if (links.length > PHANTOM_LINKS_MAX) problems.push(`at most ${PHANTOM_LINKS_MAX} proposed traces per phantom`);
  const seen = new Set<string>();
  for (const link of links) {
    if (seen.has(link.to)) problems.push(`"${link.to}" is linked twice`);
    seen.add(link.to);
    if (!board.nodes.some((n) => n.id === link.to)) problems.push(`no node "${link.to}" on this board to wire to`);
    if (!(EDGE_KINDS as readonly string[]).includes(link.kind)) problems.push(`"${link.kind}" is not a trace kind (${EDGE_KINDS.join(', ')})`);
  }

  const fp = phantomFootprint(phantom);
  if (isMounted(phantom.kind)) {
    if (phantom.pos.x + fp.w > board.grid.width || phantom.pos.y + fp.h > board.grid.height) {
      problems.push('it would extend past the board edge');
    } else {
      const taken = occupancy(board, phantom.id);
      const clash = cells(phantom.pos, fp).map((c) => taken.get(c)).find(Boolean);
      if (clash) problems.push(`it would sit on top of "${clash}" — pick free space`);
    }
  }
  return problems;
}

/**
 * The nearest free spot for a phantom, spiralling out from where it was asked for. Printed kinds
 * take the spot as given, clamped to the board — they never collide with anything.
 */
export function findPhantomSpot(
  board: Board,
  kind: NodeKind,
  footprint: Footprint,
  preferred: GridPos
): GridPos | null {
  const clampX = (x: number) => Math.max(0, Math.min(board.grid.width - footprint.w, Math.round(x)));
  const clampY = (y: number) => Math.max(0, Math.min(board.grid.height - footprint.h, Math.round(y)));
  const start = { x: clampX(preferred.x), y: clampY(preferred.y) };
  if (!isMounted(kind)) return start;

  const taken = occupancy(board);
  const fits = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x + footprint.w > board.grid.width || y + footprint.h > board.grid.height) return false;
    return cells({ x, y }, footprint).every((c) => !taken.has(c));
  };
  if (fits(start.x, start.y)) return start;
  const maxRadius = Math.max(board.grid.width, board.grid.height);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (fits(start.x + dx, start.y + dy)) return { x: start.x + dx, y: start.y + dy };
      }
    }
  }
  return null;
}

/** `ph_<slug>`, unique against both phantoms and nodes so an approved one can never collide. */
export function freePhantomId(board: Board, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'node';
  const taken = new Set([...(board.phantoms ?? []).map((p) => p.id), ...board.nodes.map((n) => n.id)]);
  if (!taken.has(`ph_${slug}`)) return `ph_${slug}`;
  for (let i = 2; i < 500; i++) if (!taken.has(`ph_${slug}_${i}`)) return `ph_${slug}_${i}`;
  return `ph_${slug}_${Date.now()}`;
}

/** What a proposer supplies. The id, the timestamp and the final position are the app's to decide. */
export interface PhantomProposal {
  kind: NodeKind;
  name: string;
  description: string;
  pos: GridPos;
  footprint?: Footprint;
  fields?: Partial<BoardNode>;
  connect?: PhantomLink[];
  /** Who is sketching: an agent's name. Ignored for William, who is always 'user'. */
  proposedBy?: string;
}

/**
 * Turn a proposal into a phantom for this board: a fresh id, a timestamp, the nearest free spot to
 * where it was asked for, and an honest signature. An agent may name itself; it may not sign as
 * William, because "user" is what decides who may withdraw it.
 */
export function phantomFromProposal(
  board: Board,
  proposal: PhantomProposal,
  actor: 'user' | 'jarvis' | 'agent',
  now: string
): Phantom {
  const fp = phantomFootprint(proposal);
  const spot = findPhantomSpot(board, proposal.kind, fp, proposal.pos ?? { x: 0, y: 0 });
  if (!spot) throw new Error('NO FREE GRID SPACE ON THIS BOARD FOR THAT RECOMMENDATION');
  const signed = proposal.proposedBy?.trim().slice(0, 40);
  const proposedBy = actor === 'user' ? 'user' : signed && signed.toLowerCase() !== 'user' ? signed : 'jarvis';
  const phantom: Phantom = {
    id: freePhantomId(board, proposal.name ?? ''),
    kind: proposal.kind,
    name: proposal.name,
    description: proposal.description,
    pos: spot,
    proposedBy,
    proposedAt: now
  };
  if (proposal.footprint) phantom.footprint = { ...proposal.footprint };
  if (proposal.fields && Object.keys(proposal.fields).length) phantom.fields = { ...proposal.fields };
  if (proposal.connect?.length) phantom.connect = proposal.connect.map((l) => ({ to: l.to, kind: l.kind }));
  return phantom;
}

/** The board with one more phantom. Throws, with a sentence, if it cannot have it. */
export function withPhantom(board: Board, phantom: Phantom): Board {
  const current = board.phantoms ?? [];
  if (current.some((p) => p.id === phantom.id)) throw new Error(`PHANTOM ID ALREADY EXISTS — "${phantom.id}"`);
  if (current.length >= MAX_PHANTOMS_PER_BOARD) {
    throw new Error(
      `THIS BOARD ALREADY HAS ${current.length} RECOMMENDED NODES — THE MOST IS ${MAX_PHANTOMS_PER_BOARD}. ` +
      'Withdraw one that no longer applies, or wait for William to approve or dismiss one.'
    );
  }
  const problems = phantomProblems(board, phantom);
  if (problems.length) throw new Error(`PHANTOM REFUSED — ${problems.join('; ')}`);
  return { ...board, phantoms: [...current, phantom] };
}

/** The board without a phantom, and the phantom that was removed (so the inverse can restore it). */
export function withoutPhantom(board: Board, phantomId: string): { next: Board; removed: Phantom } {
  const current = board.phantoms ?? [];
  const removed = current.find((p) => p.id === phantomId);
  if (!removed) throw new Error(`NO SUCH RECOMMENDED NODE — "${phantomId}"`);
  const rest = current.filter((p) => p.id !== phantomId);
  const next: Board = { ...board };
  if (rest.length) next.phantoms = rest;
  else delete next.phantoms;
  return { next, removed };
}

/**
 * The real node a phantom becomes, built over `base` — a node from the same factory `node:add`
 * uses, so its id and designator follow the board's conventions.
 *
 * Only the fields the editor offers for the kind are carried over. It stays provisional exactly
 * while something the kind requires is still missing: a suggestion with a verified path arrives
 * bound, one without arrives as an honest unpopulated footprint.
 */
export function nodeFromPhantom(phantom: Phantom, base: BoardNode): BoardNode {
  const node: BoardNode = { ...base, kind: phantom.kind, name: phantom.name, pos: { ...phantom.pos } };
  if (phantom.footprint) node.footprint = { ...phantom.footprint };
  const allowed = new Set(phantomFieldKeys(phantom.kind));
  const writable = node as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(phantom.fields ?? {})) {
    if (allowed.has(key) && value !== undefined && value !== null) writable[key] = value;
  }
  if (missingRequired(node).length || phantom.fields?.provisional === true) node.provisional = true;
  else delete node.provisional;
  return node;
}

/**
 * The traces a phantom asked for, from its new node to each target that still exists. A target
 * deleted since the sketch is skipped rather than failing the whole approval.
 */
export function edgesFromPhantom(board: Board, phantom: Phantom, nodeId: string): BoardEdge[] {
  const taken = new Set(board.edges.map((e) => e.id));
  const out: BoardEdge[] = [];
  for (const link of phantom.connect ?? []) {
    if (!board.nodes.some((n) => n.id === link.to)) continue;
    let i = 1;
    while (taken.has(`e${i}`)) i++;
    taken.add(`e${i}`);
    out.push({ id: `e${i}`, from: nodeId, to: link.to, kind: link.kind });
  }
  return out;
}

/** Approve: the phantom goes, its node and traces arrive. One command, one undo. */
export function approvedBoard(
  board: Board,
  phantomId: string,
  node: BoardNode,
  edges: readonly BoardEdge[]
): { next: Board; phantom: Phantom } {
  const { next, removed } = withoutPhantom(board, phantomId);
  if (next.nodes.some((n) => n.id === node.id)) throw new Error(`NODE ID ALREADY EXISTS — "${node.id}"`);
  const edgeIds = new Set(next.edges.map((e) => e.id));
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(`TRACE ID ALREADY EXISTS — "${edge.id}"`);
    edgeIds.add(edge.id);
  }
  return {
    next: { ...next, nodes: [...next.nodes, node], edges: [...next.edges, ...edges] },
    phantom: removed
  };
}

/**
 * The inverse of approve: take the node and every trace on it back off, and put the phantom back.
 * Removing a real node is destructive, so this command is in DESTRUCTIVE — reachable through undo
 * (which the human already approved) and through nothing else without approval.
 */
export function unapprovedBoard(board: Board, phantom: Phantom, nodeId: string): Board {
  if (!board.nodes.some((n) => n.id === nodeId)) throw new Error(`NO SUCH NODE — "${nodeId}"`);
  if ((board.phantoms ?? []).some((p) => p.id === phantom.id)) throw new Error(`PHANTOM ID ALREADY EXISTS — "${phantom.id}"`);
  return {
    ...board,
    nodes: board.nodes.filter((n) => n.id !== nodeId),
    edges: board.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
    phantoms: [...(board.phantoms ?? []), phantom]
  };
}

/**
 * Who may do what to a phantom. Checked by the command bus, the only place that writes.
 *
 * Approval is William's tick on the board and nothing else: an agent that could approve its own
 * suggestion would be an agent that adds nodes with extra steps and a fake audit trail. An agent may
 * withdraw a suggestion it made, never one William made.
 */
export function phantomActorRefusal(
  type: string,
  actor: 'user' | 'jarvis' | 'agent',
  phantom?: Phantom
): string | null {
  if (actor === 'user') return null;
  if (type === 'phantom.approve' || type === 'phantom.unapprove') {
    return 'ONLY WILLIAM CAN APPROVE A RECOMMENDED NODE — the tick on the board is the approval, and no tool can press it';
  }
  if (type === 'phantom.dismiss' && phantom?.proposedBy === 'user') {
    return "AN AGENT MAY WITHDRAW ITS OWN RECOMMENDATIONS, NOT WILLIAM'S";
  }
  return null;
}
