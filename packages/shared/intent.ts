/**
 * Intent resolution: spoken or gestured words in, a typed command out.
 *
 * The Face's brief, 2026-09-11: "One intent bus, several producers: voice, gesture, the panel, you."
 * The bus it feeds already exists — `Command` in commands.ts, applied in main with an inverse and
 * one shared history. So this is not a new layer. It is the missing half of the old one: the part
 * that turns "move the stalker left two" into `{ type: 'node.move', nodeId: 'a1_stalker', pos }`.
 *
 * Everything here is PURE. No IPC, no store, no clock, no randomness. That is deliberate:
 *
 *   - it is the only part of voice control that can be tested without a microphone, and it is
 *     where every interesting mistake lives (a misheard name, an ambiguous room, a missing number);
 *   - gesture will reach the same function with words assembled from a pointing hand and a held
 *     pose, so the two producers cannot drift apart;
 *   - the DECISION about what a voice may do is not taken here. The caller supplies the actor, and
 *     main applies docs/07's policy to it. A parser that quietly attributed itself to `user` would
 *     be laundering authority, which is exactly what `callAsAgent` exists to prevent.
 *
 * What it deliberately does NOT do: destroy anything. A heard deletion comes back as `confirm`,
 * never as a command, because docs/07 gives that decision to a human in that exchange and a
 * microphone is not a human. Nothing in here can produce an approved destructive request.
 */

import type { BoardEdge, BoardNode, EdgeKind } from './types.js';
import { EDGE_KINDS } from './types.js';
import type { Actor, CommandRequest } from './commands.js';

/** What the resolver is allowed to know: one room, and what is selected in it. */
export interface IntentContext {
  boardId: string;
  nodes: BoardNode[];
  edges: BoardEdge[];
  /** "it", "that", "this one". */
  selectedId?: string | null;
  /** Who is speaking, decided by the caller and enforced in main. Never assumed here. */
  actor: Actor;
}

/** Things that change the view rather than the board. No undo entry, nothing written. */
export type ViewAction =
  /**
   * Hand the board to the cameras, or take it back. William, 2026-09-11: "if any variation of the
   * phrase 'give me manual control', 'manual controls on', 'activate manual controls', or 'give me
   * the controls' — anything like that, I want it to activate gesture control."
   */
  | { type: 'gestureControl'; on: boolean }
  /** Close the microphone by voice. Opening it by voice is impossible by construction: it is not listening. */
  | { type: 'voiceControl'; on: boolean }
  /** Open or leave THE MATRIX. */
  | { type: 'matrix'; open: boolean }
  | { type: 'select'; nodeId: string }
  | { type: 'clearSelection' }
  | { type: 'open'; nodeId: string }
  | { type: 'descend'; nodeId: string }
  | { type: 'ascend' }
  | { type: 'zoom'; to: 'in' | 'out' | number }
  | { type: 'undo' }
  | { type: 'redo' };

export type Intent =
  /** Ready for the bus. */
  | { kind: 'command'; request: CommandRequest; say: string }
  /** Destructive. Needs a human's yes in this exchange; the request carries no approval. */
  | { kind: 'confirm'; request: CommandRequest; say: string; because: string }
  /** Renderer only. */
  | { kind: 'view'; action: ViewAction; say: string }
  /** Two or more nodes fit the words equally well. Ask, do not guess. */
  | { kind: 'ambiguous'; say: string; candidates: { id: string; name: string }[] }
  /**
   * Not acted on. `understood: false` means the words were not a command at all — voice sends those to
   * the Face as a question. `true` means a command was recognised but could not be carried out ("I do not
   * see anything here called…"), which is not a question and is not sent anywhere.
   */
  | { kind: 'unknown'; say: string; heard: string; understood: boolean };

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20
};

/**
 * `to`, `too` and `for` are in that table because whisper hears them for `two` and `four` — but
 * they are also ordinary words, so they only count as numbers where a number is expected.
 */
const DIRECTIONS: Record<string, { dx: number; dy: number }> = {
  left: { dx: -1, dy: 0 }, west: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }, east: { dx: 1, dy: 0 },
  up: { dx: 0, dy: -1 }, north: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 }, south: { dx: 0, dy: 1 }
};

/** Words that carry no identity: said by people, and inserted by whisper. */
const FILLER = new Set([
  'the', 'a', 'an', 'my', 'that', 'node', 'nodes', 'chip', 'box', 'one', 'thing', 'please',
  'jarvis', 'component', 'part'
]);

const PRONOUNS = new Set(['it', 'that', 'this', 'this one', 'that one', 'the selection', 'selected']);

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (text: string): string[] => (text ? normalise(text).split(' ') : []);

/** Strip the wake word and the politeness people put in front of a command. */
export function stripPreamble(text: string): string {
  let out = normalise(text);
  const openers = [
    'jarvis', 'hey jarvis', 'ok jarvis', 'okay jarvis',
    'could you', 'can you', 'would you', 'will you', 'please', 'i want you to', 'i need you to',
    'go ahead and', 'let s', 'lets'
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const opener of openers) {
      if (out === opener) return '';
      if (out.startsWith(`${opener} `)) {
        out = out.slice(opener.length + 1);
        changed = true;
      }
    }
  }
  return out.trim();
}

/** A number, spoken or digital. `undefined` when the words are not a count. */
function countOf(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const t = normalise(text);
  if (/^\d+$/.test(t)) return Number(t);
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  return undefined;
}

/**
 * How well a phrase names a node, 0 (not at all) to 100 (exactly).
 *
 * Whisper does not hear board names cleanly: "THE STALKER" comes back as "the stalker", "stalker",
 * or "stocker". So this scores on tokens rather than characters, ignores filler, and knows a
 * designator when it hears one.
 */
export function scoreNode(phrase: string, node: BoardNode): number {
  const query = words(phrase).filter((w) => !FILLER.has(w));
  if (!query.length) return 0;
  const nameWords = words(node.name).filter((w) => !FILLER.has(w));
  const name = nameWords.join(' ');
  const asked = query.join(' ');
  if (!name) return 0;

  if (name === asked) return 100;
  if (node.designator && normalise(node.designator) === asked) return 96;
  if (node.id && normalise(node.id) === asked) return 94;

  const inName = query.filter((w) => nameWords.includes(w)).length;
  const inQuery = nameWords.filter((w) => query.includes(w)).length;
  // Every word asked for is in the name: "stalker" for "THE STALKER".
  if (inName === query.length) return 78 + Math.round((inName / nameWords.length) * 12);
  // Every word of the name was said, with extra words around it.
  if (inQuery === nameWords.length) return 70 + Math.round((inQuery / query.length) * 8);
  if (name.includes(asked) || asked.includes(name)) return 62;

  // Partial words: "minecraft" for "MINECRAFTOS", "deduct" for "DEDUCTIONOS".
  const prefixHits = query.filter((q) => nameWords.some((w) => w.startsWith(q) || q.startsWith(w))).length;
  if (prefixHits) return 40 + Math.round((prefixHits / query.length) * 15);

  const tagHit = (node.tags ?? []).some((tag) => query.includes(normalise(tag)));
  return tagHit ? 35 : 0;
}

interface Match {
  node?: BoardNode;
  candidates: BoardNode[];
  /** The best score seen, for the caller's own confidence reporting. */
  score: number;
}

/** The node a phrase names, the selection for a pronoun, or the ones it could equally mean. */
export function matchNode(phrase: string, ctx: IntentContext): Match {
  const asked = normalise(phrase);
  if (PRONOUNS.has(asked)) {
    const selected = ctx.nodes.find((n) => n.id === ctx.selectedId);
    return { node: selected, candidates: [], score: selected ? 100 : 0 };
  }
  const scored = ctx.nodes
    .map((node) => ({ node, score: scoreNode(phrase, node) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { candidates: [], score: 0 };
  const best = scored[0]!;
  // Close seconds are an ambiguity, not a winner: two nodes named "...PLUSH" both fit "plush".
  const rivals = scored.filter((s) => s.score >= best.score - 6);
  if (rivals.length > 1) return { candidates: rivals.map((r) => r.node), score: best.score };
  return { node: best.node, candidates: [], score: best.score };
}

/*
 * Manual control, spoken. Written as a list of whole-utterance patterns rather than one clever
 * regex: every phrasing William asked for is legible here, and a new one is a line rather than a
 * puzzle. `normalise` has already folded case and stripped apostrophes by the time these run, so
 * "that's enough" arrives as "that s enough".
 */
const MANUAL_ON: RegExp[] = [
  /^(?:give|hand)(?: me)?(?: the)? (?:manual |gesture |hand |air )?controls?$/,
  /^(?:activate|engage|enable|start|begin|turn on|switch on|i want|let me have|take)(?: the)? (?:manual|gesture|hand|air)[ -]?(?:controls?|mode)$/,
  /^(?:manual|gesture|hand|air)[ -]?(?:controls?|mode)(?: on| now)?$/,
  /^(?:let me drive|my hands|i ll drive|i will drive)$/
];

const MANUAL_OFF: RegExp[] = [
  /^(?:manual|gesture|hand|air)[ -]?(?:controls?|mode) off$/,
  /^(?:turn off|switch off|disable|stop|end|exit|deactivate|disengage|release)(?: the)?(?: (?:manual|gesture|hand|air))?[ -]?(?:controls?|mode)$/,
  /^(?:hands off|that s enough|i m done|you drive|give me the keyboard)$/,
  /*
   * These two need no object: nothing else in the grammar is a bare "disengage". "stop" and
   * "release" deliberately still require one — "stop" alone is far likelier to be about a running
   * session than about the cameras.
   */
  /^(?:disengage|deactivate)$/
];

const nameOf = (node: BoardNode): string => (node.designator ? `${node.designator} ${node.name}` : node.name);

const unknown = (heard: string, say: string, understood = true): Intent => ({ kind: 'unknown', say, heard, understood });

const ambiguous = (candidates: BoardNode[]): Intent => ({
  kind: 'ambiguous',
  say: `Which one: ${candidates.slice(0, 4).map((n) => n.name).join(', or ')}?`,
  candidates: candidates.map((n) => ({ id: n.id, name: n.name }))
});

/** A wire id that is not already taken on this board. */
export function edgeIdFor(from: string, to: string, edges: BoardEdge[]): string {
  const base = `w_${from}_${to}`.replace(/[^a-zA-Z0-9_]/g, '');
  if (!edges.some((e) => e.id === base)) return base;
  for (let n = 2; n < 100; n++) {
    const tried = `${base}_${n}`;
    if (!edges.some((e) => e.id === tried)) return tried;
  }
  return `${base}_${edges.length + 1}`;
}

/**
 * The whole grammar, in order. First match wins.
 *
 * It is a grammar rather than a model on purpose: it is auditable, it cannot invent a verb, and
 * every phrase it accepts is written down here where docs/07 can be checked against it. When it
 * does not understand, it says so and changes nothing — the correct failure for a microphone.
 */
export function resolveIntent(heard: string, ctx: IntentContext): Intent {
  const text = stripPreamble(heard);
  if (!text) return unknown(heard, 'I heard nothing I could act on.', false);

  const request = (command: CommandRequest['command'], label: string): CommandRequest => ({
    command,
    actor: ctx.actor,
    label
  });

  // ── THE MATRIX: the globe of end products ────────────────────────────────────────────────
  if (/^(open|show( me)?|enter|go to|go into) (the )?matrix$/.test(text)) {
    return { kind: 'view', action: { type: 'matrix', open: true }, say: 'The MATRIX.' };
  }
  if (/^(close|leave|exit|hide|get out of) (the )?matrix$/.test(text)) {
    return { kind: 'view', action: { type: 'matrix', open: false }, say: 'Back to the board.' };
  }

  // ── voice: it can close its own microphone, and can never open it ─────────────────────────
  if (/^(stop listening( to me)?|mute( yourself)?|voice off|turn off voice( control)?|close the microphone)$/.test(text)) {
    return { kind: 'view', action: { type: 'voiceControl', on: false }, say: 'Voice off. The microphone is closed.' };
  }

  // ── manual control: give the board to the hands, or take it back ──────────────────────────
  // Tested first, so "manual controls off" can never be read as a request to switch them on.
  if (MANUAL_OFF.some((pattern) => pattern.test(text))) {
    return { kind: 'view', action: { type: 'gestureControl', on: false }, say: 'Manual control off. The keyboard has it.' };
  }
  if (MANUAL_ON.some((pattern) => pattern.test(text))) {
    return { kind: 'view', action: { type: 'gestureControl', on: true }, say: 'Manual control. Your hands have the board.' };
  }

  // ── undo, redo ────────────────────────────────────────────────────────────────────────────
  if (/^(undo|undo that|take that back|never mind that)$/.test(text)) {
    return { kind: 'view', action: { type: 'undo' }, say: 'Undone.' };
  }
  if (/^(redo|redo that|put it back)$/.test(text)) {
    return { kind: 'view', action: { type: 'redo' }, say: 'Redone.' };
  }

  // ── the view: up, down, zoom ───────────────────────────────────────────────────────────────
  if (/^(go up|come back|back out|ascend|up a level|leave the room|out)$/.test(text)) {
    return { kind: 'view', action: { type: 'ascend' }, say: 'Going up.' };
  }
  // "Zoom in on the board" is how whisper wrote it back on 2026-09-12: the object is allowed and ignored.
  const zoom = /^zoom (in|out)(?: on (?:the board|that|this|it|here))?$/.exec(text);
  if (zoom) return { kind: 'view', action: { type: 'zoom', to: zoom[1] as 'in' | 'out' }, say: `Zooming ${zoom[1]}.` };
  const zoomTo = /^zoom (?:to |at )?(\d+|one|two|three|four|five|six|eight)(?: x| times)?$/.exec(text);
  if (zoomTo) {
    const level = countOf(zoomTo[1]);
    if (level) return { kind: 'view', action: { type: 'zoom', to: level }, say: `Zoom ${level}x.` };
  }

  if (/^(deselect|clear (the )?selection|select nothing|nothing selected)$/.test(text)) {
    return { kind: 'view', action: { type: 'clearSelection' }, say: 'Cleared.' };
  }

  // ── move ──────────────────────────────────────────────────────────────────────────────────
  const move = /^(?:move|nudge|shift|push|slide|drag) (?:(.+?) )?(left|right|up|down|west|east|north|south)(?: by)?(?: (\S+))?(?: tiles?| squares?| spaces?)?$/.exec(text);
  if (move) {
    const [, who, direction, amount] = move;
    const target = matchNode(who ?? 'it', ctx);
    if (target.candidates.length) return ambiguous(target.candidates);
    if (!target.node) {
      return unknown(heard, who ? `I do not see anything here called "${who}".` : 'Nothing is selected, so there is nothing to move.');
    }
    const step = countOf(amount) ?? 1;
    const delta = DIRECTIONS[direction!]!;
    const pos = {
      x: Math.max(0, target.node.pos.x + delta.dx * step),
      y: Math.max(0, target.node.pos.y + delta.dy * step)
    };
    if (pos.x === target.node.pos.x && pos.y === target.node.pos.y) {
      return unknown(heard, `${nameOf(target.node)} is already against that edge.`);
    }
    return {
      kind: 'command',
      request: request({ type: 'node.move', boardId: ctx.boardId, nodeId: target.node.id, pos }, `voice: move ${direction}`),
      say: `${nameOf(target.node)}, ${step} ${direction}.`
    };
  }

  // ── rename ────────────────────────────────────────────────────────────────────────────────
  const rename = /^(?:rename|retitle) (.+?) (?:to|as) (.+)$/.exec(text);
  if (rename) {
    const target = matchNode(rename[1]!, ctx);
    if (target.candidates.length) return ambiguous(target.candidates);
    if (!target.node) return unknown(heard, `I do not see anything here called "${rename[1]}".`);
    const name = rename[2]!.toUpperCase();
    return {
      kind: 'command',
      request: request(
        { type: 'node.update', boardId: ctx.boardId, nodeId: target.node.id, patch: { name } },
        'voice: rename'
      ),
      say: `${nameOf(target.node)} is now ${name}.`
    };
  }

  // ── connect ───────────────────────────────────────────────────────────────────────────────
  const connect = /^(?:connect|wire|link|join) (.+?) (?:to|into|with) (.+?)(?: (?:with|as) (?:an? )?(produces|reads|depends|deploys|syncs|supervises)(?: wire| trace)?)?$/.exec(text);
  if (connect) {
    const from = matchNode(connect[1]!, ctx);
    if (from.candidates.length) return ambiguous(from.candidates);
    if (!from.node) return unknown(heard, `I do not see anything here called "${connect[1]}".`);
    const to = matchNode(connect[2]!, ctx);
    if (to.candidates.length) return ambiguous(to.candidates);
    if (!to.node) return unknown(heard, `I do not see anything here called "${connect[2]}".`);
    if (from.node.id === to.node.id) return unknown(heard, 'A wire needs two different ends.');
    const kind = (connect[3] as EdgeKind | undefined) ?? 'depends';
    if (!EDGE_KINDS.includes(kind)) return unknown(heard, `${kind} is not a kind of wire.`);
    const already = ctx.edges.find((e) => e.from === from.node!.id && e.to === to.node!.id);
    if (already) return unknown(heard, `${nameOf(from.node)} already runs to ${nameOf(to.node)}.`);
    return {
      kind: 'command',
      request: request(
        {
          type: 'edge.create',
          boardId: ctx.boardId,
          edge: { id: edgeIdFor(from.node.id, to.node.id, ctx.edges), from: from.node.id, to: to.node.id, kind }
        },
        'voice: connect'
      ),
      say: `${nameOf(from.node)} to ${nameOf(to.node)}, ${kind}.`
    };
  }

  // ── delete: never done, always asked ──────────────────────────────────────────────────────
  const remove = /^(?:delete|remove|destroy|get rid of|kill) (.+)$/.exec(text);
  if (remove) {
    const target = matchNode(remove[1]!, ctx);
    if (target.candidates.length) return ambiguous(target.candidates);
    if (!target.node) return unknown(heard, `I do not see anything here called "${remove[1]}".`);
    return {
      kind: 'confirm',
      request: request({ type: 'node.delete', boardId: ctx.boardId, nodeId: target.node.id }, 'voice: delete'),
      say: `Deleting ${nameOf(target.node)}. Confirm on screen.`,
      because: 'docs/07: a deletion needs a human approval in the same exchange, and a microphone is not one.'
    };
  }

  // ── go into a room, select, open ──────────────────────────────────────────────────────────
  const go = /^(?:go|jump|descend|dive|move) (?:in|into|to|inside|down into) (.+)$/.exec(text);
  if (go) {
    const target = matchNode(go[1]!, ctx);
    if (target.candidates.length) return ambiguous(target.candidates);
    if (!target.node) return unknown(heard, `I do not see anything here called "${go[1]}".`);
    if (target.node.kind === 'drive.room') {
      return { kind: 'view', action: { type: 'descend', nodeId: target.node.id }, say: `Into ${target.node.name}.` };
    }
    return { kind: 'view', action: { type: 'select', nodeId: target.node.id }, say: `${nameOf(target.node)} is not a room. Selected it.` };
  }

  const select = /^(?:select|pick|highlight|focus|find|show me) (.+)$/.exec(text);
  if (select) {
    const target = matchNode(select[1]!, ctx);
    if (target.candidates.length) return ambiguous(target.candidates);
    if (!target.node) return unknown(heard, `I do not see anything here called "${select[1]}".`);
    return { kind: 'view', action: { type: 'select', nodeId: target.node.id }, say: `${nameOf(target.node)}.` };
  }

  /*
   * Opening is a view action, not a bus command, and it stays subject to every launch rule
   * docs/07 already imposes: an out-of-root target, an executable, or `confirmAllLaunches` still
   * raises the same dialog it raises for a click. Voice does not get an exemption from it.
   */
  const open = /^(?:open|launch|run|start|bring up) (.+)$/.exec(text);
  if (open) {
    const target = matchNode(open[1]!, ctx);
    if (target.candidates.length) return ambiguous(target.candidates);
    if (!target.node) return unknown(heard, `I do not see anything here called "${open[1]}".`);
    return { kind: 'view', action: { type: 'open', nodeId: target.node.id }, say: `Opening ${nameOf(target.node)}.` };
  }

  return unknown(heard, `I did not understand "${text}".`, false);
}
