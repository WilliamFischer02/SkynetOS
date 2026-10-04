/**
 * TRAIN ACTION: record William's mouse and keyboard while the light is on, save the recording as
 * a named action, and replay it later with adaptation (docs/11 slice 3; rules docs/07 § JARVIS
 * Voice). The pure rules are packages/shared/actions.ts; the capture itself is the desktop
 * helper's `SkyRec` (packages/shared/desktop.ts), which streams one `{"rec": …}` line per event.
 *
 * What holds it:
 *  - the channels are user-only (never AGENT_METHODS or REMOTE_METHODS): only the TRAIN ACTION
 *    button and its save screen in the hologram window reach them;
 *  - recordings live under userData/desktop/recordings/, never in the repo, and are never deleted
 *    by a channel (docs/07): William deletes the file;
 *  - the recorder pauses itself over anything that looks like a sign-in (the helper does that
 *    before an event exists), and a replay never types into such a window either;
 *  - a replay runs under `desktop.enabled`, the same halt as a spoken plan, the same refused key
 *    combinations, at most MAX_REPLAY_STEPS steps and MAX_REPLAY_MS.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, screen } from 'electron';
import {
  LOOKUP_BUDGET_MS,
  MAX_REPLAY_MS,
  adaptTarget,
  coalesceSteps,
  isRefusedChord,
  isSensitiveTitle,
  matchWindow,
  recordingId,
  replayPlan,
  safeActionName,
  summariseSteps,
  type ActionRecording,
  type ActionStep,
  type LiveElement,
  type LiveWindow,
  type RawEvent,
  type RecordStatus,
  type SavedAction,
  type UiTarget
} from '@shared/actions.js';
import { turnBusy } from '@shared/turn.js';
import { currentTurnId, dispatch as turnDispatch, dispatchFor as turnDispatchFor, failTurn, finishTurn, turnState } from './turn.js';
import { monitorOf } from '@shared/desktop.js';
import {
  acquireDesktop,
  desktopHalted,
  desktopMonitors,
  dipToPhysical,
  ensureHelper,
  helperRequest,
  helperWindows,
  onRecorderEvent,
  physicalToDip,
  pushDesktopState,
  releaseDesktop
} from './desktop.js';
import { hologramWindow } from './hologram-window.js';
import { getSettings } from './settings.js';

/* ────────────────────────── where recordings live ────────────────────────── */

function recordingsDir(): string {
  const dir = join(app.getPath('userData'), 'desktop', 'recordings');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/* ────────────────────────── the live recording ────────────────────────── */

interface Live { startedAt: number; raw: RawEvent[]; pausedFor?: string; lastPush: number }

let live: Live | null = null;
let unsubscribe: (() => void) | null = null;

export function recordStatus(): RecordStatus {
  if (!live) return { recording: false, steps: 0 };
  return {
    recording: true,
    steps: live.raw.filter((e) => e.kind !== 'move').length,
    ...(live.pausedFor ? { pausedFor: live.pausedFor } : {}),
    startedAt: new Date(live.startedAt).toISOString()
  };
}

function pushRecordState(): void {
  const state = recordStatus();
  try {
    const win = hologramWindow();
    if (win && !win.isDestroyed()) win.webContents.send('desktop:recordState', state);
  } catch (err) {
    console.warn('[actions] could not push the record state', err);
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function asRect(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const r = v.map(num);
  return r.every((n) => n !== null) ? (r as [number, number, number, number]) : null;
}

function asTarget(v: unknown): UiTarget | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const rect = asRect(o['rect']) ?? [0, 0, 0, 0];
  const windowRect = asRect(o['windowRect']);
  return {
    process: str(o['process']),
    windowTitle: str(o['windowTitle']),
    controlName: str(o['controlName']),
    controlType: str(o['controlType']),
    className: str(o['className']),
    rect,
    relX: num(o['relX']) ?? 0.5,
    relY: num(o['relY']) ?? 0.5,
    monitor: num(o['monitor']) ?? 0,
    ...(windowRect ? { windowRect } : {})
  };
}

/** One helper line to one raw event, or null for anything malformed. The helper is trusted data, not code. */
export function asRaw(rec: Record<string, unknown>): RawEvent | null {
  const t = num(rec['t']);
  if (t === null) return null;
  switch (rec['kind']) {
    case 'move': { const x = num(rec['x']); const y = num(rec['y']); return x !== null && y !== null ? { t, kind: 'move', x, y } : null; }
    case 'wheel': { const x = num(rec['x']); const y = num(rec['y']); const delta = num(rec['delta']); return x !== null && y !== null && delta !== null ? { t, kind: 'wheel', x, y, delta } : null; }
    case 'click': case 'dblclick': case 'rightclick': {
      const x = num(rec['x']); const y = num(rec['y']); const target = asTarget(rec['target']);
      return x !== null && y !== null && target ? { t, kind: rec['kind'], x, y, target } : null;
    }
    case 'key': return str(rec['keys']) ? { t, kind: 'key', keys: str(rec['keys']) } : null;
    case 'char': return str(rec['ch']) ? { t, kind: 'char', ch: str(rec['ch']) } : null;
    case 'paused': return { t, kind: 'paused', reason: str(rec['reason']) || 'a sign-in window' };
    default: return null;
  }
}

export async function startRecording(): Promise<{ ok: boolean; error?: string }> {
  if (live) return { ok: false, error: 'ALREADY RECORDING — PRESS TRAIN ACTION AGAIN TO STOP' };
  if (!(await ensureHelper())) return { ok: false, error: 'THE DESKTOP HELPER COULD NOT START' };
  const answer = await helperRequest('record', { on: true }, 10_000);
  if (answer['ok'] !== true || answer['recording'] !== true) {
    return { ok: false, error: typeof answer['error'] === 'string' ? answer['error'] : 'THE HELPER WOULD NOT START RECORDING' };
  }
  live = { startedAt: Date.now(), raw: [], lastPush: 0 };
  unsubscribe = onRecorderEvent((rec) => {
    if (!live) return;
    const ev = asRaw(rec);
    if (!ev) return;
    live.raw.push(ev);
    if (ev.kind === 'paused') live.pausedFor = ev.reason;
    else if (ev.kind !== 'move') live.pausedFor = undefined;
    const now = Date.now();
    if (ev.kind !== 'move' || now - live.lastPush > 500) { live.lastPush = now; pushRecordState(); }
  });
  pushRecordState();
  console.log('[actions] recording started');
  return { ok: true };
}

export async function stopRecording(): Promise<{ ok: boolean; recording?: ActionRecording; error?: string }> {
  if (!live) return { ok: false, error: 'NOTHING IS RECORDING' };
  // The helper may have died or gone quiet; the light must still go out and what was heard is
  // still kept, or a second press would answer ALREADY RECORDING forever.
  let answer: Record<string, unknown>;
  try {
    answer = await helperRequest('record', { on: false }, 10_000);
  } catch (err) {
    answer = { ok: false, error: (err as Error).message };
  }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  const session = live;
  live = null;
  const raw = [...session.raw].sort((a, b) => a.t - b.t);
  const mons = desktopMonitors();
  const steps: ActionStep[] = coalesceSteps(raw).map((s) => {
    if (s.kind !== 'click' && s.kind !== 'dblclick' && s.kind !== 'rightclick') return s;
    const monitor = monitorOf(physicalToDip({ x: s.x, y: s.y, width: 1, height: 1 }), mons);
    return { ...s, target: { ...s.target, monitor } };
  });
  const screens = screen.getAllDisplays().map((d) => { const b = dipToPhysical(d.bounds); return { w: b.width, h: b.height, x: b.x, y: b.y }; });
  const last = steps[steps.length - 1];
  const recording: ActionRecording = {
    id: recordingId(),
    startedAt: new Date(session.startedAt).toISOString(),
    durationMs: last ? last.t : Date.now() - session.startedAt,
    steps,
    screens
  };
  pushRecordState();
  if (answer['ok'] !== true) console.warn('[actions] the helper did not confirm the stop:', answer['error']);
  console.log(`[actions] recording stopped: ${steps.length} steps in ${recording.durationMs} ms`);
  return { ok: true, recording };
}

/* ────────────────────────── saved actions ────────────────────────── */

function isRecording(v: unknown): v is ActionRecording {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['id'] === 'string' && Array.isArray(o['steps']) && typeof o['startedAt'] === 'string';
}

export function saveAction(req: { name: string; description: string; recording: ActionRecording }): { ok: boolean; action?: SavedAction; error?: string } {
  const name = safeActionName(str(req?.name));
  if (!name) return { ok: false, error: 'GIVE THE ACTION A NAME — IT IS WHAT YOU WILL SAY' };
  if (!isRecording(req?.recording)) return { ok: false, error: 'THERE IS NO RECORDING TO SAVE' };
  const recording = req.recording;
  if (!recording.steps.some((s) => s.kind !== 'move' && s.kind !== 'paused')) return { ok: false, error: 'NOTHING WAS RECORDED BUT MOUSE MOVEMENT — TRY AGAIN' };
  if (!/^[A-Za-z0-9-]+$/.test(recording.id)) return { ok: false, error: 'THAT RECORDING ID IS NOT ONE THIS APP MADE' };
  const taken = listSavedActions().some((a) => a.name.toLowerCase() === name.toLowerCase() && a.id !== recording.id);
  if (taken) return { ok: false, error: `AN ACTION CALLED "${name.toUpperCase()}" EXISTS — PICK ANOTHER NAME` };
  const action: SavedAction = {
    id: recording.id,
    name,
    description: str(req.description).trim().slice(0, 500),
    createdAt: new Date().toISOString(),
    recording,
    summary: summariseSteps(recording.steps)
  };
  try {
    writeFileSync(join(recordingsDir(), `${action.id}.json`), JSON.stringify(action, null, 2), 'utf8');
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE THE ACTION — ${(err as Error).message}` };
  }
  console.log(`[actions] saved "${name}" (${action.summary.length} lines)`);
  return { ok: true, action };
}

export function listSavedActions(): SavedAction[] {
  const dir = recordingsDir();
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out: SavedAction[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Partial<SavedAction>;
      if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string' || !isRecording(parsed.recording)) continue;
      out.push({
        id: parsed.id,
        name: parsed.name,
        description: str(parsed.description),
        createdAt: str(parsed.createdAt),
        recording: parsed.recording,
        summary: Array.isArray(parsed.summary) ? parsed.summary.map(String) : summariseSteps(parsed.recording.steps)
      });
    } catch {
      // A file that is not an action is left alone; nothing here deletes.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The action a spoken or typed name means: exact id, then exact name, then a name containing every word. */
export function findSavedAction(nameOrId: string): SavedAction | null {
  const actions = listSavedActions();
  const key = str(nameOrId).trim().toLowerCase();
  if (!key) return null;
  return actions.find((a) => a.id === key)
    ?? actions.find((a) => a.name.toLowerCase() === key)
    ?? actions.find((a) => { const words = key.split(/\s+/); const have = a.name.toLowerCase(); return words.every((w) => have.includes(w)); })
    ?? null;
}

/* ────────────────────────── replay ────────────────────────── */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Handles { windows: LiveWindow[]; handleOf: Map<LiveWindow, number> }

async function liveWindows(): Promise<Handles> {
  const mons = desktopMonitors();
  const windows: LiveWindow[] = [];
  const handleOf = new Map<LiveWindow, number>();
  for (const w of await helperWindows()) {
    if (w.min) continue;
    const dip = physicalToDip({ x: w.x, y: w.y, width: w.w, height: w.h2 });
    const lw: LiveWindow = { process: w.process ?? '', title: w.title, rect: [w.x, w.y, w.w, w.h2], monitor: monitorOf(dip, mons) };
    windows.push(lw);
    handleOf.set(lw, w.h);
  }
  return { windows, handleOf };
}

async function foregroundIsSensitive(): Promise<boolean> {
  const answer = await helperRequest('fgtitle', {}, 5000);
  return isSensitiveTitle(typeof answer['title'] === 'string' ? answer['title'] : '');
}

export async function runSavedAction(nameOrId: string): Promise<{ ok: boolean; error?: string }> {
  const action = findSavedAction(nameOrId);
  if (!action) return { ok: false, error: `I HAVE NO ACTION CALLED "${str(nameOrId).toUpperCase()}"` };
  if (getSettings().desktop.enabled !== true) return { ok: false, error: 'DESKTOP CONTROL IS OFF — THE DESKTOP SWITCH IN THE HOLOGRAM WINDOW, OR settings.json desktop.enabled' };
  if (!acquireDesktop()) return { ok: false, error: 'THE DESKTOP IS BUSY — SAY STOP, OR WAIT' };

  const plan = replayPlan(action.recording.steps);
  const logFile = join(recordingsDir(), `${action.id}.replay.log`);
  const log = (line: string): void => { try { appendFileSync(logFile, `${line}\n`, 'utf8'); } catch { /* the log is a courtesy */ } };
  log(`# ${new Date().toISOString()} replay "${action.name}" · ${plan.steps.length} steps${plan.truncated ? ' (truncated)' : ''}`);
  const started = Date.now();
  let failures = 0;
  let halted = false;
  // One turn at a time (services/turn.ts): a replay is ACTING with its steps, like a plan, so the
  // strip shows it, the watchdog sees progress, and no follow-up opens until it has finished.
  const owns = !turnBusy(turnState());
  let broken = '';
  turnDispatch({ type: 'planStarted', of: plan.steps.length, detail: `REPLAYING ${action.name}`.toUpperCase().slice(0, 40) });
  const turnId = currentTurnId();

  try {
    pushDesktopState({ busy: true, index: 0, total: plan.steps.length, message: `replaying ${action.name}` });
    if (!(await ensureHelper())) { broken = 'THE DESKTOP HELPER COULD NOT START'; return { ok: false, error: broken }; }
    const travel = Math.max(80, Math.min(400, getSettings().desktop.mouseTravelMs ?? 250));

    for (let i = 0; i < plan.steps.length; i++) {
      if (desktopHalted()) { halted = true; break; }
      if (Date.now() - started > MAX_REPLAY_MS * 1.5) { log('STOP    the replay ran past its time'); break; }
      const step = plan.steps[i]!;
      await sleep(plan.gaps[i]!);
      if (desktopHalted()) { halted = true; break; }
      const summary = summariseSteps([step])[0] ?? step.kind;
      turnDispatchFor(turnId, { type: 'step', index: i, of: plan.steps.length, label: summary.toUpperCase().slice(0, 40) });
      pushDesktopState({ busy: true, index: i, total: plan.steps.length, message: summary.toLowerCase() });

      try {
        switch (step.kind) {
          case 'click': case 'dblclick': case 'rightclick': {
            const { windows, handleOf } = await liveWindows();
            const win = matchWindow(step.target, windows);
            let elements: LiveElement[] = [];
            if (win) {
              const h = handleOf.get(win);
              if (h) {
                await helperRequest('focus', { h });
                await sleep(120);
                if (step.target.controlName.trim()) {
                  const found = await helperRequest('uiafind', { h, name: step.target.controlName, type: step.target.controlType, budgetMs: LOOKUP_BUDGET_MS }, LOOKUP_BUDGET_MS + 3000);
                  const rect = found['found'] === true && Array.isArray(found['rect']) ? (found['rect'] as number[]) : null;
                  if (rect && rect.length === 4) {
                    elements = [{ controlName: step.target.controlName, controlType: step.target.controlType, className: step.target.className, rect: rect as [number, number, number, number] }];
                  }
                }
              }
            }
            const adapted = adaptTarget(step, windows, elements, step.target.windowRect);
            const moved = await helperRequest('mouse', { x: adapted.x, y: adapted.y, travelMs: travel }, 10_000);
            if (moved['ok'] !== true) throw new Error('the mouse would not move');
            const button = step.kind === 'rightclick' ? 'right' : step.kind === 'dblclick' ? 'double' : 'left';
            const clicked = await helperRequest('click', { button });
            if (clicked['ok'] !== true) throw new Error('the click did not go through');
            log(`${adapted.tier.padEnd(8)}${adapted.x},${adapted.y}  ${summary}`);
            break;
          }
          case 'wheel': {
            await helperRequest('mouse', { x: step.x, y: step.y, travelMs: Math.min(travel, 150) }, 10_000);
            const turned = await helperRequest('wheel', { delta: step.delta });
            if (turned['ok'] !== true) throw new Error('the wheel did not turn');
            log(`wheel   ${step.delta}`);
            break;
          }
          case 'key': {
            if (isRefusedChord(step.keys)) { log(`REFUSED ${step.keys} closes or locks the machine`); break; }
            if (await foregroundIsSensitive()) { log(`SKIPPED ${step.keys}: a sign-in window is in front`); break; }
            const pressed = await helperRequest('combo', { keys: step.keys.split('+') });
            if (pressed['ok'] !== true) throw new Error(typeof pressed['error'] === 'string' ? pressed['error'] : 'the keys did not go through');
            log(`key     ${step.keys}`);
            break;
          }
          case 'text': {
            if (await foregroundIsSensitive()) { log('SKIPPED typing: a sign-in window is in front'); break; }
            const typed = await helperRequest('keys', { text: step.text.slice(0, 2000) }, 60_000);
            if (typed['ok'] !== true) throw new Error('the text did not go through');
            log(`text    ${JSON.stringify(step.text.slice(0, 60))}`);
            break;
          }
          default:
            break;
        }
      } catch (err) {
        failures++;
        log(`FAILED  ${summary}: ${(err as Error).message}`);
      }
    }
  } finally {
    const elapsed = Date.now() - started;
    const message = halted ? 'stopped' : failures ? `${failures} step${failures === 1 ? '' : 's'} failed` : 'done';
    log(`# end ${message} in ${elapsed} ms`);
    pushDesktopState({ busy: false, message });
    releaseDesktop();
    if (halted) turnDispatchFor(turnId, { type: 'stop' });
    else if (broken) failTurn(turnId, broken);
    else if (failures) failTurn(turnId, `${failures} STEP${failures === 1 ? '' : 'S'} FAILED`);
    else if (owns) void finishTurn(turnId, undefined, { word: plan.steps.length > 1 });
  }
  if (halted) return { ok: false, error: 'STOPPED' };
  if (failures) return { ok: false, error: `${failures} STEP${failures === 1 ? '' : 'S'} FAILED — SEE ${action.id}.replay.log` };
  return { ok: true };
}

/** Where the recordings are, for the hologram's save screen and the handoff. */
export function recordingsPath(): string {
  return existsSync(recordingsDir()) ? recordingsDir() : join(app.getPath('userData'), 'desktop', 'recordings');
}
