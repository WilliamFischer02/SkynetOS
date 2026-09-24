#!/usr/bin/env node
/**
 * The two things done with a built installer. Both are William's to run; nothing calls this.
 *
 *   npm run install:local              open this version's installer on this machine
 *   npm run install:local -- --silent  install or update without the wizard (per user, no admin)
 *   npm run release:publish            upload this version to GitHub Releases with `gh`
 *   npm run release:publish -- --dry   print the gh command and stop
 *
 * Publishing is what makes every installed SkynetOS update itself: each one reads `latest.yml`
 * from the newest release (src/main/services/updater.ts). The repo is public, so a published
 * installer is public too. Before the first one, read docs/09-RELEASE.md "Before publishing".
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const installer = join(repo, 'release', `SkynetOS-${version}-x64.exe`);
const feed = join(repo, 'release', 'latest.yml');
const blockmap = `${installer}.blockmap`;
const mode = process.argv[2];

if (!existsSync(installer)) {
  console.error(`ship: release/SkynetOS-${version}-x64.exe does not exist. Build it first: npm run release -- --same`);
  process.exit(1);
}

if (mode === 'install') {
  const silent = process.argv.includes('--silent');
  // Detached: the installer closes a running SkynetOS, which may be the parent of this terminal.
  const child = spawn(installer, silent ? ['/S'] : [], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => { console.error(`ship: the installer did not start — ${err.message}`); process.exit(1); });
  child.unref();
  console.log(silent
    ? `ship: installing SkynetOS ${version} quietly. Start it from the Start menu when it is done.`
    : `ship: opened the SkynetOS ${version} installer. To pin it: start SkynetOS, right-click its taskbar button, Pin to taskbar.`);
} else if (mode === 'publish') {
  if (!existsSync(feed)) { console.error('ship: release/latest.yml is missing, so installed copies could not see this release. Rebuild: npm run release -- --same'); process.exit(1); }
  if (!readFileSync(feed, 'utf8').includes(`version: ${version}`)) {
    console.error(`ship: release/latest.yml is not for ${version}. Rebuild: npm run release -- --same`);
    process.exit(1);
  }
  const info = join(repo, 'build', 'build-info.json');
  if (existsSync(info) && JSON.parse(readFileSync(info, 'utf8')).builtFrom) {
    console.error('ship: this installer records the folder it was built in (build-info.json builtFrom). Build the public one first: npm run release -- --same --public');
    process.exit(1);
  }
  const files = [installer, feed, ...(existsSync(blockmap) ? [blockmap] : [])];
  const args = ['release', 'create', `v${version}`, ...files, '--title', `SkynetOS ${version}`, '--generate-notes'];
  if (process.argv.includes('--dry')) { console.log(`gh ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`); process.exit(0); }
  const result = spawnSync('gh', args, { cwd: repo, stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  console.error('ship: use "install" or "publish"');
  process.exit(1);
}
