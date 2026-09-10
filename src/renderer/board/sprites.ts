/**
 * The sprite store: keys in, textures out.
 *
 * This is the single most load-bearing decoupling in the project. The renderer asks for a KEY.
 * It never sees a file path, never knows whether the pixels came from a vendor cell, a kitbash,
 * or a hand-drawn PNG, and never knows whether they exist at all.
 *
 * A key with no atlas entry draws as a labelled placeholder rectangle (docs/05 §Placeholder
 * policy) — which is exactly why M0–M4 can be built and used before a single sprite exists.
 * Missing art is never a crash and never a broken-image icon.
 */

import { Texture, TextureSource, Rectangle } from 'pixi.js';
import { COPPER_DARK, SILK } from '@shared/palette.js';
import type { NodeKind } from '@shared/types.js';
import { TILE } from './camera.js';
import { renderSilkText, measureSilkText } from './silkscreen.js';
import { COMPONENT_STYLE, drawComponent } from './component-art.js';

export interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
}

export interface AtlasData {
  meta: { image: string; size: { w: number; h: number } };
  frames: Record<string, AtlasFrame>;
  animations?: Record<string, { fps: number; frames: string[] }>;
}

export interface PlaceholderSpec {
  /** Footprint in tiles. */
  w: number;
  h: number;
  /** The reference designator printed on it — U4, J2, D7. */
  designator: string;
  /** The node's name. Printed on a nameplate above the package, always on ONE line. */
  name?: string;
  /** The node kind, which decides the package silhouette. See component-art.ts. */
  kind: NodeKind;
  /** The current room's mask-light. Stands in for @mask-light until the M2 palette shader lands. */
  maskLight: string;
  /** The room's signal colour, for the single accent each package is allowed. */
  signal: string;
  /**
   * The WALLPAPER: a decoded image, already dithered to the room's six colours by the mosaic
   * service and already exactly w*16 x h*16 pixels. Drawn as the component body instead of the
   * flat fill.
   */
  face?: HTMLImageElement | HTMLCanvasElement | null;
  /**
   * The LOGO: a smaller square badge, centred on the face, already dithered and already exactly
   * logoBoxTiles(fp)*16 on a side. It keeps its transparency, so the wallpaper shows around it.
   */
  logo?: HTMLImageElement | null;
}

/** Height of the nameplate strip above a package, in px. One line of 11px silkscreen plus edges. */
export const NAMEPLATE_HEIGHT = 15;

/**
 * The 2px raised bevel every component and every badge wears.
 *
 * The problem it solves: a dithered photograph on a substrate made of the same six colours has no
 * edge. The picture bleeds into the board and the component stops looking like an object mounted
 * on it. A 1px silk outline (what this used to be) is not enough either — it reads as a sticker.
 *
 * So: an outer ring of copper-dark that separates the component from whatever is behind it, then
 * an inner ring that is silk along the top and left and copper-dark along the bottom and right.
 * That is the oldest trick there is for making a rectangle look raised, it costs two palette
 * colours, and it is exact — every edge is a whole pixel, no gradient, no alpha, nothing that
 * docs/02 anti-mush would object to.
 */
export function drawBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  highlight: string = SILK,
  shadow: string = COPPER_DARK
): void {
  if (w < 4 || h < 4) return;

  // Outer ring: separates the component from the substrate.
  ctx.fillStyle = shadow;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);

  // Inner ring: light from the top-left, dark to the bottom-right.
  ctx.fillStyle = highlight;
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillRect(x + 1, y + 1, 1, h - 2);
  ctx.fillStyle = shadow;
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
}

/**
 * How far ABOVE its grid position a node's texture starts, because the nameplate sits there.
 * The renderer needs this to place the sprite; the footprint itself is unchanged, so collisions,
 * routing and hit-testing all still work on the grid the board data describes.
 */
export function nameplateOffset(name: string | undefined): number {
  return name && name.trim() ? NAMEPLATE_HEIGHT : 0;
}

/**
 * How a node's label is laid out on its face. Pure so test/labels.test.ts can prove that every
 * footprint in the seeded boards gets a readable label and that nothing silently vanishes.
 *
 * The rule, in order of preference:
 *   1. `U1 JARVIS` on one line — what you actually want to read.
 *   2. `U1` on its own line, then the name wrapped across as many lines as fit.
 *   3. `U1` alone, if the name cannot be made to fit at all.
 *   4. Nothing. A 2x1 crystal oscillator has no room for print, and neither does a real one.
 *
 * Wrapping breaks on spaces AND after hyphens, because these names are part numbers —
 * `CC-TQR-ENGINE` has no spaces in it but breaks perfectly well as `CC-` `TQR-` `ENGINE`, which
 * is exactly how a real board prints a long part number on a small package.
 */
export type LabelLayout = {
  kind: 'one-line' | 'stacked' | 'designator-only' | 'none';
  lines: string[];
};

/**
 * Break a label into the smallest pieces a silkscreen printer would break it at.
 *
 * Three break points, in this order, and the input must NOT be uppercased first — the camelCase
 * boundary is the most useful one here and uppercasing destroys it:
 *   - whitespace:  `THE OBSERVER`   -> `THE` `OBSERVER`
 *   - after a hyphen: `CC-TQR-ENGINE` -> `CC-` `TQR-` `ENGINE`   (part-number style)
 *   - camelCase:  `TruthQuestRetro` -> `Truth` `Quest` `Retro`   (repo-name style)
 */
export function labelTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    // Keep the hyphen on the end of the preceding token, the way a hyphenated break reads.
    .flatMap((word) => word.split(/(?<=-)/))
    .flatMap((word) => word.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .filter(Boolean)
    .map((token) => token.toUpperCase());
}

/** Greedy wrap of tokens into lines no wider than `usableW`. */
function wrapTokens(tokens: string[], usableW: number, measure: (t: string) => number): string[] | null {
  const lines: string[] = [];
  let current = '';

  for (const token of tokens) {
    // A single token that cannot fit on a line of its own is unwrappable — give up rather than
    // truncate, because a half-printed name is worse than an honest designator.
    if (measure(token) > usableW) return null;
    const candidate = current ? `${current}${current.endsWith('-') ? '' : ' '}${token}` : token;
    if (measure(candidate) <= usableW) {
      current = candidate;
    } else {
      lines.push(current);
      current = token;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function layoutLabel(
  designator: string,
  name: string | undefined,
  widthPx: number,
  heightPx: number,
  measure: (text: string) => number,
  lineHeight = 11
): LabelLayout {
  const desig = designator.trim().toUpperCase();
  const label = (name ?? '').trim();
  // 2px of silkscreen margin each side, plus the 1px border and 1px bevel.
  const usableW = widthPx - 6;
  const usableH = heightPx - 6;

  if (!desig && !label) return { kind: 'none', lines: [] };
  if (usableW <= 0 || usableH < lineHeight) return { kind: 'none', lines: [] };

  const maxLines = Math.floor((usableH + 1) / (lineHeight + 1));

  /*
   * One greedy wrap over the designator AND the name tokens together, rather than reserving a
   * whole line for the designator. That is what makes tight footprints work: a 4x3 repo drive
   * fits `S1 TRUTH / QUEST / RETRO` in three lines, where a dedicated designator line would
   * have needed four and lost the name entirely.
   */
  const tokens = [...(desig ? [desig] : []), ...labelTokens(label)];
  const wrapped = wrapTokens(tokens, usableW, measure);
  if (wrapped && wrapped.length && wrapped.length <= maxLines) {
    return { kind: wrapped.length === 1 ? 'one-line' : 'stacked', lines: wrapped };
  }

  // The name is unprintable at this size. The designator is the half that matters — it is how
  // you refer to this node when talking to an agent — so it is what survives.
  if (desig && measure(desig) <= usableW) return { kind: 'designator-only', lines: [desig] };

  const upper = label.toUpperCase();
  if (!desig && upper && measure(upper) <= usableW) return { kind: 'designator-only', lines: [upper] };
  return { kind: 'none', lines: [] };
}

export class SpriteStore {
  private atlas: AtlasData | null = null;
  private atlasSource: TextureSource | null = null;
  private readonly cache = new Map<string, Texture>();
  private readonly placeholders = new Map<string, Texture>();

  /** Keys asked for that the atlas could not supply. Surfaced in the HUD so it is never a mystery. */
  readonly missing = new Set<string>();

  /**
   * Load assets/atlas/skynet.{json,png}. A missing atlas is a normal state, not an error:
   * assets/atlas/ is git-ignored and regenerated, so a fresh clone has none until
   * `npm run assets:bake` runs. Everything renders as placeholders until then.
   */
  async load(
    atlasJsonUrl: string | null,
    /**
     * The atlas image's real URL.
     *
     * Passed in rather than derived from `meta.image`. The bundler emits each imported asset at a
     * hashed path, so a relative resolve from the JSON's URL points at a file that does not exist
     * — which is precisely how this failed: "The source image cannot be decoded", in the built app
     * only, while dev worked fine.
     */
    atlasImageUrl?: string
  ): Promise<{ loaded: boolean; frames: number; reason?: string }> {
    if (!atlasJsonUrl) return { loaded: false, frames: 0, reason: 'no atlas built yet — run `npm run assets:bake`' };
    try {
      const response = await fetch(atlasJsonUrl);
      if (!response.ok) return { loaded: false, frames: 0, reason: `atlas fetch failed: HTTP ${response.status}` };
      const data = (await response.json()) as AtlasData;

      const imageUrl = atlasImageUrl ?? new URL(data.meta.image, atlasJsonUrl).href;
      const image = new Image();
      image.src = imageUrl;
      await image.decode();

      this.atlas = data;
      this.atlasSource = new TextureSource({
        resource: image,
        // Anti-mush rule 5. Set per-source as well as globally — a source created after the
        // global default is read would otherwise silently come up linear.
        scaleMode: 'nearest',
        autoGenerateMipmaps: false
      });
      return { loaded: true, frames: Object.keys(data.frames).length };
    } catch (err) {
      return { loaded: false, frames: 0, reason: `atlas load failed: ${(err as Error).message}` };
    }
  }

  get frameCount(): number {
    return this.atlas ? Object.keys(this.atlas.frames).length : 0;
  }

  /**
   * How many frames the atlas holds for a key. 0 when it holds none, 1 for a still.
   *
   * Read from the `animations` table the baker writes, falling back to counting `key#n` entries —
   * a hand-written atlas is allowed to omit the table, and a light that silently stops pulsing is
   * a worse failure than one that never started.
   */
  frameCountFor(key: string): number {
    if (!this.atlas) return 0;
    const animation = this.atlas.animations?.[key];
    if (animation) return animation.frames.length;
    let n = 0;
    while (this.atlas.frames[`${key}#${n}`]) n++;
    if (n) return n;
    return key in this.atlas.frames ? 1 : 0;
  }

  /** True if the atlas can actually supply this key. Frame 0 of an animated key counts. */
  has(key: string): boolean {
    if (!this.atlas) return false;
    return key in this.atlas.frames || `${key}#0` in this.atlas.frames;
  }

  /**
   * The real texture for a key, or null. Callers that get null draw a placeholder — they must
   * never fall back to some other key's art, which would be a quiet lie about what is on screen.
   */
  get(key: string, frame = 0): Texture | null {
    const cacheKey = `${key}#${frame}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!this.atlas || !this.atlasSource) {
      this.missing.add(key);
      return null;
    }
    const entry = this.atlas.frames[cacheKey] ?? this.atlas.frames[key];
    if (!entry) {
      this.missing.add(key);
      return null;
    }

    const texture = new Texture({
      source: this.atlasSource,
      frame: new Rectangle(entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h)
    });
    this.cache.set(cacheKey, texture);
    return texture;
  }

  /**
   * The placeholder: a flat mask-light rectangle at the node's footprint with its reference
   * designator in silkscreen.
   *
   * Deviation from docs/05, logged in docs/DECISIONS.md: the spec says "flat @mask-light
   * rectangle". A flat mask-light rectangle sitting on a substrate that is itself partly
   * mask-light is invisible at its edges, so this adds a 1px silk outline and a copper-dark
   * inner bevel — both already in the tri-tone, both already sanctioned for "component outlines"
   * by docs/02. Total colours: 3. Well inside the 6-colour budget.
   */
  /**
   * A node's drawn component: the package, plus a nameplate carrying its full name on ONE line.
   *
   * Two problems this solves, both reported from looking at the board:
   *
   * 1. **Everything looked the same.** Every node was an identical rectangle with different text
   *    in it, so the board was a wall of boxes you had to read one at a time. Now the package
   *    silhouette differs per kind — a DIP has pin legs, a drive has a platter and a label plate,
   *    a cartridge has connector fingers — and you can tell what something is without reading it.
   *    See component-art.ts.
   *
   * 2. **Names wrapped and became unreadable.** `THERE COULD BE GIANTS` on a 4-tile drive wrapped
   *    across three lines of 6px type. The name now goes on a nameplate ABOVE the package, sized
   *    to the text, never wrapped — which is how a real board prints a silkscreen label that is
   *    longer than the part it belongs to.
   *
   * The nameplate extends the texture, NOT the footprint. Collision, routing and hit-testing all
   * still work on the grid the board data describes, so nothing about the layout, the schema or
   * the validator changes — the label is printed on the board, the way `note.silk` is.
   */
  placeholder(spec: PlaceholderSpec): Texture {
    const name = (spec.name ?? '').trim().toUpperCase();
    /*
     * The cache key has to change when the FACE changes, and a glow frame is a canvas with no
     * `src` at all. `glowKey` is stamped on each frame by the glow builder for exactly this: two
     * frames of one cycle differ only in their pixels, so keying on anything else would serve
     * frame 0 forever and the pulse would never move.
     */
    const faceKey = spec.face
      ? (spec.face as { src?: string; dataset?: DOMStringMap }).src?.length
        ?? (spec.face as HTMLCanvasElement).dataset?.['glowKey']
        ?? 'canvas'
      : 0;
    const key = `${spec.kind}:${spec.w}x${spec.h}:${spec.designator}:${name}:${spec.maskLight}:${spec.signal}:${faceKey}:${spec.logo?.src.length ?? 0}`;
    const cached = this.placeholders.get(key);
    if (cached) return cached;

    const bodyW = Math.max(TILE, spec.w * TILE);
    const bodyH = Math.max(TILE, spec.h * TILE);

    const plate = name ? renderSilkText(name, 11, SILK) : null;
    const plateH = plate ? NAMEPLATE_HEIGHT : 0;
    const plateW = plate ? plate.width + 6 : 0;

    const width = Math.max(bodyW, plateW);
    const height = bodyH + plateH;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable — cannot draw component sprite');
    ctx.imageSmoothingEnabled = false;

    // --- nameplate, above the package, one line, whatever the name's length ---
    if (plate) {
      ctx.fillStyle = spec.maskLight;
      ctx.fillRect(0, 0, plateW, plateH - 2);
      ctx.fillStyle = SILK;
      ctx.fillRect(0, 0, plateW, 1);
      ctx.fillRect(0, plateH - 3, plateW, 1);
      ctx.fillRect(0, 0, 1, plateH - 2);
      ctx.fillRect(plateW - 1, 0, 1, plateH - 2);
      ctx.drawImage(plate.canvas, 3, Math.floor((plateH - 2 - plate.height) / 2));
      // A short stem down to the package, so the plate reads as belonging to it.
      ctx.fillStyle = COPPER_DARK;
      ctx.fillRect(Math.min(plateW, bodyW) >> 1, plateH - 3, 1, 3);
    }

    // --- the package itself ---
    if (spec.face) {
      // A face image replaces the package body entirely: it is the component's printed face.
      ctx.drawImage(spec.face, 0, plateH, bodyW, bodyH);
      drawBevel(ctx, 0, plateH, bodyW, bodyH);

      /*
       * The logo goes ON the wallpaper, centred, with its own bevel.
       *
       * Its own bevel and not just a border: without one, two dithered images in the same six
       * colours sitting on top of each other read as a single noisy texture, and the badge stops
       * being a badge. The frame is what separates them.
       */
      if (spec.logo) {
        const box = spec.logo.width;
        const lx = Math.floor((bodyW - box) / 2);
        const ly = plateH + Math.floor((bodyH - box) / 2);
        // A mask-light plate behind it, so a logo with transparent padding still reads as a badge
        // rather than as a hole cut in the wallpaper.
        ctx.fillStyle = spec.maskLight;
        ctx.fillRect(lx, ly, box, box);
        ctx.drawImage(spec.logo, lx, ly, box, box);
        drawBevel(ctx, lx, ly, box, box);
      }
    } else {
      drawComponent(
        { ctx, x: 0, y: plateH, w: bodyW, h: bodyH, maskLight: spec.maskLight, signal: spec.signal },
        COMPONENT_STYLE[spec.kind] ?? { silhouette: 'plain', inset: 2 }
      );
      // A logo is a badge on the component, not on the picture — so it lands on a drawn package
      // exactly as it lands on a wallpaper.
      if (spec.logo) {
        const box = spec.logo.width;
        const lx = Math.floor((bodyW - box) / 2);
        const ly = plateH + Math.floor((bodyH - box) / 2);
        ctx.fillStyle = spec.maskLight;
        ctx.fillRect(lx, ly, box, box);
        ctx.drawImage(spec.logo, lx, ly, box, box);
        drawBevel(ctx, lx, ly, box, box);
      }
    }

    // --- designator, on the package, centred. The name is on the plate; this is the part number.
    const desig = spec.designator.trim().toUpperCase();
    if (desig && measureSilkText(desig, 11) <= bodyW - 6 && bodyH >= 16) {
      const rendered = renderSilkText(desig, 11, SILK);
      const tx = Math.floor((bodyW - rendered.width) / 2);
      const ty = plateH + Math.floor((bodyH - rendered.height) / 2);
      // Clear a patch behind it, the way a real package leaves bare plastic for its marking.
      ctx.fillStyle = spec.maskLight;
      ctx.fillRect(tx - 2, ty - 1, rendered.width + 4, rendered.height + 2);
      ctx.drawImage(rendered.canvas, tx, ty);
    }

    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    this.placeholders.set(key, texture);
    return texture;
  }

  /** Does a designator even fit in this footprint? Used to decide whether to bother. */
  static designatorFits(designator: string, footprintTilesW: number): boolean {
    return measureSilkText(designator, 11) <= footprintTilesW * TILE - 4;
  }
}
