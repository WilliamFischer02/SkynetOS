#!/usr/bin/env node
/**
 * Launches the built app, screenshots it, and exits. Proof that the window opens and renders,
 * rather than a claim that it does.
 *
 *   npm run build:app && node tools/smoke-shot.mjs [outDir]
 *
 * Writes 01-initial-3x.png, 02-after-pan-right.png, 03-zoom-4x.png, 04-zoom-2x.png.
 * The capture logic itself lives in src/main/index.ts behind SKYNET_SMOKE_DIR.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import electron from 'electron';

const outDir = resolve(process.argv[2] ?? join(process.cwd(), '.smoke'));
mkdirSync(outDir, { recursive: true });

if (!existsSync(join(process.cwd(), 'out', 'main', 'index.js'))) {
  console.error('out/main/index.js missing — run `npx electron-vite build` first.');
  process.exit(2);
}

const child = spawn(electron, ['.'], {
  env: { ...process.env, SKYNET_SMOKE_DIR: outDir },
  stdio: 'inherit'
});

child.on('exit', (code) => {
  console.log(`\nelectron exited with ${code}. Screenshots in ${outDir}`);
  process.exit(code ?? 0);
});
