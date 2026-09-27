/**
 * npm run speech:finetune -- <prepare|train|status|stop --yes|prune|apply|eval> <profile> [flags]
 * npm run speech:eval     -- <profile>            (the same as `speech:finetune -- eval <profile>`)
 *
 * The thin side of tools/speech-finetune.py: finds the venv `npm run speech:install` made, runs the
 * Python with the same arguments, and prints the status in lines a person can read. All the
 * decisions (which clips, which flags, how a checkpoint is pruned) are in the Python, because they
 * run inside the venv; this file only knows where the venv is and how to read `status`.
 *
 * `stop` is refused without `--yes`: stopping throws away everything since the last checkpoint, and
 * an unattended session must not decide that. Nothing here commits, deletes, or uploads.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const COMMANDS = ['prepare', 'train', 'status', 'stop', 'prune', 'apply', 'eval'] as const;
export type FinetuneCommand = (typeof COMMANDS)[number];

/** The venv's interpreter, as services/speech.ts `synthPython()` finds it (copied, not imported: no Electron here). */
export function venvPython(local = process.env['LOCALAPPDATA'] ?? ''): string {
  return join(local, 'SkynetOS', 'voice', 'tts', 'venv', 'Scripts', 'python.exe');
}

/** Parse `[cmd, profile, ...flags]`; a bad shape returns the reason instead of an argv. */
export function parseArgs(argv: readonly string[]): { command: FinetuneCommand; profile: string; flags: string[] } | { error: string } {
  const [command, profile, ...flags] = argv;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    return { error: `NAME A COMMAND: ${COMMANDS.join(' | ')}` };
  }
  if (!profile || /[\\/]|\.\./.test(profile)) return { error: 'NAME A PROFILE (a folder name under voice-profiles, no slashes)' };
  if (command === 'stop' && !flags.includes('--yes')) {
    return { error: 'STOPPING TRAINING THROWS AWAY EVERYTHING SINCE THE LAST CHECKPOINT — ADD --yes IF WILLIAM SAID SO' };
  }
  return { command: command as FinetuneCommand, profile, flags };
}

export interface TrainStatus {
  profile: string;
  running: boolean;
  pid: number | null;
  started: string | null;
  elapsedMin: number | null;
  update: number | null;
  loss: number | null;
  epoch: number | null;
  epochs: number | null;
  updatesPerEpoch: number | null;
  totalUpdates: number | null;
  secPerUpdate: number | null;
  etaHours: number | null;
  lastSaved: number | null;
  checkpoints: { file: string; mb: number; modified: string }[];
  gpu: { usedMiB: number; totalMiB: number } | null;
  error: string | null;
  log: string;
}

/** The last JSON object on stdout: the Python prints progress lines first, then one JSON line. */
export function lastJson<T>(stdout: string): T | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith('{')) continue;
    try { return JSON.parse(line) as T; } catch { /* not this one */ }
  }
  return null;
}

/** Status as lines: what is running, how far, how fast, when it ends, what is on disk. */
export function describeStatus(s: TrainStatus): string[] {
  const out: string[] = [];
  const state = s.running ? `RUNNING (pid ${s.pid})` : s.error ? 'STOPPED WITH AN ERROR' : s.update ? 'NOT RUNNING' : 'NOT STARTED';
  out.push(`${s.profile}: ${state}${s.elapsedMin !== null ? ` · ${s.elapsedMin} min since start` : ''}`);
  if (s.update !== null) {
    const of = s.totalUpdates ? ` of ${s.totalUpdates}` : '';
    const epoch = s.epoch !== null && s.epochs !== null ? ` · epoch ${s.epoch}/${s.epochs}` : '';
    out.push(`update ${s.update}${of}${epoch}${s.loss !== null ? ` · loss ${s.loss.toFixed(4)}` : ''}`);
  }
  if (s.secPerUpdate !== null) {
    out.push(`${s.secPerUpdate} s per update${s.etaHours !== null ? ` · about ${s.etaHours} h to go` : ''}`);
  }
  if (s.lastSaved !== null) out.push(`last checkpoint saved at update ${s.lastSaved}`);
  if (s.checkpoints.length) out.push(`on disk: ${s.checkpoints.map((c) => `${c.file} (${c.mb} MB)`).join(', ')}`);
  else out.push('on disk: no checkpoint yet');
  if (s.gpu) out.push(`gpu: ${s.gpu.usedMiB} of ${s.gpu.totalMiB} MiB in use`);
  if (s.error) out.push(`ERROR: ${s.error}`);
  out.push(`log: ${s.log}`);
  return out;
}

function main(): void {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    console.log(parsed.error);
    process.exitCode = 2;
    return;
  }
  const py = venvPython();
  if (!existsSync(py)) {
    console.log(`NO SYNTHESIS ENVIRONMENT AT ${py} — RUN npm run speech:install`);
    process.exitCode = 1;
    return;
  }
  const script = join(process.cwd(), 'tools', 'speech-finetune.py');
  const result = spawnSync(py, [script, parsed.command, parsed.profile, ...parsed.flags], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  const stdout = result.stdout ?? '';
  const stderr = (result.stderr ?? '').split(/\r?\n/).filter((l) => l.trim() && !/Warning|warnings\.warn|flop_counter|triton not found/.test(l)).join('\n');
  if (parsed.command === 'status') {
    const status = lastJson<TrainStatus>(stdout);
    if (status) for (const line of describeStatus(status)) console.log(line);
    else console.log(stdout.trim() || 'NO STATUS');
  } else {
    // Progress lines as they came, minus the JSON tail, which is for scripts.
    for (const line of stdout.split(/\r?\n/)) if (line.trim() && !line.trim().startsWith('{')) console.log(line);
    const tail = lastJson<Record<string, unknown>>(stdout);
    if (tail && parsed.command === 'train') console.log(`pid ${String(tail['pid'])} · log ${String(tail['log'])}`);
    if (tail && parsed.command === 'prepare') console.log(`${String(tail['clips'])} clips · ${String(tail['minutes'])} min · ${String(tail['heldout'])} held out`);
  }
  if (stderr) console.log(stderr);
  process.exitCode = result.status ?? 1;
}

// Run only as a script; the test imports the pure functions above. vite-node strips the script
// path out of process.argv, so the script cannot recognise itself there; vitest sets VITEST instead.
if (!process.env['VITEST']) main();
