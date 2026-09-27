#!/usr/bin/env node
/**
 * Draw the SkynetOS tray icon and write `assets/tray/tray-16.png` and `assets/tray/tray-32.png`.
 *
 *   npm run icon:tray
 *
 * The JARVIS orb: the hologram window's globe seen from a little above, with its equator bright,
 * one latitude, two meridians, the far side of each ring dim, and a highlight top-left. Drawn in
 * the hologram's own six blues (HOLOGRAM_PALETTE in packages/shared/hologram.ts, index 0 to 5;
 * the seventh entry, white, is not used) on a transparent background. test/tray.test.ts holds the
 * two files to their sizes and to those colours.
 *
 * Two hand-sized arts rather than one scaled: the tray asks for 16 px at 100% display scale and
 * 32 px at 200% (services/tray.ts hands Windows both), and 32 halved nearest-neighbour loses the
 * rings. Whole pixels only, no smoothing (docs/02 Anti-mush), exactly as tools/make-icon.mjs.
 *
 * The PNGs are checked in: the app reads them from `assets/tray/` in the repo and from
 * `resources/assets/tray/` in an install (electron-builder.yml). Nothing is downloaded and no vendor
 * art is used, so there is no licence trail to keep.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repo, 'assets', 'tray');

/** HOLOGRAM_PALETTE[0..5]. Keep in step with packages/shared/hologram.ts; the test compares them. */
const COLOURS = {
  '.': null, //       transparent
  0: '#04090F', //    the empty window: the outline
  1: '#0B1E36', //    the sphere's body
  2: '#12466E', //    the far side of a ring, the meridians
  3: '#1F80B8', //    the limb, a near latitude
  4: '#48C8F0', //    the equator
  5: '#B8F4FF' //     the highlight
};

const ART_32 = [
  '............00000000............',
  '.........00033333333000.........',
  '.......003331111111133300.......',
  '......00332222222222223300......',
  '.....0332221122222211222330.....',
  '....033321112211112211123330....',
  '...03331111221111112211113330...',
  '..0031314422111111112211131300..',
  '..0311345541111111111221331130..',
  '.033111454111111111111333111330.',
  '.031111143333322223333321111130.',
  '.031112222211333333112222211130.',
  '03112222111111111111111122221130',
  '03122122111111111111111122122130',
  '03221121111111111111111112112230',
  '03211121111111111111111112111230',
  '03411121111111111111111112111430',
  '03441121111111111111111112114430',
  '03144221111111111111111112244130',
  '03114441111111111111111114441130',
  '.031124444411111111114444421130.',
  '.031112111444444444444111211130.',
  '.033112111111111111111111211330.',
  '..0311211111111111111111121130..',
  '..0031221111111111111111221300..',
  '...03312111111111111111121330...',
  '....033221111111111111122330....',
  '.....0332211111111111122330.....',
  '......00332111111111123300......',
  '.......003331111111133300.......',
  '.........00033333333000.........',
  '............00000000............'
];

const ART_16 = [
  '.....000000.....',
  '...0033333300...',
  '..003311113300..',
  '.00311111111300.',
  '.03154111111130.',
  '0311422222211130',
  '0312211111122130',
  '0321111111111230',
  '0341111111111430',
  '0344111111114430',
  '0331444444441330',
  '.03111111111130.',
  '.00311111111300.',
  '..003311113300..',
  '...0033333300...',
  '.....000000.....'
];

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

function render(art, size) {
  if (art.length !== size || art.some((row) => row.length !== size)) {
    console.error(`make-tray-icon: the ${size} px art must be ${size} rows of ${size} characters`);
    process.exit(1);
  }
  const png = new PNG({ width: size, height: size });
  png.data.fill(0);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const colour = COLOURS[art[y][x]];
      if (colour === undefined) { console.error(`make-tray-icon: unknown colour key "${art[y][x]}" at ${x},${y} (${size} px)`); process.exit(1); }
      if (colour === null) continue;
      const [r, g, b] = rgb(colour);
      const i = (y * size + x) * 4;
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tray-16.png'), render(ART_16, 16));
writeFileSync(join(outDir, 'tray-32.png'), render(ART_32, 32));
console.log('make-tray-icon: assets/tray/tray-16.png and assets/tray/tray-32.png');
