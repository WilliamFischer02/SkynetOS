import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
