#!/usr/bin/env node
/**
 * SkynetOS asset baker.
 *
 * Reads assets/sprites/manifest.json, slices cells out of the downloaded vendor sheets,
 * recolors them to the locked SkynetOS palette, composites the kitbash layers, and writes
 * a single packed atlas to assets/atlas/skynet.{png,json}.
 *
 * The app never touches assets/vendor/. It loads only the baked atlas, which is what
 * validate-assets.mjs then checks for pixel purity.
 *
 * THEME KEYS: tokens starting with '@' bake as reserved magenta key colors and are swapped
 * per room at draw time by a 3-entry exact-match palette shader. That is how one baked sprite
 * serves five differently-colored rooms without five atlases and without any blending.
 *
 * Usage: node tools/bake-assets.mjs [--verbose]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = process.cwd();
const ASSETS = join(ROOT, 'assets');
const OUT_DIR = join(ASSETS, 'atlas');
const VERBOSE = process.argv.includes('--verbose');

/* ---------- palette ---------- */

function loadPalette(file) {
  const map = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s+(\S+)/);
    if (m) map.set(m[4], [+m[1], +m[2], +m[3]]);
  }
  return map;
}

/** Reserved key colors. Never appear in the palette; swapped per room at draw time. */
const THEME_KEYS = {
  '@mask-dark': [255, 0, 204],
  '@mask-light': [255, 0, 153],
  '@signal': [255, 0, 255]
};

const palette = loadPalette(join(ASSETS, 'palettes', 'skynet.gpl'));

function resolveToken(token) {
  if (token.startsWith('@')) {
    const rgb = THEME_KEYS[token];
    if (!rgb) throw new Error(`Unknown theme key "${token}". Valid: ${Object.keys(THEME_KEYS).join(', ')}`);
    return rgb;
  }
  const rgb = palette.get(token);
  if (!rgb) throw new Error(`Token "${token}" is not in assets/palettes/skynet.gpl`);
  return rgb;
}

/* ---------- raster helpers ---------- */

const px = (w, h) => ({ w, h, data: new Uint8Array(w * h * 4) });

function loadSheet(file) {
  if (!existsSync(file)) throw new Error(`Sheet not found: ${file}`);
  const png = PNG.sync.read(readFileSync(file));
  return { w: png.width, h: png.height, data: new Uint8Array(png.data) };
}

function cellRect(sheetDef, col, row) {
  const c = sheetDef.cell;
  return {
    x: c.marginX + col * (c.w + (c.spacingX ?? 0)),
    y: c.marginY + row * (c.h + (c.spacingY ?? 0)),
    w: c.w,
    h: c.h
  };
}

/** Extract a rect, apply flips/rotation, force binary alpha, apply tint or remap table. */
function extract(src, rect, opts, remapTable) {
  const { w, h } = rect;
  const out = px(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = x, sy = y;
      if (opts.flipX) sx = w - 1 - x;
      if (opts.flipY) sy = h - 1 - y;
      const si = ((rect.y + sy) * src.w + rect.x + sx) * 4;
      const a = src.data[si + 3];
      if (a < 128) continue;                    // binary alpha: anything soft is dropped
      const di = (y * w + x) * 4;
      let rgb;
      if (opts.tint) {
        rgb = resolveToken(opts.tint);
      } else if (remapTable) {
        const key = `${src.data[si]},${src.data[si + 1]},${src.data[si + 2]}`;
        const token = remapTable[key];
        if (!token) {
          throw new Error(`Source color rgb(${key}) has no entry in the remap table. Add it, or give the layer an explicit tint.`);
        }
        rgb = resolveToken(token);
      } else {
        throw new Error('Layer needs either "tint" or a sheet-level "remap" table. Raw vendor colors never ship.');
      }
      out.data[di] = rgb[0]; out.data[di + 1] = rgb[1]; out.data[di + 2] = rgb[2]; out.data[di + 3] = 255;
    }
  }
  if (opts.rotate) {
    const times = ((opts.rotate / 90) | 0) % 4;
    if (opts.rotate % 90 !== 0) throw new Error('Rotation must be a multiple of 90. Diagonals are drawn, never rotated.');
    let cur = out;
    for (let i = 0; i < times; i++) cur = rotate90(cur);
    return cur;
  }
  return out;
}

function rotate90(img) {
  const out = px(img.h, img.w);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const si = (y * img.w + x) * 4;
      const dx = img.h - 1 - y, dy = x;
      const di = (dy * out.w + dx) * 4;
      out.data.set(img.data.subarray(si, si + 4), di);
    }
  }
  return out;
}

/** Hard blit. No alpha blending anywhere in this pipeline — opaque wins, transparent skips. */
function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= dst.w) continue;
      const si = (y * src.w + x) * 4;
      if (src.data[si + 3] !== 255) continue;
      const di = (dy * dst.w + dx) * 4;
      dst.data.set(src.data.subarray(si, si + 4), di);
    }
  }
}

/* ---------- bake ---------- */

const manifestPath = join(ASSETS, 'sprites', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const sheets = new Map();
const remaps = new Map();
function getSheet(id) {
  if (sheets.has(id)) return sheets.get(id);
  const def = manifest.sheets[id];
  if (!def) throw new Error(`Unknown sheet id "${id}"`);
  const loaded = { def, img: loadSheet(join(ASSETS, def.file)) };
  if (def.remap && !remaps.has(id)) {
    const r = JSON.parse(readFileSync(join(ASSETS, def.remap), 'utf8'));
    remaps.set(id, r.table);
  }
  sheets.set(id, loaded);
  return loaded;
}

function bakeFrame(spriteKey, size, layers) {
  const canvas = px(size[0], size[1]);
  for (const layer of layers) {
    if (layer.path) {
      const img = loadSheet(join(ASSETS, 'sprites', layer.path));
      blit(canvas, img, layer.at?.[0] ?? 0, layer.at?.[1] ?? 0);
      continue;
    }
    const { def, img } = getSheet(layer.sheet);
    const rect = layer.rect
      ? { x: layer.rect[0], y: layer.rect[1], w: layer.rect[2], h: layer.rect[3] }
      : cellRect(def, layer.cell[0], layer.cell[1]);
    const piece = extract(img, rect, layer, remaps.get(layer.sheet));
    blit(canvas, piece, layer.at?.[0] ?? 0, layer.at?.[1] ?? 0);
  }
  return canvas;
}

const baked = [];
let skipped = 0;

for (const [key, spec] of Object.entries(manifest.sprites ?? {})) {
  if (key.startsWith('$')) continue;
  try {
    if (spec.source?.type === 'file') {
      const img = loadSheet(join(ASSETS, 'sprites', spec.source.path));
      baked.push({ key, frame: 0, img, fps: spec.fps ?? 0 });
      continue;
    }
    if (spec.source?.type === 'sheet') {
      baked.push({ key, frame: 0, img: bakeFrame(key, spec.size, [spec.source]), fps: 0 });
      continue;
    }
    const frames = spec.frames ?? [];
    /*
     * A sprite that declares neither a recognised `source.type` nor any `frames` used to bake
     * nothing and say nothing — the atlas simply came out short and you had to diff the manifest
     * against the frame list to find out which entries had evaporated. A `source` missing its
     * `type` is the easy way to write one, and it cost a debugging round to find.
     */
    if (!frames.length) {
      throw new Error(
        spec.source
          ? `source.type is "${String(spec.source.type)}" — expected "sheet" or "file"`
          : 'no "frames" and no "source"'
      );
    }
    frames.forEach((f, i) => {
      baked.push({ key, frame: i, img: bakeFrame(key, spec.size, f.layers), fps: spec.fps ?? 6 });
    });
  } catch (err) {
    skipped++;
    console.error(`SKIP  ${key}\n      ${err.message}`);
  }
}

if (!baked.length) {
  /*
   * Write an EMPTY atlas rather than nothing.
   *
   * Two callers need the file to exist regardless of whether anything baked. electron-builder
   * lists assets/atlas under extraResources and warns "file source doesn't exist" otherwise, so a
   * packaged build would have no atlas path at all. And the renderer imports skynet.json through
   * Vite's `?url`, which resolves at BUILD time — a missing file is a build failure, not a
   * graceful degrade, and assets/atlas is git-ignored so a fresh clone has none.
   *
   * An empty atlas is a perfectly good atlas: every key misses, every node draws a labelled
   * placeholder, which is exactly the documented pre-M5 state.
   */
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'skynet.json'),
    JSON.stringify({ meta: { image: 'skynet.png', size: { w: 1, h: 1 } }, frames: {}, animations: {} }, null, 2)
  );
  const blank = new PNG({ width: 1, height: 1 });
  writeFileSync(join(OUT_DIR, 'skynet.png'), PNG.sync.write(blank));
  mkdirSync(OUT_DIR, { recursive: true });
  console.warn('\nNothing baked. Drop packs into assets/vendor/, fill in assets/sprites/manifest.json,');
  console.warn('and re-run. Until then the app renders placeholder rectangles — that is expected before M5.\n');
  process.exit(0);
}

/* shelf pack, power-of-two atlas */
baked.sort((a, b) => b.img.h - a.img.h);
let atlasW = 256;
while (true) {
  const placed = tryPack(atlasW);
  if (placed) { writeAtlas(atlasW, placed); break; }
  atlasW *= 2;
  if (atlasW > 8192) throw new Error('Atlas exceeded 8192px. Split into multiple atlases.');
}

function tryPack(width) {
  const out = [];
  let x = 0, y = 0, shelfH = 0;
  for (const b of baked) {
    if (b.img.w > width) return null;
    if (x + b.img.w > width) { x = 0; y += shelfH + 1; shelfH = 0; }
    out.push({ ...b, x, y });
    x += b.img.w + 1;
    shelfH = Math.max(shelfH, b.img.h);
  }
  const height = y + shelfH;
  if (height > width * 2) return null;
  out.height = height;
  return out;
}

function writeAtlas(width, placed) {
  let h = 1; while (h < placed.height) h *= 2;
  const png = new PNG({ width, height: h });
  png.data.fill(0);
  const frames = {};
  for (const p of placed) {
    for (let y = 0; y < p.img.h; y++) {
      for (let x = 0; x < p.img.w; x++) {
        const si = (y * p.img.w + x) * 4;
        if (p.img.data[si + 3] !== 255) continue;
        const di = ((p.y + y) * width + p.x + x) * 4;
        png.data[di] = p.img.data[si];
        png.data[di + 1] = p.img.data[si + 1];
        png.data[di + 2] = p.img.data[si + 2];
        png.data[di + 3] = 255;
      }
    }
    frames[`${p.key}#${p.frame}`] = {
      frame: { x: p.x, y: p.y, w: p.img.w, h: p.img.h },
      sourceSize: { w: p.img.w, h: p.img.h },
      spriteSourceSize: { x: 0, y: 0, w: p.img.w, h: p.img.h },
      rotated: false, trimmed: false
    };
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'skynet.png'), PNG.sync.write(png));
  const anim = {};
  for (const p of placed) {
    if (!p.fps) continue;
    (anim[p.key] ??= { fps: p.fps, frames: [] }).frames.push(`${p.key}#${p.frame}`);
  }
  writeFileSync(join(OUT_DIR, 'skynet.json'), JSON.stringify({
    meta: { app: 'skynetos-baker', scale: '1', size: { w: width, h }, image: 'skynet.png', themeKeys: THEME_KEYS },
    frames, animations: anim
  }, null, 2));
  console.log(`Baked ${placed.length} frames into ${width}x${h} atlas.${skipped ? `  ${skipped} sprite(s) skipped.` : ''}`);
  if (VERBOSE) for (const p of placed) console.log(`  ${p.key}#${p.frame}  ${p.img.w}x${p.img.h} @ ${p.x},${p.y}`);
}
