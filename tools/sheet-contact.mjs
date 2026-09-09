#!/usr/bin/env node
/**
 * Contact sheet generator — the thing that stops you guessing cell coordinates.
 *
 * Renders a vendor sheet at an integer zoom onto a dark ground with the cell grid drawn
 * over it and a coordinate ruler down the top and left edges, so you can read a cell's
 * [col,row] straight off the image and put it in assets/sprites/manifest.json.
 *
 * Vendor sheets are read-only source material; this only ever reads them. Output goes to
 * a scratch path you name, never into assets/.
 *
 *   node tools/sheet-contact.mjs <sheet-id-or-path> <out.png> [--zoom 3] [--cell 16]
 *                                [--spacing 1] [--margin 0] [--range c0,r0,c1,r1]
 *
 * A sheet id (e.g. `k1bit`) is looked up in the manifest so the grid metadata comes from
 * the same place the baker reads it — if the contact sheet lines up, the baker will too.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = process.cwd();
const ASSETS = join(ROOT, 'assets');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const [sheetArg, outArg] = positional;
if (!sheetArg || !outArg) {
  console.error('usage: node tools/sheet-contact.mjs <sheet-id-or-path> <out.png> [--zoom N] [--cell N] [--spacing N] [--margin N] [--range c0,r0,c1,r1]');
  process.exit(2);
}

/* ---- resolve the sheet + its grid from the manifest when possible ---- */
const manifest = JSON.parse(readFileSync(join(ASSETS, 'sprites', 'manifest.json'), 'utf8'));
let file, cell;
if (manifest.sheets?.[sheetArg]) {
  const def = manifest.sheets[sheetArg];
  file = join(ASSETS, def.file);
  cell = { ...def.cell };
} else {
  file = sheetArg;
  cell = { w: 16, h: 16, marginX: 0, marginY: 0, spacingX: 0, spacingY: 0 };
}
if (flag('cell')) cell.w = cell.h = +flag('cell');
if (flag('spacing')) cell.spacingX = cell.spacingY = +flag('spacing');
if (flag('margin')) cell.marginX = cell.marginY = +flag('margin');

const ZOOM = +flag('zoom', 3);
const src = PNG.sync.read(readFileSync(file));

const stepX = cell.w + (cell.spacingX ?? 0);
const stepY = cell.h + (cell.spacingY ?? 0);
const cols = Math.floor((src.width - (cell.marginX ?? 0) + (cell.spacingX ?? 0)) / stepX);
const rows = Math.floor((src.height - (cell.marginY ?? 0) + (cell.spacingY ?? 0)) / stepY);

let [c0, r0, c1, r1] = (flag('range') ?? `0,0,${cols - 1},${rows - 1}`).split(',').map(Number);
c1 = Math.min(c1, cols - 1); r1 = Math.min(r1, rows - 1);

/* ---- 5x7 bitmap digits, so the ruler needs no font ---- */
const GLYPHS = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111']
};
const GUTTER = 26; // px in output space for the ruler

const outW = GUTTER + (c1 - c0 + 1) * cell.w * ZOOM;
const outH = GUTTER + (r1 - r0 + 1) * cell.h * ZOOM;
const png = new PNG({ width: outW, height: outH });

const set = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= outW || y >= outH) return;
  const i = (y * outW + x) * 4;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
};
// ground: SKYNET mask-dark, so contrast matches the real board
for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) set(x, y, 14, 26, 20);

function drawNum(n, x, y, rgb) {
  for (const ch of String(n)) {
    const g = GLYPHS[ch];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy][gx] === '1') set(x + gx, y + gy, ...rgb);
    x += 4;
  }
}

const SILK = [233, 228, 214], COPPER = [192, 138, 62], COPPER_DARK = [122, 84, 35];

for (let r = r0; r <= r1; r++) {
  for (let c = c0; c <= c1; c++) {
    const sx = (cell.marginX ?? 0) + c * stepX;
    const sy = (cell.marginY ?? 0) + r * stepY;
    const ox = GUTTER + (c - c0) * cell.w * ZOOM;
    const oy = GUTTER + (r - r0) * cell.h * ZOOM;
    for (let y = 0; y < cell.h; y++) {
      for (let x = 0; x < cell.w; x++) {
        const si = ((sy + y) * src.width + sx + x) * 4;
        if (src.data[si + 3] < 128) continue;
        const rgb = [src.data[si], src.data[si + 1], src.data[si + 2]];
        for (let zy = 0; zy < ZOOM; zy++) for (let zx = 0; zx < ZOOM; zx++) set(ox + x * ZOOM + zx, oy + y * ZOOM + zy, ...rgb);
      }
    }
    // cell boundary
    for (let x = 0; x < cell.w * ZOOM; x++) set(ox + x, oy, ...COPPER_DARK);
    for (let y = 0; y < cell.h * ZOOM; y++) set(ox, oy + y, ...COPPER_DARK);
  }
}

// rulers
for (let c = c0; c <= c1; c++) {
  const ox = GUTTER + (c - c0) * cell.w * ZOOM;
  drawNum(c, ox + 2, 4, c % 5 === 0 ? SILK : COPPER);
  for (let y = 12; y < GUTTER; y++) set(ox, y, ...COPPER_DARK);
}
for (let r = r0; r <= r1; r++) {
  const oy = GUTTER + (r - r0) * cell.h * ZOOM;
  drawNum(r, 2, oy + 2, r % 5 === 0 ? SILK : COPPER);
  for (let x = 14; x < GUTTER; x++) set(x, oy, ...COPPER_DARK);
}

writeFileSync(outArg, PNG.sync.write(png));
console.log(`${file}`);
console.log(`  grid: cell ${cell.w}x${cell.h}  margin ${cell.marginX ?? 0},${cell.marginY ?? 0}  spacing ${cell.spacingX ?? 0},${cell.spacingY ?? 0}  ->  ${cols} x ${rows} cells`);
console.log(`  wrote ${outArg}  (${outW}x${outH}, cells [${c0},${r0}]..[${c1},${r1}] at ${ZOOM}x)`);
