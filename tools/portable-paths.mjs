#!/usr/bin/env node
/**
 * Make the boards portable, and report what cannot be.
 *
 * ── The problem ──────────────────────────────────────────────────────────────────────────────
 *
 * A board is the save file. William: "the repo will serve as the save between." But paths inside
 * it were written absolutely, so twenty-six of them pointed at files INSIDE this very repo as
 * `C:/dev/SkynetOS/assets/sprites/...`. Clone the repo anywhere else — a different folder, a
 * different username, a different machine — and every wallpaper, every logo and the JARVIS persona
 * resolves as missing, for files sitting right there in the checkout.
 *
 * ── What it rewrites ─────────────────────────────────────────────────────────────────────────
 *
 *   inside the repo        ->  %SKYNET%/...        follows the clone, wherever it lands
 *   under the user profile ->  %USERPROFILE%/...   follows the account, whatever it is called
 *
 * ── What it deliberately does NOT rewrite ────────────────────────────────────────────────────
 *
 * Anything else. `C:/dev/TheStalker` is a true statement about one machine, and there is no token
 * that makes it true somewhere else. Pretending otherwise would turn "this points at a repo you
 * have not cloned yet" into "this points at something that does not exist and never will". Those
 * are listed at the end instead, so you know exactly what to create on the new machine — and the
 * moment you do, they relink on their own, because resolution happens at render time and nothing
 * is cached.
 *
 * Run with --check to report without writing. `npm run verify` does that, so a board that drifts
 * back to absolute paths fails the build rather than quietly stopping being portable.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(process.cwd()).replace(/\\/g, '/');
const HOME = (process.env.USERPROFILE ?? process.env.HOME ?? '').replace(/\\/g, '/');
const check = process.argv.includes('--check');

/** Every `*.board.json` under board/, recursively. */
function boards(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === '.snapshots') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) boards(p, out);
    else if (p.endsWith('.board.json')) out.push(p);
  }
  return out;
}

const startsWith = (path, prefix) =>
  prefix && path.toLowerCase().startsWith(prefix.toLowerCase() + '/');

/** The portable spelling of an absolute path, or null if there is not one. */
function portable(value) {
  const p = value.replace(/\\/g, '/');
  if (startsWith(p, REPO)) return `%SKYNET%/${p.slice(REPO.length + 1)}`;
  if (startsWith(p, HOME)) return `%USERPROFILE%/${p.slice(HOME.length + 1)}`;
  return null;
}

const isAbsolute = (v) => typeof v === 'string' && /^[A-Za-z]:[\\/]/.test(v);

let rewritten = 0;
let changedFiles = 0;
const machineSpecific = new Map();

for (const file of boards('board')) {
  const text = readFileSync(file, 'utf8');
  const board = JSON.parse(text);
  let touched = false;

  const walk = (object) => {
    for (const [key, value] of Object.entries(object)) {
      if (isAbsolute(value)) {
        const better = portable(value);
        if (better) {
          object[key] = better;
          rewritten++;
          touched = true;
        } else {
          const list = machineSpecific.get(value) ?? [];
          list.push(`${file.replace(/\\/g, '/')}  ${object.id ?? key}`);
          machineSpecific.set(value, list);
        }
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => {
          if (isAbsolute(v)) {
            const better = portable(v);
            if (better) { value[i] = better; rewritten++; touched = true; }
            else {
              const list = machineSpecific.get(v) ?? [];
              list.push(`${file.replace(/\\/g, '/')}  ${object.id ?? key}[${i}]`);
              machineSpecific.set(v, list);
            }
          } else if (v && typeof v === 'object') walk(v);
        });
      } else if (value && typeof value === 'object') walk(value);
    }
  };

  for (const node of board.nodes) walk(node);

  if (touched) {
    changedFiles++;
    if (!check) writeFileSync(file, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  }
}

if (check) {
  if (rewritten) {
    console.error(`\n${rewritten} absolute path(s) in board/ point inside this repo or your profile.`);
    console.error('They will not resolve on another machine. Run:  npm run paths:portable\n');
    process.exit(1);
  }
  console.log('Board paths are portable.');
} else {
  console.log(
    rewritten
      ? `Rewrote ${rewritten} path(s) across ${changedFiles} board file(s) to %SKYNET% / %USERPROFILE%.`
      : 'Nothing to rewrite — board paths are already portable.'
  );
}

if (machineSpecific.size) {
  console.log(`\n${machineSpecific.size} path(s) name somewhere outside this repo. These are left as they are:`);
  for (const [path, where] of [...machineSpecific].sort()) {
    console.log(`  ${path}`);
    for (const w of where.slice(0, 3)) console.log(`      ${w}`);
  }
  console.log('\nOn a new machine these render as broken until the folder or program exists.');
  console.log('Create it, or repoint the node in the inspector (F2), and it relinks immediately.');
}
