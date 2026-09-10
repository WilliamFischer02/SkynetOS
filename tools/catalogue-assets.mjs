#!/usr/bin/env node
/**
 * Catalogue every vendor sheet: measure it, count what is actually in it, and write the result to
 * docs/09-ASSET-CATALOGUE.md.
 *
 *   node tools/catalogue-assets.mjs            write the catalogue
 *   node tools/catalogue-assets.mjs --check    fail if the catalogue is out of date (for CI)
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────
 *
 * `assets/sprites/manifest.json` says where a sprite's pixels come from, and `docs/05-ASSETS.md`
 * says how the pipeline works. Neither says what is actually AVAILABLE — how many cells a sheet
 * has, how many of them are empty, what colours it uses, which parts are worth kitbashing from.
 * That knowledge lived in whoever had most recently opened the PNG in an image viewer, which is
 * to say it did not live anywhere.
 *
 * Everything below is measured from the files. Nothing is copied from a vendor's README, because
 * a vendor's README describes the pack they published, not the file on this disk.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const OUT = join(ROOT, 'docs', '09-ASSET-CATALOGUE.md');

/** Every PNG under assets/vendor, with its declared grid from the manifest where there is one. */
function findSheets() {
  const manifest = JSON.parse(readFileSync(join(ASSETS, 'sprites', 'manifest.json'), 'utf8'));
  const declared = new Map();
  for (const [key, sheet] of Object.entries(manifest.sheets ?? {})) {
    declared.set(resolve(ASSETS, sheet.file).toLowerCase(), { key, ...sheet });
  }

  const found = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.png')) {
        found.push({ file: full, declared: declared.get(full.toLowerCase()) ?? null });
      }
    }
  };
  walk(join(ASSETS, 'vendor'));
  found.sort((a, b) => a.file.localeCompare(b.file));
  return found;
}

/**
 * Infer a cell grid when the manifest does not declare one.
 *
 * Tries the sizes this project actually uses, largest first, and accepts the first that tiles the
 * image exactly with a plausible spacing. Reported as INFERRED so nobody mistakes it for the
 * measured, verified geometry in the manifest — a guessed grid that looks right is exactly how a
 * kitbash ends up half a pixel off.
 */
function inferGrid(width, height) {
  for (const cell of [32, 24, 16, 8]) {
    for (const spacing of [0, 1]) {
      const cols = (width + spacing) / (cell + spacing);
      const rows = (height + spacing) / (cell + spacing);
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 1 && rows > 1) {
        return { w: cell, h: cell, spacingX: spacing, spacingY: spacing, cols, rows, inferred: true };
      }
    }
  }
  return null;
}

function analyse(entry) {
  const png = PNG.sync.read(readFileSync(entry.file));
  const { width, height, data } = png;

  const colours = new Set();
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    opaque++;
    // Cap the set: a photographic sheet would otherwise build a million-entry Set for no gain.
    if (colours.size <= 4096) {
      colours.add((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | a);
    }
  }

  const cellSpec = entry.declared?.cell;
  const grid = cellSpec
    ? {
      w: cellSpec.w,
      h: cellSpec.h,
      spacingX: cellSpec.spacingX ?? 0,
      spacingY: cellSpec.spacingY ?? 0,
      marginX: cellSpec.marginX ?? 0,
      marginY: cellSpec.marginY ?? 0,
      cols: Math.floor((width - (cellSpec.marginX ?? 0) + (cellSpec.spacingX ?? 0)) / (cellSpec.w + (cellSpec.spacingX ?? 0))),
      rows: Math.floor((height - (cellSpec.marginY ?? 0) + (cellSpec.spacingY ?? 0)) / (cellSpec.h + (cellSpec.spacingY ?? 0))),
      inferred: false
    }
    : inferGrid(width, height);

  /*
   * Count cells that actually contain art.
   *
   * "How many cells" is a division; "how many are worth looking at" is the number that decides
   * whether a sheet is a resource or a mostly-empty grid. Both are reported.
   */
  let cells = 0;
  let usedCells = 0;
  if (grid) {
    const mx = grid.marginX ?? 0;
    const my = grid.marginY ?? 0;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        cells++;
        const x0 = mx + col * (grid.w + grid.spacingX);
        const y0 = my + row * (grid.h + grid.spacingY);
        let hit = false;
        for (let y = y0; y < y0 + grid.h && !hit; y++) {
          for (let x = x0; x < x0 + grid.w; x++) {
            const i = (y * width + x) * 4;
            if (i >= 0 && i < data.length && data[i + 3] !== 0) { hit = true; break; }
          }
        }
        if (hit) usedCells++;
      }
    }
  }

  const stat = statSync(entry.file);
  return {
    path: relative(ROOT, entry.file).replace(/\\/g, '/'),
    key: entry.declared?.key ?? null,
    bytes: stat.size,
    width,
    height,
    colours: colours.size > 4096 ? '4096+' : colours.size,
    opaquePixels: opaque,
    coverage: ((opaque / (width * height)) * 100).toFixed(1),
    grid,
    cells,
    usedCells,
    verified: entry.declared?.$verified ?? null,
    note: entry.declared?.$note ?? null
  };
}

/** Licence trail: the SOURCE.md next to each pack, which docs/05 requires to exist. */
function packLicences() {
  const vendor = join(ASSETS, 'vendor');
  const out = [];
  for (const entry of readdirSync(vendor, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(vendor, entry.name);
    const source = ['SOURCE.md', 'LICENSE.txt', 'License.txt'].find((f) => existsSync(join(dir, f)));
    let licence = 'NO SOURCE.md — docs/05 requires one';
    if (source) {
      const text = readFileSync(join(dir, source), 'utf8');
      const line = text.split('\n').find((l) => /licen[cs]e|CC0|public domain/i.test(l));
      licence = (line ?? source).trim().replace(/^#+\s*/, '').slice(0, 100);
    }
    out.push({ pack: entry.name, licence, hasSource: existsSync(join(dir, 'SOURCE.md')) });
  }
  return out;
}

function render(sheets, licences) {
  const lines = [];
  lines.push('# 09 — Asset catalogue');
  lines.push('');
  lines.push('**Generated. Do not edit by hand — run `npm run assets:catalogue`.**');
  lines.push('');
  lines.push('Every sheet on this disk, measured. `docs/05-ASSETS.md` describes the pipeline and');
  lines.push('`assets/sprites/manifest.json` declares what the app draws; this says what there IS to');
  lines.push('draw from. Nothing here is copied from a vendor README — a README describes the pack');
  lines.push('that was published, not the file sitting in `assets/vendor/`.');
  lines.push('');
  lines.push('## The packs, and their licences');
  lines.push('');
  lines.push('| Pack | Licence line | SOURCE.md |');
  lines.push('|---|---|---|');
  for (const l of licences) {
    lines.push(`| \`${l.pack}\` | ${l.licence} | ${l.hasSource ? 'yes' : '**missing**'} |`);
  }
  lines.push('');
  lines.push('## Sheets');
  lines.push('');
  lines.push('`cells` is the grid; `used` is how many of them contain any non-transparent pixel — the');
  lines.push('number that decides whether a sheet is a resource or a mostly-empty grid. A grid marked');
  lines.push('INFERRED was guessed from the image dimensions and has NOT been verified: do not cut a');
  lines.push('kitbash from one until it has been measured and recorded in the manifest.');
  lines.push('');
  /*
   * Only real SHEETS get a row.
   *
   * The UI pack is ~740 individual sprite files — bar_round_gloss_large_l.png and its six hundred
   * siblings. One row each produced a 764-row table nobody would ever read, which is the same as
   * having no catalogue. A sheet is something with a grid worth cutting from; everything else is
   * rolled into a per-pack summary below, where the useful facts are the count and the size range.
   */
  const isSheet = (s) => Boolean(s.key) || (s.cells >= 16 && s.width >= 128 && s.height >= 64);
  const realSheets = sheets.filter(isSheet);
  const loose = sheets.filter((s) => !isSheet(s));

  lines.push('| Sheet | Manifest key | Size | Grid | Cells | Used | Colours | Ink |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const s of realSheets) {
    const grid = s.grid
      ? `${s.grid.w}×${s.grid.h}${s.grid.spacingX ? ` +${s.grid.spacingX}` : ''} ${s.grid.inferred ? '*(INFERRED)*' : ''}`
      : '**none found**';
    lines.push(
      `| \`${s.path.replace('assets/vendor/', '')}\` | ${s.key ? `\`${s.key}\`` : '—'} | ${s.width}×${s.height} | ${grid} | ${s.cells || '—'} | ${s.usedCells || '—'} | ${s.colours} | ${s.coverage}% |`
    );
  }
  lines.push('');

  if (loose.length) {
    lines.push('## Loose sprites');
    lines.push('');
    lines.push('Individual PNGs rather than sheets — one image per file. Usable, but each one needs its');
    lines.push('own manifest entry with `source: file`, so reach for them only when a sheet cell will not');
    lines.push('do. Grouped by the directory they live in.');
    lines.push('');
    lines.push('| Directory | Files | Size range | Colours (max) |');
    lines.push('|---|---|---|---|');
    const byDir = new Map();
    for (const s of loose) {
      const dir = s.path.replace('assets/vendor/', '').split('/').slice(0, -1).join('/');
      const group = byDir.get(dir) ?? { count: 0, minW: Infinity, maxW: 0, minH: Infinity, maxH: 0, colours: 0 };
      group.count++;
      group.minW = Math.min(group.minW, s.width);
      group.maxW = Math.max(group.maxW, s.width);
      group.minH = Math.min(group.minH, s.height);
      group.maxH = Math.max(group.maxH, s.height);
      const c = typeof s.colours === 'number' ? s.colours : 4096;
      group.colours = Math.max(group.colours, c);
      byDir.set(dir, group);
    }
    for (const [dir, g] of [...byDir.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const size = g.minW === g.maxW && g.minH === g.maxH
        ? `${g.minW}×${g.minH}`
        : `${g.minW}×${g.minH} – ${g.maxW}×${g.maxH}`;
      lines.push(`| \`${dir}\` | ${g.count} | ${size} | ${g.colours} |`);
    }
    lines.push('');
  }

  const declared = sheets.filter((s) => s.key);
  if (declared.length) {
    lines.push('## Verified geometry');
    lines.push('');
    lines.push('What the manifest records about the sheets the app actually cuts from. These are');
    lines.push('measurements someone made and wrote down, which is why they are the only grids safe');
    lines.push('to kitbash against.');
    lines.push('');
    for (const s of declared) {
      lines.push(`### \`${s.key}\` — ${s.path.replace('assets/vendor/', '')}`);
      lines.push('');
      lines.push(`${s.width}×${s.height}, ${s.grid ? `${s.grid.cols}×${s.grid.rows} cells` : 'no grid'}, ${s.usedCells} of ${s.cells} used, ${s.colours} colours.`);
      lines.push('');
      if (s.verified) {
        for (const line of (Array.isArray(s.verified) ? s.verified : [s.verified])) lines.push(`> ${line}`);
        lines.push('');
      }
      if (s.note) { lines.push(`**Note:** ${s.note}`); lines.push(''); }
    }
  }

  lines.push('## Seeing the cells');
  lines.push('');
  lines.push('The catalogue counts; it does not show. To pick coordinates, render a ruled contact');
  lines.push('sheet and read them off it — never guess:');
  lines.push('');
  lines.push('```bash');
  lines.push('node tools/sheet-contact.mjs k1bit out.png --zoom 6 --range 0,6,22,16');
  lines.push('```');
  lines.push('');
  return lines.join('\n') + '\n';
}

const sheets = findSheets().map(analyse);
const licences = packLicences();
const markdown = render(sheets, licences);

const hash = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (hash(current) !== hash(markdown)) {
    console.error('docs/09-ASSET-CATALOGUE.md is out of date — run `npm run assets:catalogue`.');
    process.exit(1);
  }
  console.log(`Asset catalogue up to date (${sheets.length} sheets).`);
} else {
  writeFileSync(OUT, markdown, 'utf8');
  const used = sheets.reduce((sum, s) => sum + s.usedCells, 0);
  console.log(`Catalogued ${sheets.length} file(s), ${used} non-empty cells -> ${relative(ROOT, OUT)}`);
}
