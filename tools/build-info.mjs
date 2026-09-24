#!/usr/bin/env node
/**
 * Write `build/build-info.json`: what this build is, and which repo it was made in.
 *
 * electron-builder.yml ships it as `resources/build-info.json`. The installed app reads it for two
 * things: the ABOUT box (version, commit, when), and finding its data home. An installed SkynetOS
 * never keeps boards in its own folder (packages/shared/home.ts); on a machine that still has the
 * repo this build came from, that repo is the home, and `builtFrom` is how the app knows where.
 *
 * A path on William's disk goes into the installer. That is acceptable for a private build and is
 * worth knowing before an installer is published: `builtFrom` would name a folder on the machine
 * that made it. `--public` leaves it out, and a public install then uses `%USERPROFILE%/SkynetOS`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));

const git = (...args) => {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return null;
  }
};

const commit = git('rev-parse', '--short', 'HEAD');
const status = git('status', '--porcelain');
const isPublic = process.argv.includes('--public') || process.env.SKYNET_PUBLIC_BUILD === '1';

const info = {
  version: pkg.version,
  commit,
  dirty: status === null ? false : status.length > 0,
  builtAt: new Date().toISOString(),
  builtFrom: isPublic ? '' : repo.replace(/\\/g, '/')
};

mkdirSync(join(repo, 'build'), { recursive: true });
writeFileSync(join(repo, 'build', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`build-info: ${info.version} ${info.commit ?? 'no-git'}${info.dirty ? ' (uncommitted changes)' : ''}${isPublic ? ' — public, no builtFrom' : ` from ${info.builtFrom}`}`);
