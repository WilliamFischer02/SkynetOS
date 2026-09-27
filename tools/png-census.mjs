#!/usr/bin/env node
/**
 * node tools/png-census.mjs [dir-or-files...]
 *
 * A colour census of PNG captures (default: .smoke/*.png): unique colours per file, how many of
 * them are exact entries of assets/palettes/skynet.gpl, and how many are not. The board's room
 * LOOK (hue, saturation, brightness) and photo backdrops legitimately put off-palette colours on
 * screen, so this is a report, not a gate; what it is for is comparing two captures of the same
 * scene and seeing whether a rendering change added colours.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
// --crop x,y,w,h counts only that rectangle: the board canvas, not the DOM chrome over it,
// whose antialiased text is off-palette by nature (see the comment above the font switches in
// src/main/index.ts). Purity is a promise about the canvas.
const cropArg = argv.find((a) => a.startsWith('--crop='));
const crop = cropArg ? cropArg.slice(7).split(',').map(Number) : null;
const args = argv.filter((a) => !a.startsWith('--'));
const targets = args.length ? args : [join(process.cwd(), '.smoke')];

function palette() {
  const text = readFileSync(join(process.cwd(), 'assets', 'palettes', 'skynet.gpl'), 'utf8');
  const set = new Set();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s+/);
    if (m) set.add((Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]));
  }
  return set;
}

function files() {
  const out = [];
  for (const t of targets) {
    const p = resolve(t);
    let st;
    try { st = statSync(p); } catch { console.log(`MISSING ${p}`); continue; }
    // Braced on purpose: the one-line form bound `else` to the inner `if`, so a single PNG named on
    // the command line was silently skipped.
    if (st.isDirectory()) {
      for (const f of readdirSync(p)) if (f.toLowerCase().endsWith('.png')) out.push(join(p, f));
    } else {
      out.push(p);
    }
  }
  return out.sort();
}

const gpl = palette();
for (const file of files()) {
  const png = PNG.sync.read(readFileSync(file));
  const seen = new Map();
  let translucent = 0;
  const d = png.data;
  const [cx, cy, cw, ch] = crop ?? [0, 0, png.width, png.height];
  for (let y = cy; y < Math.min(png.height, cy + ch); y++) for (let x = cx; x < Math.min(png.width, cx + cw); x++) {
    const i = (y * png.width + x) * 4;
    const a = d[i + 3];
    if (a !== 0 && a !== 255) translucent++;
    if (a === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let on = 0;
  let off = 0;
  let offPixels = 0;
  const offList = [];
  for (const [key, count] of seen) {
    if (gpl.has(key)) on++; else { off++; offPixels += count; offList.push([key, count]); }
  }
  // --list names the off-palette colours, most pixels first (at most twelve).
  if (argv.includes('--list')) {
    offList.sort((a, b) => b[1] - a[1]);
    for (const [key, count] of offList.slice(0, 12)) console.log(`    #${key.toString(16).padStart(6, '0').toUpperCase()}  ${count} px`);
  }
  const total = crop ? Math.min(cw, png.width - cx) * Math.min(ch, png.height - cy) : png.width * png.height;
  const rel = file.replace(process.cwd(), '').replace(/^[\\/]/, '');
  console.log(
    `${rel}  ${png.width}x${png.height}  colours ${seen.size}  on-palette ${on}  off-palette ${off} (${((100 * offPixels) / total).toFixed(2)}% of pixels)` +
    (translucent ? `  TRANSLUCENT PIXELS ${translucent}` : '')
  );
}
