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
import { parseDesktopCommand, parseReachCommand, type AppEntry, type DesktopPlan, type DictateTargetRequest, type HologramSplitRequest } from './desktop.js';
import {
  VOICE_DELETION,
  VOICE_DELETION_REFUSAL,
  boardAnswer,
  boardWrite,
  matchAcrossBoards,
  matchRoom,
  moveBetweenRoomsRefusal,
  parseMoveToRoom,
  parseNotes,
  rawValue,
  whichOne,
  type BoardHit,
  type BoardOp,
  type RoomTarget
} from './board-voice.js';
import type { HologramControl, HologramControlId, HologramDropdown, HologramPanel } from './hologram-control.js';

/** What the resolver is allowed to know: one room, and what is selected in it. */
export interface IntentContext {
  boardId: string;
  nodes: BoardNode[];
  edges: BoardEdge[];
  /** "it", "that", "this one". */
  selectedId?: string | null;
  /** Who is speaking, decided by the caller and enforced in main. Never assumed here. */
  actor: Actor;
  /**
   * Desktop control (docs/11): the programs a spoken name can mean, and how many monitors there
   * are. Absent or empty means no sentence becomes a desktop plan, and "open X" is the board's.
   */
  apps?: readonly AppEntry[];
  monitors?: number;
  /**
   * 2026-09-27, the board by voice (packages/shared/board-voice.ts): every node on every board,
   * from the renderer's cached index. Absent means this room only, as before.
   */
  boards?: readonly BoardHit[];
  /** Inside a room (the stack is deeper than the root): "go back" and "up" ascend. */
  inRoom?: boolean;
  /** A read-back board edit is waiting for "go" or "no" (src/renderer/ui/boardVoice.ts). */
  pendingEdit?: boolean;
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
  /**
   * Send words to the Face (the claude.ai conversation), and only because William said so: "ask
   * the face …", "tell the face …". Since 2026-09-24 an unrecognised sentence is answered by JARVIS
   * himself (docs/11 § Conversation); this is the one way a sentence still reaches claude.ai.
   */
  | { type: 'faceSend'; text: string }
  /** Open or leave THE MATRIX. */
  | { type: 'matrix'; open: boolean }
  /**
   * "Jarvis, stop." Speech stops, a running desktop plan halts, the caption clears: what Esc does
   * in the hologram window. Not the microphone: that is "stop listening", which closes it.
   */
  | { type: 'stop' }
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
  /**
   * The desktop, not the board: open a program on a monitor, place a window, open a site. Runs
   * through `desktop:run` (user-only), which refuses unless William has switched desktop control
   * on. Made only when the words name a program in the catalogue or a known site, so a board node
   * called the same thing as nothing installed still opens as a node.
   */
  | { kind: 'desktop'; plan: DesktopPlan; say: string }
  /**
   * A control in the JARVIS Voice window, by voice: a panel, a dropdown, a switch, a button. Sent
   * through the user-only `hologram:control`; the renderer presses the control with that id
   * exactly as a click would (packages/shared/hologram-control.ts).
   */
  | { kind: 'hologram'; control: HologramControl; say: string }
  /**
   * A saved desktop action, by name: "do the morning setup". Main matches the name against what
   * TRAIN ACTION recorded, says which one it will run, and runs it under the desktop switch.
   */
  | { kind: 'action'; name: string; say: string }
  /**
   * 2026-09-27: the board by voice, on any board (board-voice.ts): go to a room, select, open,
   * inspect or zoom to a node, a rename or a note READ BACK before it lands, or the "go" / "no"
   * that answers a read-back. Never destructive: `boardWrite` builds no DESTRUCTIVE command.
   */
  | { kind: 'board'; op: BoardOp; say: string }
  /** 2026-09-27: aim dictation at a window, press Enter there, or stop (`dictate:setTarget`). */
  | { kind: 'dictate'; request: DictateTargetRequest; say: string }
  /** 2026-09-27: a chip's terminal left on monitor one, JARVIS beside it (`hologram:split`). */
  | { kind: 'split'; request: HologramSplitRequest; say: string }
  /** Two or more nodes fit the words equally well. Ask, do not guess. */
  | { kind: 'ambiguous'; say: string; candidates: { id: string; name: string }[] }
  /**
   * Not acted on. `understood: false` means the words were not a command at all — voice sends those to
   * the Face as a question. `true` means a command was recognised but could not be carried out ("I do not
   * see anything here called…"), which is not a question and is not sent anywhere.
   */
  | {
      kind: 'unknown'; say: string; heard: string; understood: boolean;
      /**
       * M13.3: "open <something that is neither a node nor a catalogue program>" was understood as
       * an open and refused, but it may be a desktop request the rules cannot express ("open my
       * most recent project in After Effects"). The voice path offers it to the planner
       * (`desktop:plan`) before saying the refusal.
       */
      plannable?: boolean;
    };

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

/*
 * ── The JARVIS Voice window, spoken (docs/11; packages/shared/hologram-control.ts) ──────────
 *
 * William, 2026-09-26: "all of the Jarvis Voice UI, every submenu and button, should have voice
 * commands preset." Written as whole-utterance patterns like the manual-control ones above, so
 * each phrasing is a legible line. `normalise` has folded case and punctuation by the time these
 * run. Fillers people put in ("the", "my", "panel", "menu", "dropdown") are optional everywhere.
 */
const PANEL_WORDS: Record<string, HologramPanel> = {
  main: 'main', home: 'main', front: 'main', start: 'main',
  train: 'train', training: 'train', trainer: 'train', voices: 'train',
  desk: 'desk', desktop: 'desk',
  action: 'actions', actions: 'actions', routines: 'actions', macros: 'actions',
  say: 'say', speech: 'say', talk: 'say', talkback: 'say', speak: 'say'
};

const DROPDOWN_WORDS: Record<string, HologramDropdown> = {
  profile: 'profiles', profiles: 'profiles',
  voice: 'voices', voices: 'voices',
  monitor: 'monitors', monitors: 'monitors', displays: 'monitors',
  // 2026-09-27: the session picker under the caption ("open the sessions dropdown").
  session: 'sessions', sessions: 'sessions'
};

const UI_FILLER = '(?:(?:the|my|your|that|this|a|an) )?';
const PANEL_SUFFIX = '(?: (?:panel|menu|tab|screen|page|view|section|mode))?';
const DROPDOWN_SUFFIX = '(?: (?:dropdown|drop down|list|menu|selector|picker|options))?';

const PANEL_GO = new RegExp(`^(?:(?:go|switch|take me|return|get|jump)(?: back)? (?:to|into|onto)|back to|show(?: me)?|open(?: up)?|bring up|display|pull up|give me) ${UI_FILLER}([a-z]+)${PANEL_SUFFIX}$`);
const PANEL_BARE = new RegExp(`^${UI_FILLER}([a-z]+) (?:panel|menu|tab|screen|page|view|section)$`);
const DROPDOWN = new RegExp(`^(open|show|expand|drop down|pull down|unfold|close|hide|collapse|fold|fold up) ${UI_FILLER}([a-z]+)${DROPDOWN_SUFFIX}$`);
const ON_OFF_SWITCH = new RegExp(`^(?:(?:turn|switch|flip|toggle) (on|off) ${UI_FILLER}([a-z ]+?)|${UI_FILLER}([a-z ]+?) (on|off)|(enable|disable|activate|deactivate|mute|unmute) ${UI_FILLER}([a-z ]+?))$`);

const TALKBACK_NAMES = /^(?:talk ?back|speech|talking|replies|voice replies|spoken replies|your voice|the voice|your speech)$/;
const MIC_NAMES = /^(?:mic|microphone|the mic|the microphone|listening)$/;
const DESK_NAMES = /^(?:desk|desktop|desk control|desktop control|desk mode|desktop mode|the desk|the desktop)$/;

/** Every control id a spoken control reaches, for the renderer and for the test that walks them all. */
export function controlTargets(control: HologramControl): HologramControlId[] {
  switch (control.op) {
    case 'panel': return control.panel === 'train' ? ['btn-train'] : control.panel === 'actions' ? ['btn-actions'] : control.panel === 'desk' ? ['btn-desk'] : control.panel === 'say' ? ['btn-say'] : [];
    case 'dropdown': return [`dropdown-${control.name}` as HologramControlId];
    case 'talkback': return ['btn-say'];
    case 'mic': return ['btn-mic'];
    case 'desk': return ['btn-desk'];
    case 'press': return [control.id];
    case 'dictate': return ['btn-dictate'];
    case 'train-action': return ['btn-train-action'];
    case 'minimise': return ['btn-minimise'];
    case 'close': return ['btn-close'];
    case 'shutdown': return ['btn-close', 'btn-mic', 'btn-say'];
  }
}

/** The one-line spoken reply for a control performed by voice. */
export function sayForControl(control: HologramControl): string {
  switch (control.op) {
    case 'panel': return `The ${control.panel} panel.`;
    case 'dropdown': return `${control.open ? 'Opening' : 'Closing'} ${control.name}.`;
    case 'talkback': return `Talkback ${control.on ? 'on' : 'off'}.`;
    case 'mic': return `Microphone ${control.on ? 'on' : 'off'}.`;
    case 'desk': return `Desktop control ${control.on ? 'on' : 'off'}.`;
    case 'press': {
      const words: Partial<Record<HologramControlId, string>> = {
        'btn-use-voice': 'Switching voices.',
        'btn-record': 'Recording. Read the line.',
        'btn-play': 'Playing it back.',
        'btn-create-profile': 'A new profile.',
        'btn-save-action': 'Saving the action.',
        'btn-discard-action': 'Discarded.',
        'btn-send': 'Sent.',
        'input-text': 'The text box is yours.'
      };
      return words[control.id] ?? `${control.id.replace(/^btn-/, '').replace(/-/g, ' ')}.`;
    }
    case 'dictate': return control.on ? 'Dictating. Speak, and I will type.' : 'Dictation off.';
    case 'train-action': return control.on ? 'Watching. Show me.' : 'Recording stopped. Name it, or discard it.';
    case 'minimise': return 'Minimised.';
    case 'close': return 'Closing.';
    case 'shutdown': return 'Shutting down. Goodnight, sir.';
  }
}

const hologram = (control: HologramControl, say?: string): Intent => ({ kind: 'hologram', control, say: say ?? sayForControl(control) });

/** A sentence about the JARVIS Voice window, or null when it is about something else. */
function hologramIntent(text: string, heard: string): Intent | null {
  // ── shut down: the JARVIS Voice program, and never the computer ──────────────────────────
  if (/\b(?:shut|power|turn|switch)\b.*\b(?:down|off)\b/.test(text) && /\b(?:computer|pc|machine|windows|system|everything)\b/.test(text)) {
    return unknown(heard, 'I do not shut the computer down.', true);
  }
  if (/^(?:shut (?:yourself|jarvis|it|the (?:jarvis )?(?:voice )?(?:program|window|app|assistant)) down|shut down(?: jarvis| yourself| the (?:jarvis )?(?:voice )?(?:program|window|app|assistant))?|power (?:down|off)(?: jarvis| yourself)?|turn yourself off|switch yourself off|go to sleep|go offline|goodnight jarvis)$/.test(text)) {
    return hologram({ op: 'shutdown' });
  }

  // ── stop: speech and the desktop, as Esc does. Not the microphone. ───────────────────────
  if (/^(?:stop|halt|stop that|stop it|stop there|stop talking|stop speaking|stop moving|stop everything|quiet|be quiet|hush|shush|silence|cancel|cancel that|never mind|abort|freeze|hold on|hold it|wait|enough)$/.test(text)) {
    return { kind: 'view', action: { type: 'stop' }, say: '' };
  }

  // ── dictation ────────────────────────────────────────────────────────────────────────────
  if (/^(?:dictate|dictation|start (?:dictating|dictation|a dictation)|take (?:a |some )?dictation|begin (?:dictating|dictation)|type what i say|write what i say|transcribe (?:me|this)|dictation on)$/.test(text)) {
    return hologram({ op: 'dictate', on: true });
  }
  if (/^(?:stop (?:dictating|dictation|the dictation|typing)|end (?:the )?dictation|finish (?:the )?dictation|dictation off|that s all)$/.test(text)) {
    return hologram({ op: 'dictate', on: false });
  }

  // ── train action: watch what William does ────────────────────────────────────────────────
  if (/^(?:train (?:an? |the )?actions?|train me|watch (?:what i do|me|this|closely)|start watching|record (?:my |an? |this |the )?actions?|record what i do|learn (?:this|an? action|what i do)|action training)$/.test(text)) {
    return hologram({ op: 'train-action', on: true });
  }
  if (/^(?:stop watching|stop recording(?: (?:my |the )?actions?)?|stop (?:the )?training|end (?:the )?(?:action|recording)|done watching|that s the action|finish (?:the )?action|action done)$/.test(text)) {
    return hologram({ op: 'train-action', on: false });
  }
  if (/^(?:save (?:the |that |this )?action|keep (?:the |that |this )?action|save it|save that|remember (?:that|this|it))$/.test(text)) {
    return hologram({ op: 'press', id: 'btn-save-action' });
  }
  if (/^(?:discard|discard (?:the |that |this )?action|forget (?:the |that |this )?action|throw (?:that |it )?away|scrap (?:that|it|the action)|delete (?:the |that )?recording)$/.test(text)) {
    return hologram({ op: 'press', id: 'btn-discard-action' });
  }

  // ── the window itself ────────────────────────────────────────────────────────────────────
  if (/^(?:minimi[sz]e|minimi[sz]e (?:yourself|the window|jarvis|the jarvis window)|hide yourself|hide the window|shrink|to the taskbar|get small)$/.test(text)) {
    return hologram({ op: 'minimise' });
  }
  if (/^(?:close|close (?:yourself|the window|jarvis|the jarvis window|the hologram|the jarvis voice window|the voice window|your window)|dismiss|dismissed|go away|that will be all)$/.test(text)) {
    return hologram({ op: 'close' });
  }

  // ── the profile buttons and the text box ─────────────────────────────────────────────────
  if (/^(?:use|switch to|speak with|talk with|speak in|talk in) (?:this|that|the|my|the recorded|the trained|your|the new)? ?(?:voice|profile)(?: voice| profile)?$/.test(text)) {
    return hologram({ op: 'press', id: 'btn-use-voice' });
  }
  if (/^(?:record|record (?:the |a |this |the next )?(?:line|it|that)|start recording|record now)$/.test(text)) {
    return hologram({ op: 'press', id: 'btn-record' });
  }
  if (/^(?:play|play it|play that|play it back|play that back|playback|play (?:the |that |my )?(?:line|last line|recording)(?: back)?)$/.test(text)) {
    return hologram({ op: 'press', id: 'btn-play' });
  }
  if (/^(?:(?:create|make|add|start|begin) (?:a |an? )?(?:new )?(?:voice )?profile|new (?:voice )?profile)$/.test(text)) {
    return hologram({ op: 'press', id: 'btn-create-profile' });
  }
  if (/^(?:send|send it|send that|send this|submit|submit it)$/.test(text)) {
    return hologram({ op: 'press', id: 'btn-send' });
  }
  if (/^(?:focus (?:the )?(?:text )?(?:box|field|input)|(?:the )?text box|let me type|i ll type|keyboard|type)$/.test(text)) {
    return hologram({ op: 'press', id: 'input-text' });
  }

  // ── panels ───────────────────────────────────────────────────────────────────────────────
  const goPanel = PANEL_GO.exec(text) ?? PANEL_BARE.exec(text);
  if (goPanel) {
    const panel = PANEL_WORDS[goPanel[1]!];
    if (panel) return hologram({ op: 'panel', panel });
  }
  if (/^(?:go back|back|main menu|home|go home)$/.test(text)) return hologram({ op: 'panel', panel: 'main' });

  // ── dropdowns ────────────────────────────────────────────────────────────────────────────
  const dropdown = DROPDOWN.exec(text);
  if (dropdown) {
    const name = DROPDOWN_WORDS[dropdown[2]!];
    const suffixed = /(?:dropdown|drop down|list|menu|selector|picker|options)$/.test(text);
    // "open profile" alone could be a node; the dropdown needs the plural or the word for a list.
    if (name && (suffixed || dropdown[2]!.endsWith('s'))) {
      const open = !/^(?:close|hide|collapse|fold|fold up)$/.test(dropdown[1]!);
      return hologram({ op: 'dropdown', name, open });
    }
  }

  // ── the three switches: talkback, the microphone, desktop control ────────────────────────
  const sw = ON_OFF_SWITCH.exec(text);
  if (sw) {
    const verb = sw[5];
    const on = sw[1] ? sw[1] === 'on' : sw[4] ? sw[4] === 'on' : verb === 'enable' || verb === 'activate' || verb === 'unmute';
    const name = (sw[2] ?? sw[3] ?? sw[6] ?? '').trim();
    if (TALKBACK_NAMES.test(name)) return hologram({ op: 'talkback', on });
    if (MIC_NAMES.test(name) && !(verb === 'mute' || verb === 'unmute')) return hologram({ op: 'mic', on });
    if (DESK_NAMES.test(name)) return hologram({ op: 'desk', on });
  }
  if (/^(?:open|turn on) ${UI_FILLER}(?:mic|microphone)$/.test(text)) return hologram({ op: 'mic', on: true });

  return null;
}

/**
 * The saved action a spoken name means, by token overlap: "the morning setup" finds
 * "Morning setup (OBS + Discord)". Case, punctuation and fillers do not count; the best candidate
 * wins when at least three fifths of the spoken words are in its name, or all of its name's words
 * were said. Ties go to nobody: null means "ask".
 */
export function matchActionName<T extends { id: string; name: string }>(spoken: string, actions: readonly T[]): T | null {
  const asked = words(spoken).filter((w) => !FILLER.has(w) && !/^(?:action|routine|macro|recording)$/.test(w));
  if (!asked.length || !actions.length) return null;
  let best: { action: T; score: number } | null = null;
  let tie = false;
  for (const action of actions) {
    const own = words(action.name).filter((w) => !FILLER.has(w));
    if (!own.length) continue;
    const inName = asked.filter((w) => own.some((o) => o === w || o.startsWith(w) || w.startsWith(o))).length;
    const said = own.filter((o) => asked.some((w) => o === w || o.startsWith(w) || w.startsWith(o))).length;
    const score = Math.max(inName / asked.length, said / own.length);
    if (score < 0.6) continue;
    if (!best || score > best.score) { best = { action, score }; tie = false; }
    else if (score === best.score) tie = true;
  }
  return best && !tie ? best.action : null;
}

/** "do the morning setup", "run the stream setup action": a saved action by name, or null. */
function actionIntent(text: string, heard: string): Intent | null {
  const byVerb = /^(?:do|perform|replay|play back|repeat|carry out) (?:the |my |that |this )?(.+?)(?: (?:action|routine|macro|recording))?$/.exec(text);
  const byNoun = /^(?:run|execute|start|launch|trigger) (?:the |my |that |this )?(.+?) (?:action|routine|macro|recording)$/.exec(text);
  const hit = byVerb ?? byNoun;
  if (!hit) return null;
  const name = hit[1]!.trim();
  // M13.3: "do the notepad test but in word" is not the notepad test. A saved action changed on the
  // way is the planner's (docs/11 § Slice 2), with the action as its worked example.
  if (/\b(?:but|instead|except|without|rather than)\b/.test(name)) return null;
  if (!name || /^(?:it|that|this|nothing|something|anything|again|the same)$/.test(name)) return unknown(heard, 'Do which action, sir?', true);
  return { kind: 'action', name, say: `Looking for an action called ${name}.` };
}

/*
 * ── A dictation target and the split (2026-09-27; docs/11 § Reaching into windows) ──────────
 * "transcribe into JARVIS-TQR", "dictate to JARVIS-TQR", "type this into JARVIS-TQR", "split
 * screen with JARVIS-TQR", "put JARVIS-TQR on monitor one and sit beside it", "send it", "stop
 * transcribing". Main finds the window by title (window-split.ts, dictate-target.ts).
 */
function dictationIntent(text: string): Intent | null {
  const aim = /^(?:transcribe|dictate|start transcribing|start dictating|type this|type that|type what i say|write this|write what i say)(?: it| this)? (?:into|in|to|onto|for) (.+)$/.exec(text);
  if (aim) {
    const window = aim[1]!.trim();
    return { kind: 'dictate', request: { op: 'set', window, start: true }, say: `Dictating into ${window}.` };
  }
  if (/^(?:stop|end|finish|quit) (?:transcribing|transcription|transcribing into .+)$|^(?:clear|forget|drop) the (?:dictation )?target$/.test(text)) {
    return { kind: 'dictate', request: { op: 'clear' }, say: 'Stopped transcribing.' };
  }
  if (/^(?:send it|enter|press enter|hit enter|press return|hit return|submit it)$/.test(text)) {
    return { kind: 'dictate', request: { op: 'enter' }, say: 'Sent.' };
  }
  const split = /^(?:split(?: the)? screen with|split with|sit (?:beside|next to)|go (?:beside|next to)) (.+)$/.exec(text)
    ?? /^put (.+?) on (?:monitor |screen |display )?(?:one|1|won) and (?:sit|go|stay|be|put yourself) (?:beside|next to|by) (?:it|him|them|that)$/.exec(text);
  if (split) {
    const window = split[1]!.trim();
    return { kind: 'split', request: { op: 'on', window }, say: `Beside ${window}.` };
  }
  if (/^(?:leave|exit|end|stop|close|undo|cancel) (?:the )?split(?: screen)?$|^unsplit$|^(?:go )?back to your corner$/.test(text)) {
    return { kind: 'split', request: { op: 'off' }, say: 'Back to my corner.' };
  }
  return null;
}

/** The node a phrase names on another board, when this room has none (board-voice.ts). */
function elsewhere(phrase: string, ctx: IntentContext, accept?: (node: BoardNode) => boolean): { hit?: BoardHit; candidates: BoardHit[] } {
  if (!ctx.boards?.length) return { candidates: [] };
  return matchAcrossBoards(phrase, ctx.boardId, ctx.boards.filter((h) => h.boardId !== ctx.boardId), scoreNode, accept);
}

/** This room's node as a BoardHit, so a write reads the same whichever board it is on. */
function hereHit(node: BoardNode, ctx: IntentContext): BoardHit {
  const known = ctx.boards?.find((h) => h.boardId === ctx.boardId);
  return { boardId: ctx.boardId, path: known?.path ?? [], room: known?.room ?? ctx.boardId.toUpperCase(), node };
}

const hitName = (hit: BoardHit): string => nameOf(hit.node);

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

/** A room on any board, as an intent. */
function goTo(room: RoomTarget): Intent {
  return { kind: 'board', op: { type: 'goto', target: room }, say: room.path.length ? `Into ${room.room}.` : 'Up to the mainboard.' };
}

/** The node a phrase names, this room first, then every board: a hit, or the intent that says why not. */
function findHit(phrase: string, ctx: IntentContext, heard: string = phrase): { hit: BoardHit } | { intent: Intent } {
  const here = matchNode(phrase, ctx);
  if (here.candidates.length) return { intent: ambiguous(here.candidates) };
  if (here.node) return { hit: hereHit(here.node, ctx) };
  const far = elsewhere(phrase, ctx);
  if (far.candidates.length) return { intent: { kind: 'ambiguous', say: whichOne(far.candidates), candidates: far.candidates.map((c) => ({ id: c.node.id, name: c.node.name })) } };
  if (far.hit) return { hit: far.hit };
  return { intent: unknown(heard, `I do not see anything called "${phrase}".`) };
}

const OP_SAY: Record<'select' | 'open' | 'inspect' | 'zoomTo', (hit: BoardHit, far: boolean) => string> = {
  select: (h, far) => `${hitName(h)}${far ? `, in ${h.room}` : ''}.`,
  open: (h, far) => `Opening ${hitName(h)}${far ? ` in ${h.room}` : ''}.`,
  inspect: (h, far) => `${hitName(h)}${far ? `, in ${h.room}` : ''}. The inspector has it.`,
  zoomTo: (h, far) => `Zooming to ${hitName(h)}${far ? ` in ${h.room}` : ''}.`
};

/** select / open / inspect / zoom to, on this board or any other (board-voice.ts). */
function nodeOp(type: 'select' | 'open' | 'inspect' | 'zoomTo', phrase: string, ctx: IntentContext, heard: string): Intent {
  const found = findHit(phrase, ctx, heard);
  if ('intent' in found) return found.intent;
  return { kind: 'board', op: { type, hit: found.hit }, say: OP_SAY[type](found.hit, found.hit.boardId !== ctx.boardId) };
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

  // ── the Face, by name only: everything else is answered here (docs/11 § Conversation) ────
  const face = /^(?:ask|tell|send(?: (?:that|this|it))?(?: to)?|message|say to) the face[,:]?\s*(?:to\s+)?(.*)$/.exec(text);
  if (face) {
    const words = (face[1] ?? '').trim();
    if (!words) return unknown(heard, 'Ask the face what, sir?', true);
    return { kind: 'view', action: { type: 'faceSend', text: words }, say: 'Sent to the Face.' };
  }

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

  // ── 2026-09-27: a read-back board edit waiting for "go" or "no" (board-voice.ts) ──────────
  // Its own path: it applies a rename or a note that was read back, and can never reach the
  // deletion dialog (`boardWrite` builds no DESTRUCTIVE command; actOnIntent checks again).
  if (ctx.pendingEdit) {
    const answer = boardAnswer(text);
    if (answer !== null) return { kind: 'board', op: { type: 'answer', yes: answer }, say: answer ? 'Going.' : 'Cancelled.' };
  }

  // ── 2026-09-27: dictation into a named window, "send it", and the split beside it ─────────
  const aimed = dictationIntent(text);
  if (aimed) return aimed;

  // ── 2026-09-27: inside a room, "go back" and "up" climb out (before the window's "go back") ─
  if (ctx.inRoom && /^(?:go back|back|go up|up|back up|up a level)$/.test(text)) {
    return { kind: 'view', action: { type: 'ascend' }, say: 'Going up.' };
  }

  // ── the JARVIS Voice window: panels, dropdowns, switches, buttons, stop, shut down ────────
  const voiceWindow = hologramIntent(text, heard);
  if (voiceWindow) return voiceWindow;
  const action = actionIntent(text, heard);
  if (action) return action;

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
  if (/^(go up|come back|back out|ascend|up a level|leave the room|out|up)$/.test(text)) {
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
  // 2026-09-27: "zoom to the stalker", on this board or another (board-voice.ts).
  const zoomNode = /^zoom (?:in )?(?:to|on|onto|into|in on) (.+)$/.exec(text);
  if (zoomNode) return nodeOp('zoomTo', zoomNode[1]!, ctx, heard);

  if (/^(deselect|clear (the )?selection|select nothing|nothing selected)$/.test(text)) {
    return { kind: 'view', action: { type: 'clearSelection' }, say: 'Cleared.' };
  }

  // ── 2026-09-27: reaching into a window: press, scroll, click, type "in <app>" ─────────────
  // Two steps each: find the window and bring it forward by pointer, then the action. The window
  // is matched at run time against what is open, so no catalogue is needed (desktop.ts).
  const reach = parseReachCommand(text, heard, { apps: ctx.apps ?? [] });
  if (reach) {
    if ('refuse' in reach) return unknown(heard, reach.refuse, true);
    return { kind: 'desktop', plan: { ...reach.plan, source: ctx.actor === 'user' ? 'typed' : 'voice' }, say: 'On it.' };
  }

  // ── the desktop: a program, a site, a monitor (docs/11) ──────────────────────────────────
  // Before the board's own move/open rules, and only when a catalogue program or a site is named.
  if (ctx.apps?.length) {
    const plan = parseDesktopCommand(text, { apps: ctx.apps, monitors: ctx.monitors ?? 1 });
    if (plan) return { kind: 'desktop', plan: { ...plan, heard, source: ctx.actor === 'user' ? 'typed' : 'voice' }, say: 'On it.' };
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

  // ── 2026-09-27: moving a node into another room: the bus has no such command, so say so ────
  const between = ctx.boards?.length ? parseMoveToRoom(text) : null;
  if (between) {
    const room = matchRoom(between.room, ctx.boards!, scoreNode);
    if (room && !('candidates' in room)) {
      const found = findHit(between.target, ctx, heard);
      if ('intent' in found) return found.intent;
      return unknown(heard, moveBetweenRoomsRefusal(hitName(found.hit), room.room), true);
    }
  }

  // ── 2026-09-27: notes, read back before they land (board-voice.ts) ───────────────────────
  const notes = parseNotes(text);
  if (notes) {
    const found = findHit(notes.target, ctx, heard);
    if ('intent' in found) return found.intent;
    const value = rawValue(heard, 'notes?', 'to|as|say|read', true) ?? notes.value;
    const op = boardWrite(found.hit, 'notes', value, hitName(found.hit));
    if (!op) return unknown(heard, 'Set the notes to what, sir?', true);
    return { kind: 'board', op, say: op.type === 'write' ? op.readBack : 'Very well.' };
  }

  // ── rename ────────────────────────────────────────────────────────────────────────────────
  const rename = /^(?:rename|retitle) (.+?) (?:to|as) (.+)$/.exec(text);
  if (rename && ctx.actor === 'voice') {
    // 2026-09-27: by voice, on any board, in the words he said, and read back before it lands.
    const found = findHit(rename[1]!, ctx, heard);
    if ('intent' in found) return found.intent;
    const value = rawValue(heard, 'rename|retitle', 'to|as') ?? rename[2]!;
    const op = boardWrite(found.hit, 'name', value, hitName(found.hit));
    if (!op) return unknown(heard, 'Rename it to what, sir?', true);
    return { kind: 'board', op, say: op.type === 'write' ? op.readBack : 'Very well.' };
  }
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
  // 2026-09-27: by voice, not even asked. "I don't delete by voice." (docs/07 § JARVIS Voice.)
  if (ctx.actor === 'voice' && VOICE_DELETION.test(text)) return unknown(heard, VOICE_DELETION_REFUSAL, true);
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
    if (!target.node && ctx.boards?.length) {
      // 2026-09-27: a room on another board ("go to the deduction room" from inside STORYOS).
      const room = matchRoom(go[1]!, ctx.boards, scoreNode);
      if (room && 'candidates' in room) return unknown(heard, `Which room: ${room.candidates.map((r) => r.room).join(', or ')}?`, true);
      if (room) return goTo(room);
      return nodeOp('select', go[1]!, ctx, heard);
    }
    if (!target.node) return unknown(heard, `I do not see anything here called "${go[1]}".`);
    if (target.node.kind === 'drive.room') {
      return { kind: 'view', action: { type: 'descend', nodeId: target.node.id }, say: `Into ${target.node.name}.` };
    }
    return { kind: 'view', action: { type: 'select', nodeId: target.node.id }, say: `${nameOf(target.node)} is not a room. Selected it.` };
  }

  // 2026-09-27: "inspect X" / "show me X": select it and bring it into view, on any board.
  const inspect = /^(?:inspect|show me|examine) (.+)$/.exec(text);
  if (inspect) return nodeOp('inspect', inspect[1]!, ctx, heard);

  const select = /^(?:select|pick|highlight|focus|find|show me) (.+)$/.exec(text);
  if (select) {
    const target = matchNode(select[1]!, ctx);
    if (target.candidates.length) return ambiguous(target.candidates);
    if (!target.node && ctx.boards?.length) return nodeOp('select', select[1]!, ctx, heard);
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
    if (!target.node && ctx.boards?.length) {
      // 2026-09-27: a node on another board, or a room by name; still the planner's if neither.
      const room = /\broom\b/.test(open[1]!) ? matchRoom(open[1]!, ctx.boards, scoreNode) : null;
      if (room && !('candidates' in room)) return goTo(room);
      const far = elsewhere(open[1]!, ctx);
      if (far.candidates.length) return { kind: 'ambiguous', say: whichOne(far.candidates), candidates: far.candidates.map((c) => ({ id: c.node.id, name: c.node.name })) };
      if (far.hit) return { kind: 'board', op: { type: 'open', hit: far.hit }, say: `Opening ${hitName(far.hit)} in ${far.hit.room}.` };
    }
    if (!target.node) return { kind: 'unknown', say: `I do not see anything here called "${open[1]}".`, heard, understood: true, plannable: true };
    return { kind: 'view', action: { type: 'open', nodeId: target.node.id }, say: `Opening ${nameOf(target.node)}.` };
  }

  return unknown(heard, `I did not understand "${text}".`, false);
}
