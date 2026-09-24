#!/usr/bin/env node
/**
 * Cut a release: bump the version, verify, and build the installer.
 *
 *   npm run release -- patch      0.1.0 -> 0.1.1   (the default)
 *   npm run release -- minor      0.1.1 -> 0.2.0
 *   npm run release -- major      0.2.0 -> 1.0.0
 *   npm run release -- 0.4.2      exactly that
 *   npm run release -- --same     rebuild the current version, no bump
 *   npm run release -- --public   for publishing: the installer does not record this machine's repo path
 *
 * What it does, in order, stopping at the first failure:
 *   1. writes the new version into package.json and package-lock.json;
 *   2. `npm run dist`: verify, icon, app build, build-info, then electron-builder for NSIS;
 *   3. prints what was made and the two ways to ship it.
 *
 * What it never does: commit, tag, push, or upload. Those are William's (docs/07). If the build
 * fails after the bump, the version is put back, so a failed release leaves no trace.
 *
 * The full workflow is docs/09-RELEASE.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgFile = join(repo, 'package.json');
const lockFile = join(repo, 'package-lock.json');

const arg = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'patch';
const same = process.argv.includes('--same');

function bump(version, part) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`package.json version is not x.y.z: ${version}`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (/^\d+\.\d+\.\d+$/.test(part)) return part;
  throw new Error(`not a version or a part: ${part} (use patch, minor, major or x.y.z)`);
}

/** Replace the version by text, not by re-serialising: the file keeps its own formatting. */
function writeVersion(file, from, to, occurrences) {
  let text = readFileSync(file, 'utf8');
  let done = 0;
  text = text.replace(new RegExp(`("version":\\s*")${from.replace(/\./g, '\\.')}(")`, 'g'), (whole, a, b) => {
    done += 1;
    return done <= occurrences ? `${a}${to}${b}` : whole;
  });
  if (done < occurrences) throw new Error(`${file}: expected the version ${from} ${occurrences} time(s), found ${done}`);
  writeFileSync(file, text);
}

const before = JSON.parse(readFileSync(pkgFile, 'utf8')).version;
const after = same ? before : bump(before, arg);

const setVersion = (from, to) => {
  if (from === to) return;
  writeVersion(pkgFile, from, to, 1);
  // The lockfile names the root package twice at the top: once plain, once under packages[""].
  if (existsSync(lockFile)) writeVersion(lockFile, from, to, 2);
};

try {
  setVersion(before, after);
} catch (err) {
  console.error(`release: ${err.message}`);
  process.exit(1);
}
console.log(`release: ${before} -> ${after}`);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env };
delete env.npm_config_allow_scripts; // the Claude Code shell sets it and npm refuses it (handoff.md)
// --public: leave the build folder's path out of the installer (tools/build-info.mjs).
if (process.argv.includes('--public')) env.SKYNET_PUBLIC_BUILD = '1';
const result = spawnSync(npm, ['run', 'dist'], { cwd: repo, stdio: 'inherit', env, shell: process.platform === 'win32' });

if (result.status !== 0) {
  try { setVersion(after, before); } catch (err) { console.error(`release: could not put the version back: ${err.message}`); }
  console.error(`\nrelease: the build failed, so the version is back at ${before}. Nothing was made.`);
  process.exit(result.status ?? 1);
}

const installer = join(repo, 'release', `SkynetOS-${after}-x64.exe`);
const size = existsSync(installer) ? `${(statSync(installer).size / 1_048_576).toFixed(1)} MB` : 'NOT FOUND';
console.log(`
release: built ${after}
  installer   release/SkynetOS-${after}-x64.exe   (${size})
  update feed release/latest.yml

Install or update THIS machine:
  npm run install:local

Ship it to every installed SkynetOS (they fetch it themselves within six hours):
  1. commit and push, so the tag points at what was built
  2. npm run release:publish

Nothing was committed, tagged, pushed or uploaded.`);
