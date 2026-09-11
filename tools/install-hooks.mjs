#!/usr/bin/env node
/**
 * Optional git hooks. Two of them, installed separately.
 *
 *   npm run hooks:install     post-commit: rebuild the unpacked app in the background
 *   npm run hooks:uninstall
 *   npm run face:hook         pre-commit: rebake FACE-BOOT.md and stage it
 *   npm run face:unhook
 *
 * ── The build hook: why background, and why unpacked rather than the installer ────────────────
 *
 *   - A commit must stay instant. A 36-second NSIS build in a blocking hook turns every commit
 *     into a coffee break and you will start passing --no-verify, which is worse than no hook.
 *   - `--dir` is 14 seconds and produces release/win-unpacked/SkynetOS.exe, which is a real exe
 *     you can pin to the taskbar. It is not an installer, so nothing has to be uninstalled and
 *     reinstalled to test a change.
 *   - GitHub Actions builds the actual signed-shaped installer on every push (.github/workflows).
 *     This hook is for the machine you are sitting at.
 *
 * ── The face hook: why PRE-commit ─────────────────────────────────────────────────────────────
 *
 * The Face asked for post-commit. A post-commit bake rewrites FACE-BOOT.md AFTER the commit is
 * made, so every pushed copy would be one commit stale and the working tree would never be clean.
 * Baking before the commit and staging the result means each commit carries a boot file that
 * describes itself. The bake is read-only apart from that one file and takes about a second.
 *
 * Neither hook ever fails a commit. A hook that can reject work you have already decided to keep
 * is a hook that gets disabled. Hooks live in .git/hooks, which git does not track, so each clone
 * installs its own.
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

const HOOKS = {
  build: {
    file: 'post-commit',
    marker: '# skynetos-post-commit-build',
    uninstall: 'npm run hooks:uninstall',
    body: (marker, uninstall) => `#!/bin/sh
${marker}
# Rebuilds release/win-unpacked/SkynetOS.exe in the background after every commit.
# Never blocks the commit and never fails it. Log: release/build.log
# Remove with: ${uninstall}
mkdir -p release
(
  echo "=== $(date) $(git rev-parse --short HEAD) $(git log -1 --pretty=%s) ==="
  npm run build:app && npx electron-builder --win --dir
  echo "=== exit $? ==="
) > release/build.log 2>&1 &
exit 0
`,
    done: [
      'Every commit now rebuilds release/win-unpacked/SkynetOS.exe in the background.',
      'Progress and errors: release/build.log'
    ]
  },
  face: {
    file: 'pre-commit',
    marker: '# skynetos-pre-commit-face-boot',
    uninstall: 'npm run face:unhook',
    // node on vite-node's entry directly, not npx: npx costs a second of resolution per commit.
    body: (marker, uninstall) => `#!/bin/sh
${marker}
# Rebakes FACE-BOOT.md and stages it, so every commit carries a current copy for the Face.
# Never fails a commit: if the bake breaks, the commit lands with the previous copy.
# Log: .git/face-bake.log   Remove with: ${uninstall}
log="$(git rev-parse --git-dir)/face-bake.log"
node node_modules/vite-node/vite-node.mjs --config vitest.config.ts tools/face-bake.ts > "$log" 2>&1 && git add FACE-BOOT.md
exit 0
`,
    done: [
      'Every commit now rebakes FACE-BOOT.md and includes it.',
      'Output of the last bake: .git/face-bake.log'
    ]
  }
};

const mode = process.argv[2] ?? 'install';
const hook = HOOKS[process.argv[3] ?? 'build'];
if (!hook) {
  console.error(`Unknown hook "${process.argv[3]}". Use one of: ${Object.keys(HOOKS).join(', ')}`);
  process.exit(1);
}

const dir = gitHooksDir();
const file = join(dir, hook.file);

if (mode === 'uninstall') {
  if (existsSync(file) && readFileSync(file, 'utf8').includes(hook.marker)) {
    rmSync(file);
    console.log(`Removed ${file}`);
  } else if (existsSync(file)) {
    console.log(`Left ${file} alone — it is not the SkynetOS hook.`);
  } else {
    console.log(`No ${hook.file} hook installed.`);
  }
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
if (existsSync(file) && !readFileSync(file, 'utf8').includes(hook.marker)) {
  console.error(`Refusing to overwrite an existing ${hook.file} hook at:\n  ${file}\nMerge it by hand if you want both.`);
  process.exit(1);
}
writeFileSync(file, hook.body(hook.marker, hook.uninstall), { mode: 0o755 });
console.log(`Installed ${file}`);
for (const line of hook.done) console.log(line);
