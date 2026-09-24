import type { LaunchModel } from '@shared/model-availability.js';
import { AWAY_MAX_SUBSESSIONS } from '@shared/away.js';

/**
 * Small shared state about activity, with no dependencies, so the command bus, the agent path
 * and the session manager can all reach it without importing each other.
 *
 *   - The last board command or MCP call: one of the three signals that William, or something
 *     working for him, is still here (packages/shared/presence.ts).
 *   - The away run's limits on the sessions it may start: how many, and on which model.
 */

let lastCommand: number | null = null;

/** A board command or an MCP call just happened. */
export function markActivity(at: number = Date.now()): void {
  lastCommand = at;
}

export function lastCommandAt(): number | null {
  return lastCommand;
}

/* ────────────────────────── the away run's sub-sessions ────────────────────────── */

let awayModel: LaunchModel | null = null;
let awayStarts = 0;
let awayLevel: 'plan' | 'work' | null = null;

/** Called by presence when an away run starts (with its level and model) and ends (null). */
export function setAwayRun(run: { level: 'plan' | 'work'; model: LaunchModel } | null): void {
  awayLevel = run?.level ?? null;
  awayModel = run?.model ?? null;
  awayStarts = 0;
}

/**
 * While an away run is going, sessions it starts open on the away model, not on Fable or Opus.
 * "Persistent low-resource agents" is the point. Null when no away run is going.
 */
export function awaySessionModel(): LaunchModel | null {
  return awayModel;
}

/**
 * The gate an agent's `session:start` passes while an away run is going. Null means allowed (and
 * counts it); a string is the refusal. Enforced here in main, not trusted to the prompt: at level
 * `plan` none, at level `work` at most AWAY_MAX_SUBSESSIONS.
 */
export function claimAwaySubsession(): string | null {
  if (awayLevel === null) return null;
  if (awayLevel === 'plan') return 'AWAY MODE IS PLAN: SESSIONS ARE NOT STARTED WHILE WILLIAM IS AWAY';
  if (awayStarts >= AWAY_MAX_SUBSESSIONS) return `AWAY MODE ALLOWS ${AWAY_MAX_SUBSESSIONS} SESSIONS AND BOTH HAVE STARTED`;
  awayStarts++;
  return null;
}
