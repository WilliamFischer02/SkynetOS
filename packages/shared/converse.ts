/**
 * JARVIS answers back (docs/11-JARVIS-VOICE.md § Conversation).
 *
 * William, 2026-09-24: "it opened a U1 jarvis window in claude web and said nothing in response to
 * me - my goal is for instead, it to talk back to me conversationally and me to be able to
 * continue by saying my next command. No need for the claude web window to open."
 *
 * A sentence the grammar does not understand used to be handed to the Face (claude.ai). Now it is
 * answered here: a headless `claude -p` composes one or two spoken sentences in the register, main
 * speaks them, and the microphone reopens for the next sentence (services/voice.ts). The Face is
 * reached only by saying so ("ask the face …").
 *
 * This file is the pure half: the settings, the prompt, the trim, the fallback. The process and the
 * speech are src/main/services/converse.ts.
 */

export interface ConverseSettings {
  /** Answer unrecognised sentences at all. Off: they are shown and a composed line is spoken. */
  enabled: boolean;
  /** The model `claude -p` is asked for. Haiku for latency; a reply is a sentence, not an essay. */
  model: string;
  /** How many turns (both sides) travel with each question. */
  maxTurns: number;
  /** How long the model may take before the fallback line is spoken instead. */
  timeoutMs: number;
}

export const DEFAULT_CONVERSE: ConverseSettings = {
  enabled: true,
  model: 'claude-haiku-4-5-20251001',
  maxTurns: 8,
  timeoutMs: 25_000
};

export interface ConverseTurn {
  at: string;
  who: 'william' | 'jarvis';
  text: string;
}

export interface ConverseContext {
  boardName?: string;
  desktopEnabled: boolean;
  monitors: number;
  apps: number;
  /** The local clock, as words the model can repeat: "Wednesday 24 September, 23:40". */
  timeLocal: string;
  /**
   * The BOARD block (packages/shared/board-context.ts `boardBlock`, 2026-09-27): the room, the
   * selection, the nodes, the rooms, the sessions and what JARVIS is doing. At most 3,000 characters.
   */
  board?: string;
}

/** The longest a spoken reply is allowed to be. Two sentences, and never a paragraph. */
export const MAX_REPLY_CHARS = 240;

/**
 * The voice, distilled from codex/personas/jarvis-voice.md § 5 for a reply that will be SPOKEN, not
 * read: one or two short sentences, no structure at all.
 */
export function converseSystemPrompt(): string {
  return [
    'You are JARVIS, the voice of SkynetOS, answering William out loud through a speech synthesiser.',
    'Answer in ONE or TWO short sentences. No lists, no headings, no markdown, no code, no exclamation marks, no emoji.',
    'Formal, precise, British-inflected: the register of a butler who runs a research facility. Answer first, qualify second.',
    'Say "sir" in roughly one reply in four, never more, and drop it when something is wrong.',
    'Never claim to have done, opened, moved or checked anything: you can only speak. If asked to act, say what would do it.',
    'You hear the room only after the wake word "Jarvis"; commands the board understands are: open a program on a monitor ("open Firefox on two"), move a window, open a site in a browser, and the board\'s own moves. If the sentence sounds like a command you could not parse, say in one clause what you can do, for example: I can open programs on a monitor, move windows, and open sites; I did not catch a program name.',
    "You can SEE William's SkynetOS board: the BOARD block in each message lists the room and its path, what is selected, every node on the board, the rooms, the Claude Code sessions and whether they run. Answer questions about the board directly from it, by name and designator; never say you lack the board state or cannot see it. Commands such as \"select X\", \"go to Y\" or \"open Z\" are carried out by the board's own grammar, not by you: if one reaches you, it was not understood, so say what it would take.",
    'If you do not know, say so in one sentence and name what would tell you. No apology spirals, no enthusiasm, no praise, no jokes attempted.',
    'Humour, if any, is a byproduct of stating the situation accurately.'
  ].join('\n');
}

/** The question, with what JARVIS should know: the last few turns and the room's state. */
export function conversePrompt(history: readonly ConverseTurn[], context: ConverseContext, text: string, maxTurns = DEFAULT_CONVERSE.maxTurns): string {
  const recent = history.slice(-Math.max(0, maxTurns));
  const lines: string[] = [
    `Local time: ${context.timeLocal}.`,
    `Board on screen: ${context.boardName ?? 'unknown'}.`,
    `Desktop control: ${context.desktopEnabled ? 'on' : 'off'}. Monitors: ${context.monitors}. Programs the board can open by name: ${context.apps}.`
  ];
  if (context.board) lines.push('', context.board.slice(0, 3000));
  if (recent.length) {
    lines.push('', 'The conversation so far:');
    for (const turn of recent) lines.push(`${turn.who === 'william' ? 'William' : 'JARVIS'}: ${turn.text}`);
  }
  lines.push('', `William says: ${text}`, '', 'Reply as JARVIS, out loud, in one or two sentences.');
  return lines.join('\n');
}

/**
 * What the model said, made fit to speak: control characters gone, markdown stripped, exclamation
 * marks calmed to full stops, the first two sentences, at most MAX_REPLY_CHARS. Null when nothing
 * usable is left.
 */
export function trimReply(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/!+/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const sentences = text.match(/[^.?]+[.?]+(?:\s|$)|[^.?]+$/g) ?? [text];
  text = sentences.slice(0, 2).join('').trim();
  if (text.length > MAX_REPLY_CHARS) {
    const cut = text.slice(0, MAX_REPLY_CHARS);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '));
    text = (stop > 40 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '.').trim();
  }
  return text || null;
}

/** Spoken when the model is off, slow, or absent. Never empty, always in the register. */
export function fallbackReply(text: string, reason: 'off' | 'timeout' | 'missing' | 'error' = 'error'): string {
  const heard = text.trim();
  const tail = 'the desktop and the board still hear the usual commands, sir.';
  switch (reason) {
    case 'off': return `I heard "${heard}", but conversation is switched off in settings; ${tail}`;
    case 'timeout': return `I did not get an answer in time for "${heard}"; ${tail}`;
    case 'missing': return `I cannot reach the model on this machine to answer "${heard}"; ${tail}`;
    default: return `I did not catch a command in that, and the model is not answering; ${tail}`;
  }
}

/** Newest last; drops whole turns so the pair order survives. */
export function pushTurn(history: readonly ConverseTurn[], turn: ConverseTurn, maxTurns = DEFAULT_CONVERSE.maxTurns): ConverseTurn[] {
  const next = [...history, turn];
  return next.length > maxTurns * 2 ? next.slice(next.length - maxTurns * 2) : next;
}

/* ────────────────────────── the headless call (converse and the planner) ────────────────────────── */

/** Every built-in tool, denied by name as well: belt to `--tools ""`'s braces. */
export const HEADLESS_DISALLOWED = ['Bash', 'PowerShell', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'NotebookEdit', 'Task', 'TodoWrite', 'Skill', 'BashOutput', 'KillShell'];

/** Thinking off: a spoken reply and a JSON plan are both better fast than deliberated. */
export const HEADLESS_SETTINGS = '{"alwaysThinkingEnabled":false}';
export const HEADLESS_ENV: Readonly<Record<string, string>> = { MAX_THINKING_TOKENS: '0' };

export interface HeadlessOptions {
  model: string;
  /** An MCP config naming no servers; with `--strict-mcp-config` it is the whole server set. */
  mcpConfig: string;
  /** The WHOLE system prompt (the lean call) or what is appended to Claude Code's own (legacy). */
  system: string;
  /** A CLI older than `--safe-mode` / `--tools`: the 2026-09-24 argument list, unchanged. */
  legacy?: boolean;
}

/**
 * The `claude -p` arguments for a call that can only answer text (docs/07 § JARVIS Voice).
 *
 * Measured on William-Desktop, 2026-09-27, Haiku 4.5, one call each (docs/11 § Where the time goes):
 * the planner went from 12,011 ms (20.6 K input tokens, 1,048 output tokens, most of them thinking)
 * to 3,081 ms (2.3 K in, 72 out); conversation from 4,901 ms to 2,484 ms. What does it:
 *  - thinking off (`--settings {"alwaysThinkingEnabled":false}` and MAX_THINKING_TOKENS=0): the
 *    largest single cut, 12.0 s → 3.8 s on its own;
 *  - `--system-prompt` instead of `--append-system-prompt`, `--safe-mode` (no CLAUDE.md, skills,
 *    plugins, hooks or memory) and `--tools ""`: ~18 K fewer input tokens, a further ~0.7 s;
 *  - `--no-session-persistence`: nothing written to ~/.claude for a one-line answer.
 * The prompt still goes on stdin; no MCP server loads; every tool is denied by name too.
 */
export function headlessClaudeArgs(o: HeadlessOptions): string[] {
  const common = ['-p', '--output-format', 'text', '--model', o.model, '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', o.mcpConfig];
  if (o.legacy) return [...common, '--disallowedTools', ...HEADLESS_DISALLOWED, '--append-system-prompt', o.system];
  return [
    ...common,
    '--safe-mode',
    '--tools', '',
    '--no-session-persistence',
    '--settings', HEADLESS_SETTINGS,
    '--disallowedTools', ...HEADLESS_DISALLOWED,
    '--system-prompt', o.system
  ];
}

/** The CLI refused an argument it does not know: retry once with the legacy list. */
export function unknownOption(stderr: string): boolean {
  return /unknown option|unknown argument|error: option|unrecognized/i.test(stderr);
}
