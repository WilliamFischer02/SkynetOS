import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { app, screen } from 'electron';
import {
  FOREGROUND,
  LAUNCH_WAIT_MS,
  MAX_PLAN_STEPS,
  appKey,
  defaultBrowser,
  desktopScript,
  isRefusedCombo,
  matchApp,
  monitorOf,
  monitorWord,
  numberMonitors,
  parseDesktopLine,
  placeIn,
  type AppEntry,
  type DesktopHelperPhase,
  type DesktopPlan,
  type DesktopResult,
  type DesktopState,
  type DesktopStatus,
  type DesktopStep,
  type DesktopStepResult,
  type DesktopWindow,
  type MonitorInfo,
  type Rect,
  type WindowLayout
} from '@shared/desktop.js';
import { getSettings, setDesktopEnabled as writeDesktopEnabled } from './settings.js';

/**
 * Desktop control (docs/11-JARVIS-VOICE.md § Desktop control; docs/07 § Desktop control).
 *
 * "Jarvis, open after effects on one and firefox on two." The sentence became a plan in
 * packages/shared/intent.ts; this file runs it: ONE hidden PowerShell helper (desktopScript) that
 * launches Start Menu shortcuts, places and focuses windows, walks the mouse visibly and presses
 * keys, one JSON line in and one out per step. It is a separate process from the read-only window
 * tracker, which keeps its contract (test/avatar-window.test.ts).
 *
 * The authority is narrow and the switch is William's:
 *  - nothing runs unless `settings.desktop.enabled` is true, written only by the user-only
 *    `desktop:setEnabled`;
 *  - a launch names a catalogue entry (a Start Menu .lnk, or a path he put in settings.json) and
 *    nothing else; the helper never sees a path main did not list;
 *  - the plan is capped at MAX_PLAN_STEPS, one plan at a time, and `haltPlan` (Esc in the hologram
 *    window, "stop") ends it between steps;
 *  - every step reports what it did, so the reply can say what is open and what is not.
 */

type Listener = (line: Record<string, unknown>) => void;

let child: ChildProcess | null = null;
let phase: DesktopHelperPhase = 'off';
let helperError: string | undefined;
let nextId = 1;
const waiting = new Map<number, { resolve: (v: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }>();
let readyWaiters: Array<(ok: boolean) => void> = [];
let busy = false;
let halted = false;
let catalogue: { at: number; entries: AppEntry[] } | null = null;
const CATALOGUE_TTL_MS = 30_000;
const HELPER_START_MS = 25_000;

/* ────────────────────────── handlers (index.ts) ────────────────────────── */

/** index.ts hands in where `desktop:state` goes (the board and the hologram). */
export interface DesktopHandlers { onState(state: DesktopState): void }
let desktopHandlers: DesktopHandlers | null = null;
export function setDesktopHandlers(next: DesktopHandlers): void { desktopHandlers = next; }
export function desktopHandlersInUse(): DesktopHandlers | null { return desktopHandlers; }

function push(state: DesktopState): void {
  try { desktopHandlers?.onState(state); } catch (err) { console.warn('[desktop] state listener threw', err); }
}

/* ────────────────────────── the helper ────────────────────────── */

function onLine(line: string): void {
  const parsed = parseDesktopLine(line);
  if (!parsed) { if (line.trim()) console.log(`[desktop] ${line.trim().slice(0, 200)}`); return; }
  if (parsed['ready'] === true) {
    phase = 'ready';
    helperError = undefined;
    const waiters = readyWaiters; readyWaiters = [];
    for (const w of waiters) w(true);
    return;
  }
  // TRAIN ACTION: the recorder streams {"rec": {...}} lines with no id (services/action-recorder.ts).
  if (parsed['rec'] && typeof parsed['rec'] === 'object') {
    for (const listener of recorderListeners) {
      try { listener(parsed['rec'] as Record<string, unknown>); } catch (err) { console.warn('[desktop] recorder listener threw', err); }
    }
    return;
  }
  const id = typeof parsed['id'] === 'number' ? parsed['id'] : -1;
  const entry = waiting.get(id);
  if (!entry) return;
  waiting.delete(id);
  clearTimeout(entry.timer);
  entry.resolve(parsed);
}

/* ────────────────────────── TRAIN ACTION hooks (services/action-recorder.ts) ────────────────────────── */

const recorderListeners = new Set<Listener>();

/** Every raw event the recorder emits while a recording is on. Returns the unsubscribe. */
export function onRecorderEvent(listener: Listener): () => void {
  recorderListeners.add(listener);
  return () => recorderListeners.delete(listener);
}

/** Start the helper if needed; true when it answers. */
export function ensureHelper(): Promise<boolean> { return startHelper(); }

/** One request to the helper, by op. Exposed for the recorder and the replay only. */
export function helperRequest(op: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  return request(op, params, timeoutMs);
}

/**
 * The desktop is one resource: a replay and a spoken plan never run at once, and `haltPlan`
 * (Esc, "stop", the switch) stops whichever is running. `acquireDesktop` is false when busy.
 */
export function acquireDesktop(): boolean {
  if (busy) return false;
  busy = true;
  halted = false;
  return true;
}
export function releaseDesktop(): void { busy = false; halted = false; }
export function desktopHalted(): boolean { return halted; }
export function pushDesktopState(state: DesktopState): void { push(state); }
export function desktopMonitors(): MonitorInfo[] { return monitors(); }
export function physicalToDip(rect: Rect): Rect { return toDip(rect); }
export function dipToPhysical(rect: Rect): Rect { return toPhysical(rect); }
export async function helperWindows(): Promise<{ h: number; title: string; pid: number; process: string; x: number; y: number; w: number; h2: number; min: boolean; fg: boolean }[]> {
  return rawWindows();
}

function failAll(reason: string): void {
  for (const [id, entry] of waiting) { clearTimeout(entry.timer); entry.resolve({ id, ok: false, error: reason }); }
  waiting.clear();
  const waiters = readyWaiters; readyWaiters = [];
  for (const w of waiters) w(false);
}

function startHelper(): Promise<boolean> {
  if (child && phase === 'ready') return Promise.resolve(true);
  if (child && phase === 'starting') return new Promise((resolve) => readyWaiters.push(resolve));
  phase = 'starting';
  // The script goes to a file in userData rather than -EncodedCommand: with the recorder it is
  // past what a command line may carry (32 K), and a file is readable when something goes wrong.
  let scriptFile: string;
  try {
    const dir = join(app.getPath('userData'), 'desktop');
    mkdirSync(dir, { recursive: true });
    scriptFile = join(dir, 'helper.ps1');
    writeFileSync(scriptFile, desktopScript(), 'utf8');
  } catch (err) {
    phase = 'unavailable';
    helperError = `COULD NOT WRITE THE DESKTOP HELPER SCRIPT — ${(err as Error).message}`;
    return Promise.resolve(false);
  }
  let proc: ChildProcess;
  try {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    phase = 'unavailable';
    helperError = `COULD NOT START THE DESKTOP HELPER — ${(err as Error).message}`;
    return Promise.resolve(false);
  }
  child = proc;
  let buffer = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let nl = buffer.indexOf('\n');
    while (nl !== -1) { onLine(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); nl = buffer.indexOf('\n'); }
  });
  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); });
  proc.on('error', (err) => { helperError = err.message; });
  proc.on('exit', (code) => {
    if (child === proc) child = null;
    const tail = stderr.trim().split(/\r?\n/).pop();
    phase = 'unavailable';
    helperError = `THE DESKTOP HELPER EXITED (${code ?? '?'})${tail ? ` — ${tail}` : ''}`;
    console.warn(`[desktop] ${helperError}`);
    failAll(helperError);
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (phase !== 'ready') {
        helperError = 'THE DESKTOP HELPER DID NOT ANSWER IN 25 SECONDS';
        phase = 'unavailable';
        resolve(false);
      }
    }, HELPER_START_MS);
    readyWaiters.push((ok) => { clearTimeout(timer); resolve(ok); });
  });
}

function request(op: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  if (!child || phase !== 'ready' || !child.stdin) return Promise.resolve({ ok: false, error: helperError ?? 'THE DESKTOP HELPER IS NOT RUNNING' });
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waiting.delete(id); resolve({ id, ok: false, error: `THE HELPER DID NOT ANSWER "${op}" IN ${Math.round(timeoutMs / 1000)} S` }); }, timeoutMs);
    waiting.set(id, { resolve, timer });
    child!.stdin!.write(`${JSON.stringify({ id, op, ...params })}\n`);
  });
}

export function stopDesktop(): void {
  halted = true;
  if (child) { const old = child; child = null; try { old.stdin?.end(); } catch { /* going anyway */ } old.kill(); }
  phase = 'off';
  failAll('SKYNETOS IS CLOSING');
}

/* ────────────────────────── monitors, windows, catalogue ────────────────────────── */

function monitors(): MonitorInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  return numberMonitors(
    screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label ?? '', bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, primary: d.id === primary })),
    getSettings().desktop.monitors ?? []
  );
}

function toDip(rect: Rect): Rect {
  const conv = (screen as unknown as { screenToDipRect?: (w: null, r: Rect) => Rect }).screenToDipRect;
  if (typeof conv === 'function') return conv.call(screen, null, rect);
  const f = screen.getPrimaryDisplay().scaleFactor || 1;
  return { x: Math.round(rect.x / f), y: Math.round(rect.y / f), width: Math.round(rect.width / f), height: Math.round(rect.height / f) };
}

function toPhysical(rect: Rect): Rect {
  const conv = (screen as unknown as { dipToScreenRect?: (w: null, r: Rect) => Rect }).dipToScreenRect;
  if (typeof conv === 'function') return conv.call(screen, null, rect);
  const f = screen.getPrimaryDisplay().scaleFactor || 1;
  return { x: Math.round(rect.x * f), y: Math.round(rect.y * f), width: Math.round(rect.width * f), height: Math.round(rect.height * f) };
}

interface RawWindow { h: number; title: string; pid: number; process: string; x: number; y: number; w: number; h2: number; min: boolean; fg: boolean }

async function rawWindows(): Promise<RawWindow[]> {
  const answer = await request('windows');
  if (answer['ok'] !== true || !Array.isArray(answer['windows'])) return [];
  return (answer['windows'] as RawWindow[]).filter((w) => typeof w.h === 'number');
}

function toWindow(w: RawWindow, mons: MonitorInfo[]): DesktopWindow {
  const dip = toDip({ x: w.x, y: w.y, width: w.w, height: w.h2 });
  return { handle: w.h, title: w.title, process: w.process ?? '', ...dip, minimized: !!w.min, foreground: !!w.fg, monitor: monitorOf(dip, mons) };
}

export async function listDesktopWindows(): Promise<DesktopWindow[]> {
  if (!(await startHelper())) return [];
  const mons = monitors();
  return (await rawWindows()).map((w) => toWindow(w, mons));
}

function startMenuRoots(): string[] {
  const roots: string[] = [];
  if (process.env['APPDATA']) roots.push(join(process.env['APPDATA'], 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (process.env['ProgramData']) roots.push(join(process.env['ProgramData'], 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return roots.filter((r) => existsSync(r));
}

function walk(dir: string, out: AppEntry[], depth = 0): void {
  if (depth > 4) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full, out, depth + 1); continue; }
    if (extname(entry).toLowerCase() !== '.lnk') continue;
    const name = basename(entry, extname(entry));
    if (/^(uninstall|readme|release notes|help|documentation|license|website|support)/i.test(name)) continue;
    out.push({ name, path: full, source: 'startmenu' });
  }
}

/** Every program a spoken name may mean: settings first (they win), then the Start Menu, cached 30 s. */
export function listApps(): AppEntry[] {
  const now = Date.now();
  if (catalogue && now - catalogue.at < CATALOGUE_TTL_MS) return catalogue.entries;
  const entries: AppEntry[] = [];
  for (const [name, path] of Object.entries(getSettings().desktop.apps ?? {})) {
    if (typeof path === 'string' && path.trim()) entries.push({ name, path: path.trim(), source: 'settings' });
  }
  for (const root of startMenuRoots()) walk(root, entries);
  // One entry per key: the first (settings, then the user's Start Menu before the machine's).
  const seen = new Set<string>();
  const unique = entries.filter((e) => { const k = `${e.source}:${appKey(e.name)}`; if (!k || seen.has(k)) return false; seen.add(k); return true; });
  catalogue = { at: now, entries: unique };
  return unique;
}

/* ────────────────────────── status and switch ────────────────────────── */

export function desktopStatus(): DesktopStatus {
  const s = getSettings().desktop;
  return {
    enabled: s.enabled === true,
    helper: phase,
    busy,
    monitors: monitors(),
    apps: listApps().length,
    ...(helperError ? { error: helperError } : {})
  };
}

export function setDesktopEnabled(on: boolean): DesktopStatus {
  const written = writeDesktopEnabled(on);
  if (!written.ok) throw new Error(written.error ?? 'COULD NOT SAVE THE DESKTOP SETTING');
  if (!on) haltPlan();
  return desktopStatus();
}

export function haltPlan(): { ok: boolean } {
  if (!busy) return { ok: false };
  halted = true;
  return { ok: true };
}

/* ────────────────────────── the steps ────────────────────────── */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function fail(message: string): { ok: false; message: string } { return { ok: false, message }; }

async function lnkTarget(path: string): Promise<string> {
  if (extname(path).toLowerCase() !== '.lnk') return path;
  const answer = await request('lnk', { path });
  return answer['ok'] === true && typeof answer['target'] === 'string' ? answer['target'] : '';
}

function processKey(path: string): string {
  return basename(path, extname(path)).toLowerCase();
}

function looksMain(w: RawWindow): boolean {
  return !w.min && w.w >= 300 && w.h2 >= 200;
}

/** Wait for the launched program's window: by pid first, else by process name, largest wins. */
async function awaitWindow(before: Set<number>, pid: number, processNames: string[], titleWords: string[]): Promise<RawWindow | null> {
  const deadline = Date.now() + LAUNCH_WAIT_MS;
  let candidate: RawWindow | null = null;
  let firstSeenAt = 0;
  while (Date.now() < deadline) {
    if (halted) return null;
    const fresh = (await rawWindows()).filter((w) => !before.has(w.h) && looksMain(w));
    const byPid = fresh.filter((w) => pid && w.pid === pid);
    const byName = fresh.filter((w) => processNames.includes((w.process ?? '').toLowerCase()));
    const byTitle = fresh.filter((w) => titleWords.some((word) => w.title.toLowerCase().includes(word)));
    const pool = byPid.length ? byPid : byName.length ? byName : byTitle;
    if (pool.length) {
      const largest = pool.sort((a, b) => b.w * b.h2 - a.w * a.h2)[0]!;
      if (!candidate) { candidate = largest; firstSeenAt = Date.now(); }
      else candidate = largest;
      // A splash comes first; give the main window a moment to replace it.
      if (Date.now() - firstSeenAt >= 1500) return candidate;
    }
    await sleep(400);
  }
  return candidate;
}

async function findWindow(name: string, mons: MonitorInfo[]): Promise<DesktopWindow | null> {
  const all = (await rawWindows()).map((w) => toWindow(w, mons));
  if (name === FOREGROUND) return all.find((w) => w.foreground) ?? null;
  const key = appKey(name);
  const words = key.split(' ').filter(Boolean);
  const byTitle = all.filter((w) => !w.minimized || true).filter((w) => words.length && words.every((word) => w.title.toLowerCase().includes(word)));
  if (byTitle.length) return byTitle.sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
  const app = matchApp(name, listApps());
  if (app) {
    const target = await lnkTarget(app.path);
    const proc = target ? processKey(target) : '';
    const byProcess = all.filter((w) => proc && w.process.toLowerCase() === proc);
    if (byProcess.length) return byProcess.sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
  }
  return null;
}

async function placeWindow(handle: number, monitor: number, layout: WindowLayout | undefined, mons: MonitorInfo[]): Promise<{ ok: boolean; message: string }> {
  const target = mons.find((m) => m.index === monitor);
  if (!target) return fail(`There is no monitor ${monitorWord(monitor)}; ${mons.length === 1 ? 'one is' : `${monitorWord(mons.length)} are`} attached.`);
  const rect = toPhysical(placeIn(target.work, layout ?? 'fill'));
  const answer = await request('place', { h: handle, x: rect.x, y: rect.y, w: rect.width, height: rect.height });
  if (answer['ok'] !== true) return fail(`Windows would not move that window${typeof answer['error'] === 'string' ? ` — ${answer['error']}` : ''}.`);
  await request('focus', { h: handle });
  return { ok: true, message: `placed on ${monitorWord(monitor)}` };
}

async function runStep(step: DesktopStep, mons: MonitorInfo[]): Promise<{ ok: boolean; message: string }> {
  const settings = getSettings().desktop;
  switch (step.kind) {
    case 'launch': {
      const apps = listApps();
      const app = matchApp(step.app, apps) ?? apps.find((a) => a.name === step.app) ?? null;
      if (!app) return fail(`I do not see a program called ${step.app} in the Start Menu; add it to settings.json desktop.apps.`);
      if (!apps.some((a) => a.path === app.path)) return fail('That path is not in the catalogue.');
      const before = new Set((await rawWindows()).map((w) => w.h));
      const target = await lnkTarget(app.path);
      const launched = await request('launch', { path: app.path }, 30_000);
      if (launched['ok'] !== true) return fail(`${app.name} would not start${typeof launched['error'] === 'string' ? ` — ${launched['error']}` : ''}.`);
      const pid = typeof launched['pid'] === 'number' ? launched['pid'] : 0;
      const names = [target ? processKey(target) : '', processKey(app.path)].filter(Boolean);
      const win = await awaitWindow(before, pid, names, appKey(app.name).split(' ').filter((w) => w.length > 2));
      if (!win) return fail(`${app.name} did not show a window in twenty seconds; it may still be starting.`);
      if (step.monitor) return placeWindow(win.h, step.monitor, step.layout, mons);
      await request('focus', { h: win.h });
      return { ok: true, message: 'open' };
    }
    case 'url': {
      const apps = listApps();
      const browser = step.browser ? matchApp(step.browser, apps) : defaultBrowser(apps);
      if (!browser) return fail('No browser is in the Start Menu; add one to settings.json desktop.apps.');
      if (!/^https?:\/\//i.test(step.url)) return fail('Only an http or https address opens by voice.');
      const before = new Set((await rawWindows()).map((w) => w.h));
      const target = await lnkTarget(browser.path);
      const launched = await request('launch', { path: browser.path, args: [step.url] }, 30_000);
      if (launched['ok'] !== true) return fail(`${browser.name} would not start${typeof launched['error'] === 'string' ? ` — ${launched['error']}` : ''}.`);
      const pid = typeof launched['pid'] === 'number' ? launched['pid'] : 0;
      const names = [target ? processKey(target) : '', processKey(browser.path)].filter(Boolean);
      // A browser already open takes the URL in an existing window and spawns nothing new.
      let win: RawWindow | null = await awaitWindow(before, pid, names, []);
      if (!win) {
        const existing = (await rawWindows()).filter((w) => names.includes((w.process ?? '').toLowerCase()) && looksMain(w));
        win = existing.sort((a, b) => (b.fg ? 1 : 0) - (a.fg ? 1 : 0) || b.w * b.h2 - a.w * a.h2)[0] ?? null;
      }
      if (!win) return fail(`${browser.name} did not show a window in twenty seconds.`);
      if (step.monitor) return placeWindow(win.h, step.monitor, undefined, mons);
      await request('focus', { h: win.h });
      return { ok: true, message: 'open' };
    }
    case 'place': {
      const win = await findWindow(step.window, mons);
      if (!win) return fail(step.window === FOREGROUND ? 'Nothing is in front to move.' : `I do not see a window for ${step.window}; is it open?`);
      return placeWindow(win.handle, step.monitor, step.layout, mons);
    }
    case 'focus': {
      const win = await findWindow(step.window, mons);
      if (!win) return fail(`I do not see a window for ${step.window}.`);
      const answer = await request('focus', { h: win.handle });
      return answer['ok'] === true ? { ok: true, message: 'in front' } : fail('Windows would not bring it forward.');
    }
    case 'mouse': {
      const mon = step.monitor ? mons.find((m) => m.index === step.monitor) : null;
      if (step.monitor && !mon) return fail(`There is no monitor ${monitorWord(step.monitor)}.`);
      const dip = { x: (mon?.x ?? 0) + step.x, y: (mon?.y ?? 0) + step.y, width: 1, height: 1 };
      const phys = toPhysical(dip);
      const moved = await request('mouse', { x: phys.x, y: phys.y, travelMs: settings.mouseTravelMs ?? 450 }, 10_000);
      if (moved['ok'] !== true) return fail('The mouse would not move.');
      if (step.click) {
        const clicked = await request('click', { button: step.click });
        if (clicked['ok'] !== true) return fail('The click did not go through.');
      }
      return { ok: true, message: step.click ? `${step.click} click` : 'moved' };
    }
    case 'keys': {
      if (step.combo) {
        if (isRefusedCombo(step.combo)) return fail(`${step.combo} closes or locks the machine, which is yours to do.`);
        const answer = await request('combo', { keys: step.combo.toLowerCase().split('+').map((k) => k.trim()).filter(Boolean) });
        return answer['ok'] === true ? { ok: true, message: step.combo } : fail(typeof answer['error'] === 'string' ? answer['error'] : 'The keys did not go through.');
      }
      if (step.text) {
        const answer = await request('keys', { text: step.text.slice(0, 2000) }, 60_000);
        return answer['ok'] === true ? { ok: true, message: 'typed' } : fail('The text did not go through.');
      }
      return fail('A keys step needs text or a combination.');
    }
    case 'wait':
      await sleep(Math.max(0, Math.min(10_000, step.ms)));
      return { ok: true, message: `waited ${step.ms} ms` };
    case 'say':
      return { ok: true, message: step.text };
  }
}

/* ────────────────────────── the plan ────────────────────────── */

export async function runPlan(plan: DesktopPlan): Promise<DesktopResult> {
  const refuse = (message: string): DesktopResult => ({ ok: false, message, steps: [], halted: false });
  const settings = getSettings().desktop;
  if (settings.enabled !== true) return refuse('DESKTOP CONTROL IS OFF — THE DESKTOP SWITCH IN THE HOLOGRAM WINDOW, OR settings.json desktop.enabled');
  if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return refuse('THERE IS NOTHING TO DO IN THAT PLAN');
  if (plan.steps.length > MAX_PLAN_STEPS) return refuse(`THAT IS ${plan.steps.length} STEPS; A SPOKEN PLAN STOPS AT ${MAX_PLAN_STEPS}`);
  if (busy) return refuse('THE DESKTOP IS STILL BUSY WITH THE LAST REQUEST — SAY STOP, OR WAIT');

  busy = true;
  halted = false;
  const results: DesktopStepResult[] = [];
  try {
    push({ busy: true, index: 0, total: plan.steps.length, message: 'starting the desktop helper' });
    if (!(await startHelper())) {
      return { ok: false, message: helperError ?? 'THE DESKTOP HELPER COULD NOT START', steps: [], halted: false };
    }
    const mons = monitors();
    for (let i = 0; i < plan.steps.length; i++) {
      if (halted) break;
      const step = plan.steps[i]!;
      push({ busy: true, index: i, total: plan.steps.length, step, message: describe(step) });
      const started = Date.now();
      let outcome: { ok: boolean; message: string };
      try {
        outcome = await runStep(step, mons);
      } catch (err) {
        outcome = fail((err as Error).message || 'that step failed');
      }
      results.push({ step, ...outcome, ms: Date.now() - started });
      console.log(`[desktop] ${describe(step)} → ${outcome.ok ? 'ok' : 'FAILED'}: ${outcome.message}`);
      if (i < plan.steps.length - 1 && !halted) await sleep(Math.max(0, settings.stepDelayMs ?? 250));
    }
    const ok = results.length === plan.steps.length && results.every((r) => r.ok);
    const message = ok ? 'done' : halted ? 'stopped' : results.find((r) => !r.ok)?.message ?? 'not finished';
    return { ok, message, steps: results, halted };
  } finally {
    busy = false;
    push({ busy: false, message: halted ? 'stopped' : 'done' });
    halted = false;
  }
}

function describe(step: DesktopStep): string {
  switch (step.kind) {
    case 'launch': return `opening ${step.app}${step.monitor ? ` on ${monitorWord(step.monitor)}` : ''}`;
    case 'url': return `opening ${step.site ?? step.url}${step.browser ? ` in ${step.browser}` : ''}`;
    case 'place': return `moving ${step.window === FOREGROUND ? 'that' : step.window} to ${monitorWord(step.monitor)}`;
    case 'focus': return `bringing ${step.window} forward`;
    case 'mouse': return step.click ? `${step.click} click at ${step.x},${step.y}` : `mouse to ${step.x},${step.y}`;
    case 'keys': return step.combo ? `pressing ${step.combo}` : 'typing';
    case 'wait': return `waiting ${step.ms} ms`;
    case 'say': return step.text;
  }
}
