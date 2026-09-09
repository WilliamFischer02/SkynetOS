/**
 * The solder mask — the board itself.
 *
 * M0 draws a deterministic tiled substrate from the room's two mask tones so there is something
 * real to pan across and something that will visibly shimmer if the camera maths is wrong.
 * M2 replaces the pattern generator with the seeded procedural substrate and moves the tiles
 * into the atlas as substrate.mask_* keys; the tiling and camera code here does not change.
 *
 * Six colours per tile is the hard cap. This uses three: mask-dark, mask-light, copper-dark.
 */

import { Texture, TilingSprite } from 'pixi.js';
import { COPPER_DARK } from '@shared/palette.js';
import { TILE } from './camera.js';

/**
 * Deterministic 32-bit PRNG (mulberry32). Same seed, same board, forever — the substrate must
 * not reshuffle between launches or every screenshot of the same room looks like a different one.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SubstrateTheme {
  maskDark: string;
  maskLight: string;
  seed: number;
}

/**
 * One 4x4-tile (64x64px) patch that tiles seamlessly. Bigger than one tile so the eye does not
 * immediately read a 16px checkerboard, small enough to stay a cheap texture.
 */
const PATCH_TILES = 4;
const PATCH_PX = PATCH_TILES * TILE;

export function buildSubstrateTexture(theme: SubstrateTheme): Texture {
  const rand = mulberry32(theme.seed || 1);

  const canvas = document.createElement('canvas');
  canvas.width = PATCH_PX;
  canvas.height = PATCH_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot build substrate');
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = theme.maskDark;
  ctx.fillRect(0, 0, PATCH_PX, PATCH_PX);

  // Mask-light weave: a sparse, seeded speckle on whole pixels. This is the fibreglass read.
  ctx.fillStyle = theme.maskLight;
  for (let y = 0; y < PATCH_PX; y++) {
    for (let x = 0; x < PATCH_PX; x++) {
      if (rand() < 0.055) ctx.fillRect(x, y, 1, 1);
    }
  }

  // Tile registration: a 1px copper-dark tick at each 16px corner. This is the M0 shimmer
  // detector — if the camera ever lands on a fractional device pixel, these ticks crawl and
  // strobe long before anything else on screen looks wrong.
  ctx.fillStyle = COPPER_DARK;
  for (let ty = 0; ty < PATCH_TILES; ty++) {
    for (let tx = 0; tx < PATCH_TILES; tx++) {
      ctx.fillRect(tx * TILE, ty * TILE, 1, 1);
    }
  }

  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  texture.source.autoGenerateMipmaps = false;
  return texture;
}

/**
 * A TilingSprite covering the whole board. Sized in world pixels; the parent container carries
 * the camera transform, so this never needs to know about zoom.
 */
export function buildSubstrate(theme: SubstrateTheme, boardPx: { width: number; height: number }): TilingSprite {
  const sprite = new TilingSprite({
    texture: buildSubstrateTexture(theme),
    width: boardPx.width,
    height: boardPx.height
  });
  sprite.roundPixels = true;
  return sprite;
}
