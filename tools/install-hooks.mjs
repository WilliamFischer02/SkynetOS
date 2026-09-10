#!/usr/bin/env node
/**
 * Optional: install a post-commit hook that rebuilds the unpacked app in the BACKGROUND.
 *
 *   npm run hooks:install     add it
 *   npm run hooks:uninstall   remove it
 *
 * Why background, and why unpacked rather than the installer:
 *
 *   - A commit must stay instant. A 36-second NSIS build in a blocking hook turns every commit
 *     into a coffee break and you will start passing --no-verify, which is worse than no hook.
 *   - `--dir` is 14 seconds and produces release/win-unpacked/SkynetOS.exe, which is a real exe
 *     you can pin to the taskbar. It is not an installer, so nothing has to be uninstalled and
 *     reinstalled to test a change.
 *   - GitHub Actions builds the actual signed-shaped installer on every push (.github/workflows).
 *     This hook is for the machine you are sitting at.
 *
 * The hook never fails a commit. If the build breaks, the commit still lands and the reason is
 * in release/build.log — a hook that can reject work you have already decided to keep is a hook
 * that gets disabled.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();

function gitHooksDir() {
  // Respects core.hooksPath, so this works in a worktree or with a custom hooks directory.
  const configured = (() => {
    try {
      return execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim();
    } catch { return ''; }
  })();
  if (configured) return join(ROOT, configured);
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
  return join(ROOT, gitDir, 'hooks');
}

const MARKER = '# skynetos-post-commit-build';

const HOOK = `#!/bin/sh
${MARKER}
# Rebuilds release/win-unpacked/SkynetOS.exe in the background after every commit.
# Never blocks the commit and never fails it. Log: release/build.log
# Remove with: npm run hooks:uninstall
mkdir -p release
(
  echo "=== $(date) $(git rev-parse --short HEAD) $(git log -1 --pretty=%s) ==="
  npm run build:app && npx electron-builder --win --dir
  echo "=== exit $? ==="
) > release/build.log 2>&1 &
exit 0
`;

const dir = gitHooksDir();
const file = join(dir, 'post-commit');
const mode = process.argv[2] ?? 'install';

if (mode === 'uninstall') {
  if (existsSync(file) && readFileSync(file, 'utf8').includes(MARKER)) {
    rmSync(file);
    console.log(`Removed ${file}`);
  } else if (existsSync(file)) {
    console.log(`Left ${file} alone — it is not the SkynetOS hook.`);
  } else {
    console.log('No post-commit hook installed.');
  }
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
if (existsSync(file) && !readFileSync(file, 'utf8').includes(MARKER)) {
  console.error(`Refusing to overwrite an existing post-commit hook at:\n  ${file}\nMerge it by hand if you want both.`);
  process.exit(1);
}
writeFileSync(file, HOOK, { mode: 0o755 });
console.log(`Installed ${file}`);
console.log('Every commit now rebuilds release/win-unpacked/SkynetOS.exe in the background.');
console.log('Progress and errors: release/build.log');
