/**
 * Which `control.json` a SkynetOS process may write, and which it may remove.
 *
 * ── The fault this exists for ─────────────────────────────────────────────────────────────────
 * `control.json` names the pipe and the token an agent uses to reach the RUNNING board. It lived at
 * one fixed place in userData, and every SkynetOS process wrote it at start and removed it at exit.
 * So a second copy, however short-lived, took the file from the first: a smoke capture run beside
 * William's open app overwrote his copy's file and then deleted it on the way out. His app was
 * still running and still listening, and every agent on the machine was told SKYNETOS IS NOT
 * RUNNING until he restarted it. `npm run smoke:shots` is documented as safe beside a running app;
 * on 2026-09-21 it was shown not to be, by the Hands doing exactly that.
 *
 * Two rules, either of which would have prevented it:
 *   1. A smoke run keeps its control file in its own capture folder.
 *   2. A process removes the file only if the file is still its own.
 */

export interface ControlFileEnv {
  SKYNET_CONTROL_FILE?: string | undefined;
  SKYNET_SMOKE_DIR?: string | undefined;
}

const join2 = (dir: string, name: string): string => `${dir.replace(/[\\/]+$/, '')}/${name}`;

/** Where this process keeps its control file. An explicit override wins, then the smoke folder. */
export function controlFilePath(env: ControlFileEnv, userData: string): string {
  if (env.SKYNET_CONTROL_FILE) return env.SKYNET_CONTROL_FILE;
  if (env.SKYNET_SMOKE_DIR) return join2(env.SKYNET_SMOKE_DIR, 'control.json');
  return join2(userData, 'control.json');
}

/** Does this file's content say it was written by `pid`? Anything unreadable is not ours. */
export function ownsControlFile(raw: string | null, pid: number): boolean {
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as { pid?: unknown }).pid === pid;
  } catch {
    return false;
  }
}
