/**
 * Is William here? The rules for SkynetOS's away (sleep) mode, pure so they can be tested.
 *
 * William: "When user is not present and no terminal has recently been interacted with … a sort of
 * sleep / inactivity mode that should activate after 30 minutes that the program is open but isn't
 * interacted with - including agent interactions."
 *
 * So "away" needs ALL three, not any one:
 *   - input: the OS has seen no keyboard or mouse input for the threshold. OS-wide
 *     (`powerMonitor.getSystemIdleTime`), so typing in a terminal or another app counts as
 *     presence, not only input to SkynetOS;
 *   - agents: no Claude Code conversation file has been written for the threshold, so a session
 *     working on its own keeps the board awake;
 *   - commands: no board command and no MCP call for the threshold.
 */

export const AWAY_MODES = ['off', 'visual', 'plan', 'work'] as const;
export type AwayMode = (typeof AWAY_MODES)[number];

export function isAwayMode(value: unknown): value is AwayMode {
  return typeof value === 'string' && (AWAY_MODES as readonly string[]).includes(value);
}

export const DEFAULT_AWAY_MINUTES = 30;
export const MIN_AWAY_MINUTES = 5;
export const MAX_AWAY_MINUTES = 240;

export function clampAwayMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return DEFAULT_AWAY_MINUTES;
  return Math.min(MAX_AWAY_MINUTES, Math.max(MIN_AWAY_MINUTES, Math.round(n)));
}

/** How often presence is checked, and how often, while away, input is checked for a return. */
export const PRESENCE_CHECK_MS = 30_000;
export const WAKE_CHECK_MS = 2_000;

export interface PresenceInput {
  now: number;
  /** Seconds since the last keyboard or mouse input anywhere on the machine. */
  systemIdleSeconds: number;
  /** Newest Claude Code transcript write, epoch ms, or null if none could be read. */
  lastTranscriptAt: number | null;
  /** Newest board command or MCP call, epoch ms, or null if none since start. */
  lastCommandAt: number | null;
  thresholdMinutes: number;
}

export type PresenceBlocker = 'input' | 'agent' | 'command';

export interface PresenceVerdict {
  away: boolean;
  /** Which signals say someone (or something) is still here. Empty when away. */
  blockers: PresenceBlocker[];
}

export function judgePresence(input: PresenceInput): PresenceVerdict {
  const thresholdMs = clampAwayMinutes(input.thresholdMinutes) * 60_000;
  const recent = (at: number | null): boolean => at !== null && input.now - at < thresholdMs;
  const blockers: PresenceBlocker[] = [];
  if (input.systemIdleSeconds * 1000 < thresholdMs) blockers.push('input');
  if (recent(input.lastTranscriptAt)) blockers.push('agent');
  if (recent(input.lastCommandAt)) blockers.push('command');
  return { away: blockers.length === 0, blockers };
}

/**
 * While away: has the user come back?
 *
 * Only once the machine has actually been left alone since away began (`settled`): a manual
 * "sleep now" is itself a key press, and without this it would wake the instant it slept.
 */
export function shouldWake(systemIdleSeconds: number, settled: boolean): boolean {
  return settled && systemIdleSeconds < 3;
}

/** Idle long enough, since away began, that a later input really is someone returning. */
export function isSettled(systemIdleSeconds: number): boolean {
  return systemIdleSeconds >= 5;
}
