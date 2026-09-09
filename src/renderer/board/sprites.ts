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
  /** The current room's mask-light. Stands in for @mask-light until the M2 palette shader lands. */
  maskLight: string;
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
    const key = `${spec.w}x${spec.h}:${spec.designator}:${spec.maskLight}`;
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

    // Body.
    ctx.fillStyle = spec.maskLight;
    ctx.fillRect(0, 0, width, height);

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

    // Designator, centred on whole pixels.
    if (spec.designator && width >= 24 && height >= 16) {
      const label = renderSilkText(spec.designator, 11, SILK);
      const tx = Math.floor((width - label.width) / 2);
      const ty = Math.floor((height - label.height) / 2);
      if (label.width <= width - 4) ctx.drawImage(label.canvas, tx, ty);
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
