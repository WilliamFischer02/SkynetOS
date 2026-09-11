import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitScale } from '../src/renderer/ui/Minimap.js';

/**
 * Structural guards on the renderer.
 *
 * These do not run the renderer — they read it. Every rule below is one that a unit test cannot
 * express because the thing being protected is *where code lives*, not what a function returns,
 * and every one of them has already been broken once in a way that shipped.
 */

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/**
 * ── The frame flicker ────────────────────────────────────────────────────────────────────────
 *
 * Reported: "applying a frame creates a flickering effect and appears to apply it to all nodes."
 *
 * There were three places building a node's texture spec — `drawNode`, the pulse-glow ticker and
 * the text-glow ticker — and they drifted. The glow ticker did not pass `frame`, `priority`,
 * `nameSize`, `nameStyle` or the room's OS suffix, so every pulse redrew the node stripped of all
 * of them and the next rebuild put them back. Several times a second. On exactly the nodes that
 * were glowing, which is why it read as the frame leaking across the board.
 *
 * The fix is structural: one builder, `specFor`. So the test is structural too — a second call
 * site is the bug, whatever it happens to pass today.
 */
describe('a node texture is described in exactly one place', () => {
  const canvas = read('src/renderer/board/BoardCanvas.tsx');

  it('calls sprites.placeholder only through the shared spec builder', () => {
    const calls = canvas.match(/sprites\.placeholder\(/g) ?? [];
    // drawNode and the pulse-glow ticker. Both hand it `specFor(...)` and nothing else.
    expect(calls.length, 'a new sprites.placeholder call site has appeared').toBe(2);
    for (const line of canvas.split('\n')) {
      if (!line.includes('sprites.placeholder(')) continue;
      expect(line, `sprites.placeholder must be given specFor(...): ${line.trim()}`)
        .toMatch(/sprites\.placeholder\(specFor\(/);
    }
  });

  it('builds that spec from the node, carrying every part of its appearance', () => {
    const builder = canvas.slice(canvas.indexOf('const specFor ='), canvas.indexOf('/** Redraw one node'));
    for (const field of ['frame', 'priority', 'nameSize', 'nameStyle', 'suffix', 'maskDark', 'logo']) {
      expect(builder, `specFor drops "${field}" — that is the flicker bug returning`).toContain(`${field}:`);
    }
  });
});

/**
 * ── The texture cache is keyed on content ────────────────────────────────────────────────────
 *
 * The face and logo used to be identified by `src.length`. Two different mosaics that encoded to
 * the same number of base64 characters produced the same cache key, and one node was silently
 * handed another node's texture — frame, depth and all. That is the other half of "appears to
 * apply it to all nodes", and it is a coin-flip bug that would have been miserable to chase.
 */
describe('the placeholder cache cannot hand one node another node`s texture', () => {
  const sprites = read('src/renderer/board/sprites.ts');

  it('identifies an image by its content, not by its length', () => {
    expect(sprites).not.toMatch(/spec\.(face|logo)\?\.src\.length/);
    expect(sprites).toContain('const imageKey =');
  });

  it('includes every visual field in the key', () => {
    const key = sprites.split('\n').find((l) => l.includes('const key = `${spec.kind}')) ?? '';
    for (const field of ['spec.frame', 'spec.priority', 'spec.nameSize', 'faceKey', 'imageKey(spec.logo)', 'styleKey', 'suffixKey']) {
      expect(key, `the cache key ignores ${field}, so changing it will not redraw`).toContain(field);
    }
  });
});

/**
 * ── Printed kinds are one list ───────────────────────────────────────────────────────────────
 *
 * "Which kinds occupy no grid" was written out five separate times. Adding `decor.image` missed
 * one and the app refused to load a valid board; adding `decor.part` missed a different one and
 * every trace on the root board started cutting through components.
 */
describe('printed kinds are defined once', () => {
  it('is declared in shared and nowhere else', () => {
    expect(read('packages/shared/types.ts')).toContain('export const PRINTED_KINDS');
    for (const file of [
      'src/renderer/board/layout.ts',
      'src/renderer/board/drag.ts',
      'src/main/services/board-store.ts'
    ]) {
      const text = read(file);
      // Each of these must DEFER, not re-list. A literal 'decor.part' here means a fourth copy.
      expect(text, `${file} re-lists the printed kinds instead of importing them`)
        .not.toMatch(/'note\.silk',\s*'group\.zone',\s*'decor\.image',\s*'decor\.part'/);
    }
  });
});

/**
 * ── Controls inside click-through chrome ─────────────────────────────────────────────────────
 *
 * Reported: "the add button is not clickable for some reason."
 *
 * `.breadcrumb`, `.hud` and `.help` are all `pointer-events: none`, deliberately — they are
 * mostly text, they sit over the board, and a strip of text that swallows drags meant for the
 * canvas is worse than one that overlaps them. The cost is that any real CONTROL placed inside
 * one inherits it and silently stops working: it renders, it highlights on hover in devtools, and
 * clicking does nothing at all.
 *
 * There is no way to catch that at runtime — a button that receives no events raises no error —
 * so it is caught here instead.
 */
describe('a control inside click-through chrome opts back in', () => {
  const css = readFileSync(join(ROOT, 'src/renderer/styles.css'), 'utf8');

  /** The rule block for a selector, up to its closing brace. */
  const blockFor = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) return '';
    return css.slice(at, css.indexOf('}', at));
  };

  it('still makes the chrome itself click-through', () => {
    // If this ever stops being true the guard below is measuring nothing, so assert the premise.
    expect(blockFor('.help')).toContain('pointer-events: none');
  });

  it.each(['.add-fab', '.drag-badge'])('%s is clickable', (selector) => {
    expect(blockFor(selector), `${selector} lives inside click-through chrome and never receives a click`)
      .toContain('pointer-events: auto');
  });
});

/**
 * ── A panel's size is a property of the panel ────────────────────────────────────────────────
 *
 * Reported: "the minimap is way too big of a window."
 *
 * Pixels-per-tile was a constant — 3, chosen when a board was 64 tiles wide, where 3 x 64 is a
 * tidy 192. Tripling every board to 192 tiles turned the same constant into 576 art pixels, which
 * at chrome scale 2 is over a thousand pixels of screen: a minimap occupying a quarter of the
 * window, with no way to move it or close it.
 *
 * The bug is the direction of the dependency. A panel that derives its SIZE from the data it
 * shows grows without limit as the data does. So the budget is fixed and the scale is derived,
 * and these check that a bigger board gets a smaller scale rather than a bigger panel.
 */
describe('the minimap fits its corner, whatever the board', () => {
  it('keeps every real board inside the budget', () => {
    for (const grid of [
      { width: 48, height: 32 },    // the smallest room
      { width: 64, height: 40 },    // the old root board
      { width: 144, height: 96 },   // a room today
      { width: 192, height: 120 },  // the root board today
      { width: 240, height: 160 }   // room to grow again before this needs rethinking
    ]) {
      const scale = fitScale(grid);
      expect(Number.isInteger(scale), 'a fractional scale is a blurry minimap').toBe(true);
      expect(scale).toBeGreaterThanOrEqual(1);
      expect(grid.width * scale, `a ${grid.width}x${grid.height} board overflows the panel`)
        .toBeLessThanOrEqual(240);
    }
  });

  it('gives a bigger board a smaller scale, never a bigger panel', () => {
    const small = fitScale({ width: 48, height: 32 });
    const large = fitScale({ width: 192, height: 120 });
    expect(large).toBeLessThanOrEqual(small);
  });

  it('never collapses to nothing, even past the point the budget can hold', () => {
    /*
     * One pixel per tile is the floor, and at the schema's maximum of 512 tiles that is 512 art
     * pixels — wider than the budget. There is no honest way to fit it: half a pixel per tile is
     * not a smaller minimap, it is a blurry one, and dropping tiles would be a minimap that lies
     * about where things are. So the budget is a target the floor outranks, and the failure mode
     * at an absurd board size is "large", not "empty" — `floor()` of a budget smaller than the
     * board is 0, and a zero-scale minimap is a black box.
     */
    expect(fitScale({ width: 512, height: 512 })).toBe(1);
  });
});

/**
 * ── The atlas has to reach the GPU ───────────────────────────────────────────────────────────
 *
 * Reported: "i tried loading one of the visual parts in and its an empty box - nothing rendered."
 *
 * The atlas source was built with `new TextureSource({ resource: image })` — the BASE class. Pixi
 * v8 chooses its GPU uploader from `source.uploadMethodId`: `ImageSource` sets it to `'image'`,
 * and the base class leaves it `'unknown'`, which is never uploaded. The result is a texture that
 * is entirely valid on the JS side — right dimensions, right frame, `visible: true`, `alpha: 1`,
 * positioned exactly where it belongs — with no pixels on the GPU.
 *
 * So every baked sprite rendered as nothing, and every diagnostic said it was healthy:
 * `sprites.has('decor.via')` was true, `texture.width` was 16, and the HUD read ATLAS 26. Vias,
 * screws, LEDs, grilles and pad arrays had never once appeared on the board.
 *
 * No unit test can catch this — it needs a GPU — so it is guarded twice: structurally here, and at
 * runtime in `load()`, which now refuses a source it cannot upload instead of reporting success.
 */
describe('the atlas is built from a source Pixi can upload', () => {
  const sprites = read('src/renderer/board/sprites.ts');

  it('constructs the atlas source with ImageSource', () => {
    expect(sprites, 'the atlas source must be an ImageSource').toContain('new ImageSource(');
  });

  it('never constructs the base TextureSource', () => {
    // As a TYPE it is fine — the field is declared `TextureSource | null`. As a constructor it is
    // the bug: the base class has no uploader.
    expect(sprites, 'new TextureSource() produces a texture with no pixels on the GPU')
      .not.toMatch(/new\s+TextureSource\s*\(/);
  });

  it('verifies at runtime that the source is uploadable', () => {
    // Loading the JSON and getting the image onto the GPU are two different successes. Only the
    // first one used to be reported, which is why the failure was invisible for so long.
    expect(sprites).toContain('uploadMethodId');
    expect(sprites).toMatch(/uploadMethod !== 'image'/);
  });
});

/**
 * ── Paint order is statement order ───────────────────────────────────────────────────────────
 *
 * There is no z-index anywhere in BoardCanvas. What is in front of what is decided entirely by the
 * ORDER of the `world.addChild(...)` calls, which makes it the kind of rule a unit test cannot
 * express and a careless edit can reverse without anything noticing.
 *
 * It has already been reversed once deliberately. `decor.part` first went ABOVE the components so
 * couriers would pass under aesthetic elements; William then asked for the opposite — "i want
 * shapes and aesthetic elements to render as a layer below the nodes - forget them rendering on
 * top of the robots" — which is also the more defensible reading: a via, a screw and a pad array
 * are features OF the board, and a chip soldered over pads hides them.
 */
describe('the board paints back to front in one fixed order', () => {
  const canvas = read('src/renderer/board/BoardCanvas.tsx');

  /** The layers, in the order they are added to `world`. */
  const order = [...canvas.matchAll(/world\.addChild\((\w+)(?:\.container)?\)/g)].map((m) => m[1]!);

  const before = (a: string, b: string): boolean => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    expect(ia, `${a} is not added to the world at all`).toBeGreaterThanOrEqual(0);
    expect(ib, `${b} is not added to the world at all`).toBeGreaterThanOrEqual(0);
    return ia < ib;
  };

  it('adds every layer exactly once', () => {
    expect(new Set(order).size, 'a layer is added to the world twice').toBe(order.length);
  });

  it('puts the substrate and the backdrops at the very back', () => {
    expect(before('substrateLayer', 'decorLayer')).toBe(true);
    expect(before('decorLayer', 'traceLayer')).toBe(true);
  });

  it('puts aesthetic parts BELOW the components', () => {
    expect(before('partLayer', 'nodeLayer'), 'parts must render under nodes').toBe(true);
  });

  it('lets the couriers walk OVER the parts', () => {
    // "forget them rendering on top of the robots". A robot crossing a via passes in front of it.
    expect(before('partLayer', 'couriers'), 'robots must render over parts').toBe(true);
  });

  it('keeps parts above the copper, so a via sits ON the trace', () => {
    expect(before('traceLayer', 'partLayer')).toBe(true);
    expect(before('zoneLayer', 'partLayer')).toBe(true);
  });

  it('still hides an arriving courier behind the node it is delivering to', () => {
    // This is what makes an arrival read as going INTO a component rather than stopping on it.
    expect(before('couriers', 'nodeLayer')).toBe(true);
  });

  it('keeps the grid and the selection overlays on top of everything', () => {
    expect(before('noteLayer', 'gridLayer')).toBe(true);
    expect(before('gridLayer', 'overlayLayer')).toBe(true);
    expect(order[order.length - 1]).toBe('overlayLayer');
  });
});

/**
 * ── A quarter turn must not go through a transform ───────────────────────────────────────────
 *
 * `sprite.rotation = Math.PI / 2` looks equivalent to turning a texture and is not. The float is
 * off by about 6e-17, so the transform is not quite a right angle, every pixel lands fractionally
 * off its grid, and the renderer resamples the lot — one blurred component on a board where
 * docs/02 §Anti-mush treats a single soft pixel as a crash-severity bug.
 *
 * Pixi carries a `rotate` field on the texture itself, applied in UV space as a permutation of the
 * four corners. Exact, no matrix, no resampling. Verifying the OUTPUT needs a GPU, so what is
 * checked here is that the exact mechanism is the one being used.
 */
describe('aesthetic assets turn without resampling', () => {
  const sprites = read('src/renderer/board/sprites.ts');
  const canvas = read('src/renderer/board/BoardCanvas.tsx');

  it('turns a tile through the texture, not the sprite transform', () => {
    expect(sprites, 'rotation must use groupD8 on the texture').toContain('groupD8');
    expect(canvas, 'a sprite transform rotation would resample every pixel')
      .not.toMatch(/sprite\.rotation\s*=/);
  });

  it('maps only the four quarter turns', () => {
    const table = sprites.slice(sprites.indexOf('const ROTATE_BY_DEGREES'), sprites.indexOf('};', sprites.indexOf('const ROTATE_BY_DEGREES')));
    for (const degrees of ['0:', '90:', '180:', '270:']) expect(table).toContain(degrees);
    // 45 would have to resample. There is no sharp 45-degree pixel turn.
    expect(table).not.toContain('45');
  });

  it('carries the rotation through the animation ticker', () => {
    /*
     * The LED parts re-fetch a texture every pulse. If the ticker dropped the rotation, an angled
     * LED would snap upright twelve times a second — the same shape as the frame flicker, and for
     * exactly the same reason: one value assembled in two places.
     */
    expect(canvas).toMatch(/animated\.push\(\{[^}]*rotation/);
    expect(canvas).toMatch(/get\(entry\.key,[^)]*entry\.rotation\)/);
  });

  it('keys the backdrop cache on rotation', () => {
    // Otherwise turning a backdrop leaves the old mosaic in the cache and nothing happens — the
    // shape of the pulse-glow checkbox that did nothing.
    expect(canvas).toMatch(/const key = `\$\{source\}@\$\{fp\.w\}x\$\{fp\.h\}r\$\{node\.rotation/);
  });
});
