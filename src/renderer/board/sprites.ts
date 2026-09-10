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
import { TILE } from './camera.js';
import { renderSilkText, measureSilkText } from './silkscreen.js';

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
  /** The node's name, printed beside the designator: `U1 JARVIS`. */
  name?: string;
  /** The current room's mask-light. Stands in for @mask-light until the M2 palette shader lands. */
  maskLight: string;
  /**
   * A decoded face image, already dithered to the room's six colours by the mosaic service and
   * already exactly w*16 x h*16 pixels. Drawn as the component body instead of the flat fill.
   */
  face?: HTMLImageElement | null;
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
  async load(atlasJsonUrl: string | null): Promise<{ loaded: boolean; frames: number; reason?: string }> {
    if (!atlasJsonUrl) return { loaded: false, frames: 0, reason: 'no atlas built yet — run `npm run assets:bake`' };
    try {
      const response = await fetch(atlasJsonUrl);
      if (!response.ok) return { loaded: false, frames: 0, reason: `atlas fetch failed: HTTP ${response.status}` };
      const data = (await response.json()) as AtlasData;

      const imageUrl = new URL(data.meta.image, atlasJsonUrl).href;
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
  placeholder(spec: PlaceholderSpec): Texture {
    const key = `${spec.w}x${spec.h}:${spec.designator}:${spec.name ?? ''}:${spec.maskLight}:${spec.face?.src.length ?? 0}`;
    const cached = this.placeholders.get(key);
    if (cached) return cached;

    const width = Math.max(TILE, spec.w * TILE);
    const height = Math.max(TILE, spec.h * TILE);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable — cannot draw placeholder sprite');
    ctx.imageSmoothingEnabled = false;

    // Body: the face image if the node has one, otherwise a flat mask-light fill.
    // The face arrives already dithered to the room's six colours and already at exactly this
    // size, so it is a straight 1:1 blit — no scaling, no resampling, nothing to smooth.
    if (spec.face) {
      ctx.drawImage(spec.face, 0, 0, width, height);
    } else {
      ctx.fillStyle = spec.maskLight;
      ctx.fillRect(0, 0, width, height);
    }

    // 1px silkscreen outline, drawn as four fills so it lands on exact pixel boundaries.
    // A 1px strokeRect straddles the boundary and produces two half-lit rows.
    ctx.fillStyle = SILK;
    ctx.fillRect(0, 0, width, 1);
    ctx.fillRect(0, height - 1, width, 1);
    ctx.fillRect(0, 0, 1, height);
    ctx.fillRect(width - 1, 0, 1, height);

    // Copper-dark inner bevel on the bottom/right, the way a real component casts on the mask.
    ctx.fillStyle = COPPER_DARK;
    ctx.fillRect(1, height - 2, width - 2, 1);
    ctx.fillRect(width - 2, 1, 1, height - 2);

    // Label: `U1 JARVIS` where it fits, falling back through two lines to designator-only.
    const layout = layoutLabel(
      spec.designator,
      spec.name,
      width,
      height,
      (text) => measureSilkText(text, 11)
    );

    if (layout.lines.length) {
      const rendered = layout.lines.map((line) => renderSilkText(line, 11, SILK));
      const gap = 1;
      const totalH = rendered.reduce((sum, r) => sum + r.height, 0) + gap * (rendered.length - 1);
      let ty = Math.floor((height - totalH) / 2);

      for (const line of rendered) {
        const tx = Math.floor((width - line.width) / 2);
        // Over a face image the silkscreen needs a ground to stay readable, the way a real
        // component's printed marking sits on a cleared patch of the package. One flat rect,
        // no shadow, no outline glow.
        if (spec.face) {
          ctx.fillStyle = spec.maskLight;
          ctx.fillRect(tx - 2, ty, line.width + 4, line.height);
        }
        ctx.drawImage(line.canvas, tx, ty);
        ty += line.height + gap;
      }
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
