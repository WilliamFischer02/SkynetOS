import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logoBoxTiles } from '../packages/shared/types.js';
import { fieldsFor } from '../packages/shared/node-fields.js';

/**
 * Logo badges, and the black bars that were never black.
 *
 * Reported: "make it so that icons crop to the input image size so it doesn't raster black bars
 * into the logo images."
 *
 * Six of the seven logos on these boards are JPEGs with no alpha channel, at aspects from 0.8 to
 * 1.83. Every one was being letterboxed into a SQUARE box, and the renderer painted a mask-light
 * plate under the transparent padding. Mask-light is #16261D. To anyone looking at the board those
 * are black bars rastered into the logo, and no amount of "the padding is transparent" changes it.
 *
 * The fix is at the source: the mosaic emits the picture's own shape, so there is no padding for a
 * plate to show around. `mosaic.ts` and `sprites.ts` need a real image to exercise, so the pixel
 * behaviour is proven in the smoke (which prints every logo's output size against its source
 * aspect). What is checked here is the contract around it, and the two things that silently undid
 * it once each.
 */

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('the mosaic reports the image it actually produced', () => {
  const mosaic = read('src/main/services/mosaic.ts');

  it('offers a fit that adds no padding', () => {
    expect(mosaic, "a logo needs a fit that keeps the picture's own shape").toContain("'tight'");
  });

  it('uses the produced size, not the requested box, downstream', () => {
    /*
     * A `tight` fit deliberately returns something other than the box it was given. Dithering,
     * rotating or encoding at the REQUESTED size would pad the very bands this removes.
     */
    expect(mosaic).toContain('ditherToRamp(bitmap, outW, outH, ramp)');
    expect(mosaic).toContain('rotateRgba(dithered, outW, outH, rotation)');
  });

  it('reads a cached image back from the file rather than echoing the request', () => {
    /*
     * The second bug, and the nastier one: the cache-hit branch returned the requested box, so
     * every logo claimed to be square on the second load and the renderer drew it square. The bars
     * came back only after a restart, which is the worst possible way to be handed a bug.
     */
    expect(mosaic).toContain('function pngSize');
    expect(mosaic).toContain('real?.width ?? width');
    expect(mosaic).toContain('real?.height ?? height');
  });
});

describe('the renderer draws a logo at its own shape', () => {
  const sprites = read('src/renderer/board/sprites.ts');

  it('uses both dimensions', () => {
    const fn = sprites.slice(sprites.indexOf('function drawLogo'), sprites.indexOf('/** The resolved styling'));
    expect(fn).toContain('const w = logo.width;');
    expect(fn).toContain('const h = logo.height;');
  });

  it('never squares the badge off a single dimension', () => {
    /*
     * `const box = spec.logo.width` used for BOTH axes is the original bug, verbatim. Checked
     * against CODE only — the doc comment above `drawLogo` quotes the old line on purpose, and a
     * guard that cannot tell an explanation from the thing it explains is a guard that will be
     * deleted the first time it cries wolf.
     */
    const code = sprites
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join(' ');
    expect(code).not.toMatch(/const box = spec\.logo\.width/);
  });

  it('draws the plate no bigger than the picture it backs', () => {
    const fn = sprites.slice(sprites.indexOf('function drawLogo'), sprites.indexOf('/** The resolved styling'));
    expect(fn).toContain('ctx.fillRect(lx, ly, w, h)');
    expect(fn).toContain('ctx.drawImage(logo, lx, ly, w, h)');
  });
});

describe('the logo size control', () => {
  it('is offered wherever a logo is', () => {
    const withLogo = ['agent.jarvis', 'agent.code', 'drive.room', 'store.repo'] as const;
    for (const kind of withLogo) {
      const keys = fieldsFor(kind).map((f) => String(f.key));
      if (!keys.includes('logo')) continue;
      expect(keys, `${kind} can take a logo but cannot size it`).toContain('logoScale');
    }
  });

  it('keeps the footprint-derived default sensible', () => {
    // The scale is a percentage OF this, so it has to stay inside the node on its own.
    for (const fp of [{ w: 2, h: 2 }, { w: 4, h: 3 }, { w: 9, h: 13 }, { w: 24, h: 24 }]) {
      const box = logoBoxTiles(fp);
      expect(box).toBeGreaterThanOrEqual(1);
      expect(box, `a ${fp.w}x${fp.h} node's logo box overflows it`).toBeLessThan(Math.min(fp.w, fp.h) || 1);
    }
  });
});

describe('changing the logo size actually redraws it', () => {
  it('is part of the renderer cache key', () => {
    /*
     * Everything that changes the pixels has to be in the key. Leaving one out means the setting
     * appears to do nothing, because the cached image comes back unchanged — which is exactly how
     * the pulse-glow checkbox shipped broken.
     */
    const canvas = read('src/renderer/board/BoardCanvas.tsx');
    expect(canvas).toMatch(/const key = `\$\{source\}@\$\{fp\.w\}x\$\{fp\.h\}r\$\{node\.rotation \?\? 0\}s\$\{node\.logoScale/);
  });
});
