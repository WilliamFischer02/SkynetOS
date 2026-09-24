#!/usr/bin/env node
/**
 * Draw the SkynetOS program icon and write `build/icon.ico` and `build/icon.png`.
 *
 *   npm run icon
 *
 * The icon is a chip on solder mask, in the root board's own six colours, drawn on a 32x32 grid
 * and scaled by whole numbers only (docs/02 Anti-mush applies to the taskbar too: a bilinear 256 px
 * icon of pixel art is mush). Sizes 16, 32, 48, 64, 128 and 256 are all packed into the .ico as
 * PNG entries, which Windows Vista and later read directly. 48 is 32 scaled by 1.5, which cannot
 * be done cleanly, so it is drawn as the 32 px art centred on a 48 px mask-dark plate.
 *
 * Nothing is downloaded and no vendor art is used, so there is no licence trail to keep.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repo, 'build');

const COLOURS = {
  '.': null, //              transparent
  D: '#0E1A14', //           mask-dark
  L: '#16261D', //           mask-light
  C: '#C08A3E', //           copper
  c: '#7A5423', //           copper-dark
  S: '#7FE0B0', //           signal
  W: '#E9E4D6', //           silk
  K: '#000000' //            ink
};

/*
 * 32 x 32. A rounded mask plate, a quad-flat-pack chip with copper legs on four sides, a silk
 * outline, and an S of signal-green traces on the die. Rows are strings so the art can be read.
 */
const ART = [
  '................................',
  '...DDDDDDDDDDDDDDDDDDDDDDDDDD...',
  '..DDLLLLLLLLLLLLLLLLLLLLLLLLDD..',
  '.DDLLLLLLLLLLLLLLLLLLLLLLLLLLDD.',
  '.DLLLLLLLCCLCCLCCLCCLCCLLLLLLLD.',
  '.DLLLLLLLCCLCCLCCLCCLCCLLLLLLLD.',
  '.DLLLLLLLccLccLccLccLccLLLLLLLD.',
  '.DLLLLLKKKKKKKKKKKKKKKKKKLLLLLD.',
  '.DLLLLLKWWWWWWWWWWWWWWWWKLLLLLD.',
  '.DLLCCcKWDDDDDDDDDDDDDDWKcCCLLD.',
  '.DLLCCcKWDSSSSSSSSSSSDDWKcCCLLD.',
  '.DLLLLLKWDSSSSSSSSSSSDDWKLLLLLD.',
  '.DLLCCcKWDSSDDDDDDDDDDDWKcCCLLD.',
  '.DLLCCcKWDSSDDDDDDDDDDDWKcCCLLD.',
  '.DLLLLLKWDSSDDDDDDDDDDDWKLLLLLD.',
  '.DLLCCcKWDSSSSSSSSSSSDDWKcCCLLD.',
  '.DLLCCcKWDSSSSSSSSSSSDDWKcCCLLD.',
  '.DLLLLLKWDDDDDDDDDDSSDDWKLLLLLD.',
  '.DLLCCcKWDDDDDDDDDDSSDDWKcCCLLD.',
  '.DLLCCcKWDDDDDDDDDDSSDDWKcCCLLD.',
  '.DLLLLLKWDSSSSSSSSSSSDDWKLLLLLD.',
  '.DLLCCcKWDSSSSSSSSSSSDDWKcCCLLD.',
  '.DLLCCcKWDDDDDDDDDDDDDDWKcCCLLD.',
  '.DLLLLLKWWWWWWWWWWWWWWWWKLLLLLD.',
  '.DLLLLLKKKKKKKKKKKKKKKKKKLLLLLD.',
  '.DLLLLLLLccLccLccLccLccLLLLLLLD.',
  '.DLLLLLLLCCLCCLCCLCCLCCLLLLLLLD.',
  '.DLLLLLLLCCLCCLCCLCCLCCLLLLLLLD.',
  '.DDLLLLLLLLLLLLLLLLLLLLLLLLLLDD.',
  '..DDLLLLLLLLLLLLLLLLLLLLLLLLDD..',
  '...DDDDDDDDDDDDDDDDDDDDDDDDDD...',
  '................................'
];

if (ART.length !== 32 || ART.some((row) => row.length !== 32)) {
  console.error('make-icon: the art must be 32 rows of 32 characters');
  process.exit(1);
}

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** The 32 px art at a whole-number scale, optionally centred on a larger transparent canvas. */
function render(size) {
  const scale = Math.max(1, Math.floor(size / 32));
  const drawn = 32 * scale;
  const offset = Math.floor((size - drawn) / 2);
  const png = new PNG({ width: size, height: size });
  png.data.fill(0);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const colour = COLOURS[ART[y][x]];
      if (colour === undefined) { console.error(`make-icon: unknown colour key "${ART[y][x]}" at ${x},${y}`); process.exit(1); }
      if (colour === null) continue;
      const [r, g, b] = rgb(colour);
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const i = ((offset + y * scale + dy) * size + offset + x * scale + dx) * 4;
          png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
        }
      }
    }
  }
  return PNG.sync.write(png);
}

/** 16 px: every second pixel of the art. Nearest-neighbour down, which keeps the palette exact. */
function render16() {
  const png = new PNG({ width: 16, height: 16 });
  png.data.fill(0);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const colour = COLOURS[ART[y * 2 + 1][x * 2 + 1]];
      if (!colour) continue;
      const [r, g, b] = rgb(colour);
      const i = (y * 16 + x) * 4;
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, data: size === 16 ? render16() : render(size) }));

// ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) per image, then the PNG payloads.
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let at = header.length;
images.forEach((image, n) => {
  const e = 6 + 16 * n;
  header.writeUInt8(image.size === 256 ? 0 : image.size, e);
  header.writeUInt8(image.size === 256 ? 0 : image.size, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(image.data.length, e + 8);
  header.writeUInt32LE(at, e + 12);
  at += image.data.length;
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, ...images.map((i) => i.data)]));
writeFileSync(join(outDir, 'icon.png'), images[images.length - 1].data);
console.log(`make-icon: build/icon.ico (${sizes.join(', ')} px) and build/icon.png (256 px)`);
