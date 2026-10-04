import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACK_LINES, ackFile, ackLookup, ackText, ackToBuild, normaliseAckIndex, type AckIndex } from '@shared/ack.js';

/**
 * The acknowledgement bank on disk (packages/shared/ack.ts; docs/11 § Where the time goes; docs/07
 * § JARVIS Voice). At warm-up the short lines JARVIS says most are synthesised ONCE through the
 * profile's checkpoint into
 *
 *   %LOCALAPPDATA%/SkynetOS/voice-profiles/<profile>/ack/<hash>.wav    (+ ack/index.json)
 *
 * and `say` plays a banked line from there instead of synthesising it again (1,020–1,070 ms saved
 * per line, measured). The hash covers profile, checkpoint and text; index.json names the
 * checkpoint, and a different one rebuilds the bank. A missing entry falls through to synthesis.
 * Never uploaded, never in the repo, never a recording of William: synthesis output only.
 *
 * No Electron here: speech.ts hands in the folder and the synthesiser.
 */

export interface AckBankDeps {
  /** `<profiles root>/<profile>`. */
  profileDir(profile: string): string;
  /** One line through the server, as WAV bytes, or null. */
  synthesise(text: string, profile: string): Promise<Uint8Array | null>;
  /** True while JARVIS is saying or synthesising something: the bank waits, a real line never does. */
  busy(): boolean;
  /** Still the same profile and backend, and the server still up: false stops a build. */
  stillWanted(profile: string): boolean;
}

const cache = new Map<string, { mtimeMs: number; index: AckIndex | null }>();
let building: Promise<number> | null = null;

function ackDir(deps: Pick<AckBankDeps, 'profileDir'>, profile: string): string {
  return join(deps.profileDir(profile), 'ack');
}

/** index.json, re-read only when it changed on disk. */
export function readAckIndex(deps: Pick<AckBankDeps, 'profileDir'>, profile: string): AckIndex | null {
  const file = join(ackDir(deps, profile), 'index.json');
  let mtimeMs = -1;
  try { mtimeMs = statSync(file).mtimeMs; } catch { cache.set(file, { mtimeMs: -1, index: null }); return null; }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.index;
  let index: AckIndex | null = null;
  try { index = normaliseAckIndex(JSON.parse(readFileSync(file, 'utf8'))); } catch { index = null; }
  cache.set(file, { mtimeMs, index });
  return index;
}

/**
 * The banked WAV for exactly this text, or null. `checkpoint` is what the server last said the
 * profile speaks with (null when not known yet: the index's own checkpoint is trusted then).
 */
export function bankedWav(deps: Pick<AckBankDeps, 'profileDir'>, profile: string, checkpoint: string | null, text: string): string | null {
  if (!profile) return null;
  const index = readAckIndex(deps, profile);
  const file = ackLookup(index, profile, checkpoint, text);
  if (!file) return null;
  const path = join(ackDir(deps, profile), file);
  return existsSync(path) ? path : null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Synthesise what the bank lacks for this profile and checkpoint, one line at a time, each only
 * while nothing else is being said or synthesised. Returns how many lines were written. One build
 * at a time; a second call while one runs joins it.
 */
export function buildAckBank(deps: AckBankDeps, profile: string, checkpoint: string, lines: readonly string[] = ACK_LINES): Promise<number> {
  if (building) return building;
  building = (async () => {
    const dir = ackDir(deps, profile);
    const current = readAckIndex(deps, profile);
    const { rebuild, missing } = ackToBuild(current, profile, checkpoint, lines);
    if (!missing.length) return 0;
    mkdirSync(dir, { recursive: true });
    const index: AckIndex = { profile, checkpoint, builtAt: new Date().toISOString(), lines: rebuild ? {} : { ...current!.lines } };
    const started = Date.now();
    let written = 0;
    console.log(`[speech] ${rebuild ? 'building' : 'topping up'} the acknowledgement bank for ${profile} on ${checkpoint}: ${missing.length} line(s)`);
    for (const text of missing) {
      // A real line always goes first: wait while anything is said or synthesised.
      while (deps.busy()) {
        if (!deps.stillWanted(profile)) return written;
        await sleep(250);
      }
      if (!deps.stillWanted(profile)) break;
      const wav = await deps.synthesise(text, profile);
      if (!wav) { console.log(`[speech] the bank could not synthesise "${text}"; it will be synthesised when said`); continue; }
      const name = ackFile(profile, checkpoint, text);
      try {
        writeFileSync(join(dir, name), wav);
        index.lines[ackText(text)] = name;
        index.builtAt = new Date().toISOString();
        // After every line, so a build cut short still banks what it made.
        writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
        written++;
      } catch (err) {
        console.warn('[speech] could not write the acknowledgement bank:', (err as Error).message);
        break;
      }
    }
    console.log(`[speech] acknowledgement bank: ${written} line(s) in ${Math.round((Date.now() - started) / 100) / 10} s`);
    return written;
  })().finally(() => { building = null; });
  return building;
}

/** For tests. */
export function clearAckCache(): void {
  cache.clear();
}
