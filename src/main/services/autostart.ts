import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import {
  autostartCommand,
  installedAutostartCommand,
  bootVbs,
  parseRunValue,
  regAddArgs,
  regDeleteArgs,
  regQueryArgs,
  type AutostartState
} from '@shared/boot.js';
import { which } from './which.js';
import { skynetRoot } from './target-resolver.js';

/**
 * "Start SkynetOS with Windows", for the LOOK panel's SYSTEM switch.
 *
 * A per-user Run value (HKCU, so no administrator) that runs a generated login script with
 * wscript, hidden. The script runs `node tools/boot.mjs`: build, then start, handing over from any
 * copy already running. The same text as `npm run autostart:on`, from packages/shared/boot.ts.
 *
 * User-only (docs/07): an agent can never make SkynetOS start itself. Neither channel is in
 * AGENT_METHODS.
 */

function reg(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true, timeout: 10_000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

function bootVbsPath(): string {
  return join(app.getPath('userData'), 'boot.vbs');
}

function wscriptPath(): string {
  return join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32', 'wscript.exe');
}

/**
 * What the Run value should hold for THIS copy. Installed: the exe. From source: the login script
 * that builds and starts. Turning the switch on from one kind of copy repoints it at that kind, and
 * `current` reads false in the other, which is how the panel says the value starts something else.
 */
function expectedCommand(): string {
  return app.isPackaged ? installedAutostartCommand(process.execPath) : autostartCommand(wscriptPath(), bootVbsPath());
}

export async function autostartState(): Promise<AutostartState> {
  if (process.platform !== 'win32') return { supported: false, enabled: false, command: null, current: false };
  const query = await reg(regQueryArgs());
  const command = query.ok ? parseRunValue(query.stdout) : null;
  const expected = expectedCommand();
  return {
    supported: true,
    enabled: command !== null,
    command,
    // An installed copy needs no login script, so there is no file to find.
    current: command === expected && (app.isPackaged || existsSync(bootVbsPath()))
  };
}

export async function setAutostart(on: boolean): Promise<AutostartState & { ok: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { ...(await autostartState()), ok: false, error: 'START WITH WINDOWS IS WINDOWS-ONLY' };
  }

  if (on && app.isPackaged) {
    const added = await reg(regAddArgs(expectedCommand()));
    if (!added.ok) return { ...(await autostartState()), ok: false, error: `reg.exe refused — ${added.stderr.trim() || 'no reason given'}` };
  } else if (on) {
    // The real node.exe, found on PATH. The login script needs it to run the build and start.
    const node = which('node.exe');
    if (!node) {
      return { ...(await autostartState()), ok: false, error: 'NODE IS NOT ON PATH — the login script needs it to build and start SkynetOS' };
    }
    const root = skynetRoot();
    const vbs = bootVbsPath();
    try {
      mkdirSync(dirname(vbs), { recursive: true });
      writeFileSync(vbs, '\uFEFF' + bootVbs({ node, script: join(root, 'tools', 'boot.mjs'), repo: root }), 'utf16le');
    } catch (err) {
      return { ...(await autostartState()), ok: false, error: `COULD NOT WRITE THE LOGIN SCRIPT — ${(err as Error).message}` };
    }
    const added = await reg(regAddArgs(autostartCommand(wscriptPath(), vbs)));
    if (!added.ok) return { ...(await autostartState()), ok: false, error: `reg.exe refused — ${added.stderr.trim() || 'no reason given'}` };
  } else {
    // A value that is already absent makes reg.exe fail; the read-back below is the real answer.
    await reg(regDeleteArgs());
  }

  const state = await autostartState();
  return state.enabled === on
    ? { ...state, ok: true }
    : { ...state, ok: false, error: on ? 'THE RUN VALUE DID NOT STICK' : 'THE RUN VALUE IS STILL THERE' };
}
