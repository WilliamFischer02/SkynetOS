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
import { COMPONENT_STYLE, depthOffset, drawComponent, drawDepth, drawFrame, frameMargin } from './component-art.js';
import type { NodeFrame } from '@shared/frames.js';

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
  /** Title size. 11 or 22 — the only two this pixel font is exact at. */
  nameSize?: 11 | 22;
  /** The copper hanging off the edge. Drawn in a margin outside the footprint. */
  frame?: NodeFrame;
  /** 0-5. Layers of long shadow cast down-right, behind the body. */
  priority?: number;
  /** The room's mask-dark, for the shadow stack. */
  maskDark?: string;
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
  /**
   * How the nameplate is printed: colour, outline, plate. Resolved from the node's own tokens
   * against the room's theme, so a title styled `signal` is the room's accent wherever it is.
   */
  nameStyle?: NameplateStyle;
  /**
   * The auto-appended room suffix — `OS` — drawn smaller and darker after the title.
   *
   * A `drive.room` stores the STEM (`Minecraft`) and the board prints `MinecraftOS`. The suffix is
   * not editable because it is not data; it is a convention. See packages/shared/room-title.ts,
   * which also explains why it is not the 75% size that was asked for.
   */
  suffix?: { text: string; size: 11 | 22; color: string; stroke: string | null } | null;
}

/** The resolved styling for a nameplate, from the node's palette tokens. */
export interface NameplateStyle {
  color: string;
  stroke: string | null;
  plateFill: string;
  plateBorder: string;
}

/** Height of the nameplate strip above a package, in px. One line of silkscreen plus edges. */
export const NAMEPLATE_HEIGHT = 15;

/** The taller strip a 22px title needs. Same edges, twice the type. */
export const NAMEPLATE_HEIGHT_22 = 27;

export function nameplateHeight(size: 11 | 22): number {
  return size === 22 ? NAMEPLATE_HEIGHT_22 : NAMEPLATE_HEIGHT;
}

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
export function nameplateOffset(name: string | undefined, size: 11 | 22 = 11): number {
  return name && name.trim() ? nameplateHeight(size) : 0;
}

/**
 * How far LEFT and UP a node's texture starts from its grid position.
 *
 * The nameplate extends upward and the frame extends in every direction, so a framed node's
 * texture begins outside its own footprint. The footprint itself is unchanged — see the
 * placeholder's comment — so this is purely a placement offset.
 */
export function textureOffset(
  name: string | undefined,
  size: 11 | 22,
  frame: NodeFrame | undefined
): { x: number; y: number } {
  const margin = frameMargin(frame);
  return { x: margin, y: nameplateOffset(name, size) + margin };
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
    /*
     * Identify an image by its CONTENT, not its length.
     *
     * This used to be `src.length`, and two different mosaics that happened to encode to the same
     * number of base64 characters would produce the same cache key — so one node would silently be
     * handed another node's texture, frame, depth and all. Sampling both ends plus the length is
     * effectively collision-free for data URLs and costs a substring rather than a hash of a
     * hundred kilobytes.
     */
    const imageKey = (image: { src?: string; dataset?: DOMStringMap } | null | undefined): string => {
      if (!image) return '0';
      const glowKey = (image as HTMLCanvasElement).dataset?.['glowKey'];
      if (glowKey) return glowKey;
      const src = image.src ?? '';
      return `${src.length}|${src.slice(0, 24)}|${src.slice(-24)}`;
    };
    const faceKey = imageKey(spec.face as { src?: string; dataset?: DOMStringMap } | null);
    const styleKey = spec.nameStyle ? `${spec.nameStyle.color}|${spec.nameStyle.stroke ?? ''}|${spec.nameStyle.plateFill}|${spec.nameStyle.plateBorder}` : '';
    const suffixKey = spec.suffix ? `${spec.suffix.text}|${spec.suffix.size}|${spec.suffix.color}|${spec.suffix.stroke ?? ''}` : '';
    const key = `${spec.kind}:${spec.w}x${spec.h}:${spec.designator}:${name}:${spec.nameSize ?? 11}:${spec.maskLight}:${spec.signal}:${faceKey}:${imageKey(spec.logo)}:${styleKey}:${suffixKey}:${spec.frame ?? ''}:${spec.priority ?? 0}`;
    const cached = this.placeholders.get(key);
    if (cached) return cached;

    const bodyW = Math.max(TILE, spec.w * TILE);
    const bodyH = Math.max(TILE, spec.h * TILE);

    /*
     * Two extensions to the texture, both OUTSIDE the footprint — the same rule the nameplate
     * follows. Collision, routing and hit-testing keep running on the grid the board file
     * describes; a framed, raised node is not a bigger node.
     *
     *   margin  room on every side for the frame's legs, fingers or tabs.
     *   depth   room down and to the right for the long-shadow stack.
     */
    const margin = frameMargin(spec.frame);
    const depth = depthOffset(spec.priority);

    const nameSize = spec.nameSize === 22 ? 22 : 11;
    const nameColor = spec.nameStyle?.color ?? SILK;
    const plate = name ? renderSilkText(name, nameSize, nameColor) : null;
    /*
     * The room suffix, drawn after the title at one size down and in its own colour. `drive.room`
     * nodes store `Minecraft` and the board prints `MinecraftOS` — see shared/room-title.ts.
     */
    const suffixText = spec.suffix ? renderSilkText(spec.suffix.text, spec.suffix.size, spec.suffix.color) : null;
    const suffixOutline = spec.suffix?.stroke
      ? renderSilkText(spec.suffix.text, spec.suffix.size, spec.suffix.stroke)
      : null;
    const plateH = plate ? nameplateHeight(nameSize) : 0;
    const plateW = plate ? plate.width + (suffixText ? suffixText.width + 1 : 0) + 6 : 0;

    const width = Math.max(bodyW + margin * 2 + depth, plateW);
    const height = bodyH + plateH + margin * 2 + depth;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable — cannot draw component sprite');
    ctx.imageSmoothingEnabled = false;

    // --- nameplate, above the package, one line, whatever the name's length ---
    if (plate) {
      ctx.fillStyle = spec.nameStyle?.plateFill ?? spec.maskLight;
      ctx.fillRect(margin, 0, plateW, plateH - 2);
      ctx.fillStyle = spec.nameStyle?.plateBorder ?? SILK;
      ctx.fillRect(margin, 0, plateW, 1);
      ctx.fillRect(margin, plateH - 3, plateW, 1);
      ctx.fillRect(margin, 0, 1, plateH - 2);
      ctx.fillRect(margin + plateW - 1, 0, 1, plateH - 2);
      const nameY = Math.floor((plateH - 2 - plate.height) / 2);
      if (spec.nameStyle?.stroke) {
        // Same eight-way stamp as a text node's outline. Whole pixels only; see text-plate.ts.
        const outline = renderSilkText(name, nameSize, spec.nameStyle.stroke);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          ctx.drawImage(outline.canvas, margin + 3 + (dx as number), nameY + (dy as number));
        }
      }
      ctx.drawImage(plate.canvas, 3, nameY);

      if (suffixText) {
        // Baseline-aligned, not top-aligned: a smaller suffix hung from the top of the strip
        // would float above the title instead of sitting on the same line as it.
        const suffixY = nameY + plate.height - suffixText.height;
        const suffixX = margin + 3 + plate.width + 1;
        if (suffixOutline) {
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            ctx.drawImage(suffixOutline.canvas, suffixX + (dx as number), suffixY + (dy as number));
          }
        }
        ctx.drawImage(suffixText.canvas, suffixX, suffixY);
      }
      // A short stem down to the package, so the plate reads as belonging to it.
      ctx.fillStyle = COPPER_DARK;
      ctx.fillRect(margin + (Math.min(plateW, bodyW) >> 1), plateH - 3, 1, 3);
    }

    // --- the shadow stack, then the frame, then the package ---
    const bodyX = margin;
    const bodyY = plateH + margin;

    // Behind everything: the long shadow that makes priority read as height.
    if (depth > 0) drawDepth(ctx, bodyX, bodyY, bodyW, bodyH, spec.priority ?? 0, spec.maskDark ?? '#000000');

    // Behind the body, in the margin: the copper.
    if (spec.frame && spec.frame !== 'none') {
      drawFrame(ctx, spec.frame, bodyX, bodyY, bodyW, bodyH, margin, spec.signal);
    }

    if (spec.face) {
      // A face image replaces the package body entirely: it is the component's printed face.
      ctx.drawImage(spec.face, bodyX, bodyY, bodyW, bodyH);
      drawBevel(ctx, bodyX, bodyY, bodyW, bodyH);

      /*
       * The logo goes ON the wallpaper, centred, with its own bevel.
       *
       * Its own bevel and not just a border: without one, two dithered images in the same six
       * colours sitting on top of each other read as a single noisy texture, and the badge stops
       * being a badge. The frame is what separates them.
       */
      if (spec.logo) {
        const box = spec.logo.width;
        const lx = bodyX + Math.floor((bodyW - box) / 2);
        const ly = bodyY + Math.floor((bodyH - box) / 2);
        // A mask-light plate behind it, so a logo with transparent padding still reads as a badge
        // rather than as a hole cut in the wallpaper.
        ctx.fillStyle = spec.maskLight;
        ctx.fillRect(lx, ly, box, box);
        ctx.drawImage(spec.logo, lx, ly, box, box);
        drawBevel(ctx, lx, ly, box, box);
      }
    } else {
      drawComponent(
        { ctx, x: bodyX, y: bodyY, w: bodyW, h: bodyH, maskLight: spec.maskLight, signal: spec.signal },
        COMPONENT_STYLE[spec.kind] ?? { silhouette: 'plain', inset: 2 }
      );
      // A logo is a badge on the component, not on the picture — so it lands on a drawn package
      // exactly as it lands on a wallpaper.
      if (spec.logo) {
        const box = spec.logo.width;
        const lx = bodyX + Math.floor((bodyW - box) / 2);
        const ly = bodyY + Math.floor((bodyH - box) / 2);
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
      const tx = bodyX + Math.floor((bodyW - rendered.width) / 2);
      const ty = bodyY + Math.floor((bodyH - rendered.height) / 2);
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
