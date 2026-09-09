#!/usr/bin/env node
/**
 * SkynetOS pixel purity validator.
 * Fails the build on anything that would make the art read as blurry, soft, or generated.
 *
 * Scope:
 *   assets/atlas/skynet.png       the baked output the app actually loads   -> fully checked
 *   assets/sprites/authored/*.png hand-drawn sprites                        -> fully checked
 *   assets/vendor/**              downloaded source material                -> EXEMPT from pixel
 *                                                                              checks, but must
 *                                                                              carry LICENSE.txt
 *                                                                              and SOURCE.md
 * Checks:
 *   1. binary alpha        every pixel alpha is 0 or 255
 *   2. palette lock        every opaque pixel is in skynet.gpl or is a reserved theme key
 *   3. color budget        <= 6 unique colors per FRAME (read from the atlas frame map)
 *   4. dimensions          authored sprites are multiples of 8
 *   5. no upscaling        rejects art saved at 2x/3x (uniform NxN block heuristic)
 *   6. license trail       every assets/vendor/<pack>/ has LICENSE.txt and SOURCE.md
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = process.cwd();
const ASSETS = join(ROOT, 'assets');
const MAX_COLORS = 6;

const THEME_KEYS = new Set(['255,0,204', '255,0,153', '255,0,255']);

function loadPalette(file) {
  const set = new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
    if (m) set.add(`${+m[1]},${+m[2]},${+m[3]}`);
  }
  if (!set.size) throw new Error(`No colors parsed from ${file}`);
  return set;
}

const palette = loadPalette(join(ASSETS, 'palettes', 'skynet.gpl'));
const allowed = new Set([...palette, ...THEME_KEYS]);
let failures = 0;
const fail = (where, msgs) => { failures++; console.error(`\nFAIL  ${where}`); for (const m of msgs) console.error(`      - ${m}`); };

/* ---- 6. license trail ---- */
const VENDOR = join(ASSETS, 'vendor');
if (existsSync(VENDOR)) {
  for (const pack of readdirSync(VENDOR)) {
    const dir = join(VENDOR, pack);
    if (!statSync(dir).isDirectory()) continue;
    const missing = ['LICENSE.txt', 'SOURCE.md'].filter(f => !existsSync(join(dir, f)));
    if (missing.length) fail(`assets/vendor/${pack}`, [`missing ${missing.join(' and ')} — see assets/vendor/README.md`]);
  }
}

/* ---- pixel checks ---- */
function looksUpscaled(img, n) {
  if (img.width % n || img.height % n) return false;
  for (let by = 0; by < img.height; by += n) {
    for (let bx = 0; bx < img.width; bx += n) {
      const ref = img.data.readUInt32BE((by * img.width + bx) * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (img.data.readUInt32BE((((by + y) * img.width + bx + x) * 4)) !== ref) return false;
      }
    }
  }
  return true;
}

function scanRegion(png, r) {
  const colors = new Set();
  let soft = 0, off = null;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * png.width + x) * 4;
      const a = png.data[i + 3];
      if (a !== 0 && a !== 255) { soft++; continue; }
      if (a === 0) continue;
      const key = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
      colors.add(key);
      if (!allowed.has(key) && !off) off = key;
    }
  }
  return { colors, soft, off };
}

const atlasPng = join(ASSETS, 'atlas', 'skynet.png');
const atlasJson = join(ASSETS, 'atlas', 'skynet.json');
if (existsSync(atlasPng) && existsSync(atlasJson)) {
  const png = PNG.sync.read(readFileSync(atlasPng));
  const { frames } = JSON.parse(readFileSync(atlasJson, 'utf8'));
  for (const [key, f] of Object.entries(frames)) {
    const { colors, soft, off } = scanRegion(png, f.frame);
    const problems = [];
    if (soft) problems.push(`${soft} semi-transparent pixels`);
    if (off) problems.push(`off-palette color rgb(${off}) — the baker should have tinted or remapped this`);
    if (colors.size > MAX_COLORS) problems.push(`${colors.size} unique colors, budget is ${MAX_COLORS}`);
    if (problems.length) fail(`atlas frame ${key}`, problems);
  }
  console.log(`Checked ${Object.keys(frames).length} atlas frames.`);
} else {
  console.log('No baked atlas yet (run `npm run assets:bake`). Skipping atlas checks.');
}

const AUTHORED = join(ASSETS, 'sprites', 'authored');
if (existsSync(AUTHORED)) {
  const files = readdirSync(AUTHORED).filter(f => extname(f).toLowerCase() === '.png');
  for (const f of files) {
    const file = join(AUTHORED, f);
    const png = PNG.sync.read(readFileSync(file));
    const { colors, soft, off } = scanRegion(png, { x: 0, y: 0, w: png.width, h: png.height });
    const problems = [];
    if (soft) problems.push(`${soft} semi-transparent pixels (alpha must be 0 or 255 — no feathered edges)`);
    if (off) problems.push(`off-palette color rgb(${off}) — repaint on the locked palette`);
    if (colors.size > MAX_COLORS) problems.push(`${colors.size} unique colors, budget is ${MAX_COLORS}`);
    if (png.width % 8 || png.height % 8) problems.push(`${png.width}x${png.height} — dimensions must be multiples of 8`);
    for (const n of [4, 3, 2]) if (looksUpscaled(png, n)) { problems.push(`appears authored at ${n}x and saved upscaled — author at 1x`); break; }
    if (problems.length) fail(relative(ROOT, file), problems);
  }
  if (files.length) console.log(`Checked ${files.length} authored sprite(s).`);
}

if (failures) { console.error(`\n${failures} asset problem(s). Build blocked.\n`); process.exit(1); }
console.log('Pixel purity OK.');
