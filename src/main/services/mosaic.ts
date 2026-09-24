import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, nativeImage, type NativeImage } from 'electron';
import omggif from 'omggif';
import { resolveLook, squareCheck, tileSourcePx } from '@shared/look.js';
import type { Board, BoardNode, BoardTheme } from '@shared/types.js';
import { footprintOf, type Rotation } from '@shared/types.js';
import { readdirSync } from 'node:fs';
import { parseFrameNames } from '@shared/avatar.js';
import { logoBoxPx, logoPathFor } from '@shared/logo-source.js';
import { compositeGif, isGifPath, planGifFrames } from '@shared/gif.js';
import { avatarDir } from './avatar-frames.js';
import { COPPER, COPPER_DARK, SILK, hexToRgb } from '@shared/palette.js';
import type { MosaicResult } from '@shared/ipc.js';
import { expandPath } from './target-resolver.js';

/**
 * Turns any image on disk into a component face that belongs on this board.
 *
 * The problem with "put a picture on a node" is that a photograph is thousands of colours and
 * soft edges, and this board is six colours and hard pixels. Pasting one in would look exactly
 * like what docs/02 calls mush. So the image is not pasted — it is *re-drawn* in the board's own
 * material: downsampled to the node's footprint, reduced to a luminance ramp, and dithered onto
 * the room's six palette colours with an ordered Bayer matrix.
 *
 * The result obeys every anti-mush rule by construction: exactly six colours, all of them exact
 * palette entries, binary alpha, integer dimensions, dither instead of blur. It reads as an
 * engraved or screen-printed component marking rather than a sticker.
 *
 * Decoding is Electron's `nativeImage`, which handles PNG, JPEG, GIF, BMP, ICO and WebP with no
 * new dependency and no image library to keep alive for the next decade.
 *
 * The source file is never copied, moved or modified. The board stores the path; the mosaic is
 * cached in userData and rebuilt whenever the file's mtime or size changes.
 */

/** 4x4 Bayer matrix. Ordered dithering — deterministic, tileable, and it never blurs. */
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
] as const;
const BAYER_N = 16;

/** ITU-R BT.601 luma. Matches how the eye ranks these colours by brightness. */
function luma(rgb: [number, number, number]): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/**
 * The room's six colours, sorted dark to light. That ordering IS the ramp the image is mapped
 * onto — mask-dark at the shadows, silk at the highlights, copper and the room signal in
 * between. Exactly six, which is the whole per-frame colour budget and not one more.
 */
export function themeRamp(theme: BoardTheme): [number, number, number][] {
  const colors: string[] = [theme.maskDark, theme.maskLight, COPPER_DARK, COPPER, theme.signal, SILK];
  return colors
    .map((hex) => hexToRgb(hex))
    .sort((a, b) => luma(a) - luma(b));
}

function thumbDir(): string {
  return join(app.getPath('userData'), 'thumbs');
}

/**
 * Cache key: everything that changes the output. Source identity and mtime so an edited image
 * is picked up, footprint so a resized node re-renders, and the theme so the same picture in
 * MinecraftOS and StoryOS are different mosaics.
 */
function cacheKey(
  file: string, mtimeMs: number, size: number, w: number, h: number,
  ramp: [number, number, number][], fit: string
): string {
  const hash = createHash('sha256');
  hash.update(file.toLowerCase());
  hash.update(String(mtimeMs));
  hash.update(String(size));
  hash.update(`${w}x${h}`);
  hash.update(fit);
  for (const c of ramp) hash.update(c.join(','));
  return hash.digest('hex').slice(0, 24);
}

/**
 * Downsample, ramp, dither. Returns raw RGBA at exactly w x h.
 *
 * Downsampling is done by `nativeImage.resize` with 'good' quality, which averages rather than
 * point-samples — that is correct here and is not a purity violation, because the averaging
 * happens on the SOURCE image before quantisation. What reaches the screen is the quantised
 * output: six exact palette colours, no intermediate values. Point-sampling a photo down to
 * 32x32 would just produce noise.
 */
export function ditherToRamp(
  bitmapBGRA: Buffer,
  w: number,
  h: number,
  ramp: [number, number, number][]
): Buffer {
  const out = Buffer.alloc(w * h * 4);
  const levels = ramp.length;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // nativeImage.toBitmap() is BGRA, not RGBA.
      const b = bitmapBGRA[i] ?? 0;
      const g = bitmapBGRA[i + 1] ?? 0;
      const r = bitmapBGRA[i + 2] ?? 0;
      const a = bitmapBGRA[i + 3] ?? 255;

      // Binary alpha: anything soft in the source is dropped, per anti-mush rule 1. A logo with
      // a transparent background therefore keeps a transparent background.
      if (a < 128) {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0;
        continue;
      }

      // Position on the ramp, in [0, levels-1], then nudged by the Bayer threshold. The +0.5
      // centres the matrix so the dither does not bias the whole image lighter or darker.
      const value = (luma([r, g, b]) / 255) * (levels - 1);
      const threshold = (BAYER_4[y % 4]![x % 4]! + 0.5) / BAYER_N - 0.5;
      let index = Math.round(value + threshold);
      if (index < 0) index = 0;
      if (index >= levels) index = levels - 1;

      const picked = ramp[index]!;
      out[i] = picked[0]; out[i + 1] = picked[1]; out[i + 2] = picked[2]; out[i + 3] = 255;
    }
  }
  return out;
}

/** RGBA -> BGRA, which is what nativeImage.createFromBitmap expects on Windows. */
function rgbaToBgra(rgba: Buffer): Buffer {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 2]!;
    out[i + 1] = rgba[i + 1]!;
    out[i + 2] = rgba[i]!;
    out[i + 3] = rgba[i + 3]!;
  }
  return out;
}

export interface MosaicRequest {
  /** Raw value from the node, may contain %ENV% or ~. */
  source: string;
  /** Output size in pixels. Always a whole number of tiles x 16, so it is always integral. */
  width: number;
  height: number;
  theme: BoardTheme;
  /**
   * Quarter turn, clockwise, baked into the pixels.
   *
   * Done here rather than in the renderer so the result still fills the requested box exactly: at
   * 90 and 270 the axes swap, so the source is rendered at the swapped size and turned back.
   */
  rotation?: Rotation;
  /**
   * How the source is fitted into that box.
   *
   *   fill     stretch to the exact box. Right for a WALLPAPER: the face is the footprint, and
   *            letterboxing it would leave dead bands of mask colour that read as a bug.
   *   tight    scale to fit INSIDE the box, preserve aspect, and output at THAT size — no
   *            padding at all, so the result is the picture's own shape. Right for a LOGO: the
   *            renderer draws a plate behind the badge, and a square plate behind a 16:9 picture
   *            is two dark bands that read as black bars rastered into the image. Cropping the
   *            box to the picture removes them at the source instead of hiding them.
   *   contain  scale to fit, preserve aspect, centre, leave the rest transparent. Right for a
   *            LOGO: a squashed logo stops being recognisable, which is the only thing a logo is
   *            for. The padding stays transparent so the wallpaper shows through around it.
   */
  fit?: 'fill' | 'contain' | 'tight';
  /**
   * For a GIF: composite and dither every frame (the default) so the board can play it, or pass
   * `false` to hold the first frame, which is what any other image does. See buildGifMosaic.
   */
  animate?: boolean;
}

/**
 * Fit a decoded source into the box the way `fit` says, as BGRA, with the size it actually came out.
 * One function for the still path and every GIF frame, so the two can never fit differently.
 */
function fitBitmap(
  source: NativeImage,
  fit: 'fill' | 'contain' | 'tight',
  width: number,
  height: number
): { bitmap: Buffer; width: number; height: number } | { error: string } {
  if (fit === 'tight') {
    /*
     * The box is a MAXIMUM, not a shape. Scale the source to fit inside it and emit exactly that,
     * so there is nothing to pad and nothing for a plate to show around.
     */
    const size = source.getSize();
    const scale = Math.min(width / Math.max(1, size.width), height / Math.max(1, size.height));
    const outW = Math.max(1, Math.round(size.width * scale));
    const outH = Math.max(1, Math.round(size.height * scale));
    return { bitmap: source.resize({ width: outW, height: outH, quality: 'good' }).toBitmap(), width: outW, height: outH };
  }
  if (fit === 'contain') {
    /*
     * Scale to fit inside the box, then centre it on a transparent field.
     *
     * The letterbox is transparent rather than a mask colour on purpose: a logo sits ON TOP of
     * the node's wallpaper, and an opaque band around it would punch a rectangular hole in the
     * picture underneath. `ditherToRamp` drops anything with alpha below 128, so the padding
     * survives quantisation as real transparency.
     */
    const size = source.getSize();
    const scale = Math.min(width / Math.max(1, size.width), height / Math.max(1, size.height));
    const innerW = Math.max(1, Math.round(size.width * scale));
    const innerH = Math.max(1, Math.round(size.height * scale));
    const inner = source.resize({ width: innerW, height: innerH, quality: 'good' }).toBitmap();

    const bitmap = Buffer.alloc(width * height * 4); // zero = fully transparent
    const offX = Math.floor((width - innerW) / 2);
    const offY = Math.floor((height - innerH) / 2);
    for (let y = 0; y < innerH; y++) {
      const from = y * innerW * 4;
      const to = ((y + offY) * width + offX) * 4;
      inner.copy(bitmap, to, from, from + innerW * 4);
    }
    return { bitmap, width, height };
  }
  // Stretch to exactly the box. See `fit` above for why aspect is not preserved here.
  const bitmap = source.resize({ width, height, quality: 'good' }).toBitmap();
  const expected = width * height * 4;
  if (bitmap.length < expected) return { error: `RESIZE PRODUCED ${bitmap.length} BYTES, EXPECTED ${expected}` };
  return { bitmap, width, height };
}

interface GifMeta {
  width: number;
  height: number;
  delays: number[];
  truncated: boolean;
  note: string | null;
  decodedBytes: number;
}

/**
 * An animated GIF as a strip of board-ready frames.
 *
 * Each frame is composited exactly as a browser does (packages/shared/gif.ts), then fitted, dithered
 * onto the room's palette and turned by the SAME code as a still image, so frame 0 of an animation
 * and the still of the same GIF are identical. docs/02 holds for every frame: six colours, binary
 * alpha, whole pixels.
 *
 * Bounded by GIF_CAPS: at most 120 frames, 16 MB of decoded output, and 160 megapixels of source
 * decoded. Beyond that the first frames still play and the result says what was dropped. The frames
 * are cached beside the stills (`<key>-anim-<n>.png` plus `<key>-anim.json`), keyed on the file's
 * mtime and size like every mosaic, so an edited GIF is rebuilt and an unchanged one costs a read.
 *
 * Null when there is nothing to animate (one frame, or a GIF omggif cannot read): the caller falls
 * back to the still path, which takes the first frame (decodeStill).
 */
function buildGifMosaic(
  file: string,
  key: string,
  ramp: [number, number, number][],
  width: number,
  height: number,
  fit: 'fill' | 'contain' | 'tight',
  rotation: Rotation
): MosaicResult | null {
  const dir = thumbDir();
  const metaFile = join(dir, `${key}-anim.json`);
  const frameFile = (i: number): string => join(dir, `${key}-anim-${i}.png`);
  const toUrl = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;

  if (existsSync(metaFile)) {
    try {
      const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as GifMeta;
      const frames = meta.delays.map((_, i) => toUrl(readFileSync(frameFile(i))));
      if (frames.length > 1) {
        return {
          ok: true, dataUrl: frames[0]!, width: meta.width, height: meta.height, source: file, cached: true,
          animation: { frames, delays: meta.delays, truncated: meta.truncated, note: meta.note, decodedBytes: meta.decodedBytes }
        };
      }
    } catch { /* a damaged cache entry is rebuilt below */ }
  }

  let reader: InstanceType<typeof omggif.GifReader>;
  try {
    reader = new omggif.GifReader(new Uint8Array(readFileSync(file)));
  } catch {
    return null;
  }
  const total = reader.numFrames();
  if (total <= 1) return null;

  const plan = planGifFrames(total, { width: reader.width, height: reader.height }, { width, height });
  const pngs: Buffer[] = [];
  let outW = width;
  let outH = height;
  let failed: string | null = null;
  let delays: number[];
  try {
    delays = compositeGif(reader, plan.frames, (_i, rgba) => {
      if (failed) return;
      const source = nativeImage.createFromBitmap(rgbaToBgra(Buffer.from(rgba)), { width: reader.width, height: reader.height });
      const fitted = fitBitmap(source, fit, width, height);
      if ('error' in fitted) { failed = fitted.error; return; }
      const dithered = ditherToRamp(fitted.bitmap, fitted.width, fitted.height, ramp);
      const turned = rotateRgba(dithered, fitted.width, fitted.height, rotation);
      outW = turned.width;
      outH = turned.height;
      pngs.push(nativeImage.createFromBitmap(rgbaToBgra(turned.data), { width: turned.width, height: turned.height }).toPNG());
    });
  } catch (err) {
    // A GIF whose frames will not decode is still a picture: the still path gets its first frame.
    console.warn(`[mosaic] GIF ${file} would not composite: ${(err as Error).message}`);
    return null;
  }
  if (failed) return { ok: false, error: `${failed as string} — ${file}` };
  if (pngs.length <= 1) return null;
  delays = delays.slice(0, pngs.length);

  const decodedBytes = outW * outH * 4 * pngs.length;
  console.log(
    `[mosaic] GIF ${file}: ${pngs.length}/${total} frames at ${outW}x${outH}, ` +
    `${(decodedBytes / 1048576).toFixed(1)} MB decoded${plan.truncated ? ` — ${plan.reason ?? ''}` : ''}`
  );

  const meta: GifMeta = { width: outW, height: outH, delays, truncated: plan.truncated, note: plan.reason, decodedBytes };
  try {
    mkdirSync(dir, { recursive: true });
    pngs.forEach((png, i) => writeFileSync(frameFile(i), png));
    writeFileSync(metaFile, JSON.stringify(meta));
  } catch (err) {
    // A cache write failure is not a rendering failure. Log and return the frames anyway.
    console.warn(`[mosaic] could not cache GIF frames for ${file}: ${(err as Error).message}`);
  }

  const frames = pngs.map(toUrl);
  return {
    ok: true, dataUrl: frames[0]!, width: outW, height: outH, source: file, cached: false,
    animation: { frames, delays, truncated: plan.truncated, note: plan.reason, decodedBytes }
  };
}


/**
 * Turn an RGBA buffer by a quarter, exactly.
 *
 * A permutation of whole pixels — every output pixel is some input pixel, byte for byte. Nothing is
 * averaged, interpolated or resampled, which is what makes it legal under docs/02 §Anti-mush where
 * an arbitrary angle would not be.
 *
 * At 90 and 270 the dimensions swap, so the caller asks for the SOURCE box and receives the turned
 * one. Doing it here rather than in the renderer means a rotated backdrop still fills its footprint
 * exactly instead of being letterboxed into a box of the wrong shape.
 */
export function rotateRgba(
  data: Buffer,
  width: number,
  height: number,
  degrees: Rotation
): { data: Buffer; width: number; height: number } {
  if (degrees === 0) return { data, width, height };

  const turned = Buffer.allocUnsafe(data.length);
  const outW = degrees === 180 ? width : height;
  const outH = degrees === 180 ? height : width;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      // Clockwise. At 90 the left column becomes the top row.
      const ox = degrees === 90 ? outW - 1 - y : degrees === 180 ? width - 1 - x : y;
      const oy = degrees === 90 ? x : degrees === 180 ? height - 1 - y : outH - 1 - x;
      data.copy(turned, (oy * outW + ox) * 4, from, from + 4);
    }
  }
  return { data: turned, width: outW, height: outH };
}


/**
 * A PNG's pixel dimensions, from its IHDR chunk. Null if it does not look like a PNG.
 *
 * Eight bytes at a fixed offset, big-endian, after the 8-byte signature and the 8-byte chunk
 * header. Cheaper and more certain than decoding.
 */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * A picture as a NativeImage, for the still path. nativeImage reads PNG and JPEG but not GIF, so a
 * GIF's first frame is composited by omggif and handed over as a bitmap: a held GIF, a one-frame GIF
 * and a GIF floor then decode like any other still. Empty when it cannot be read, as createFromPath is.
 */
function decodeStill(file: string): NativeImage {
  if (!isGifPath(file)) return nativeImage.createFromPath(file);
  try {
    const reader = new omggif.GifReader(new Uint8Array(readFileSync(file)));
    let still = nativeImage.createEmpty();
    compositeGif(reader, 1, (_i, rgba) => {
      still = nativeImage.createFromBitmap(rgbaToBgra(Buffer.from(rgba)), { width: reader.width, height: reader.height });
    });
    return still;
  } catch {
    return nativeImage.createEmpty();
  }
}

export function buildMosaic(request: MosaicRequest): MosaicResult {
  const { theme } = request;
  const rotation = request.rotation ?? 0;
  /*
   * Render at the SOURCE box and turn it into the requested one. A quarter turn swaps the axes, so
   * a 12x8 backdrop rotated 90 degrees has to be drawn 8x12 first — otherwise the turn produces an
   * 8x12 picture for a 12x8 hole and the board letterboxes it.
   */
  const width = rotation === 90 || rotation === 270 ? request.height : request.width;
  const height = rotation === 90 || rotation === 270 ? request.width : request.height;
  const fit = request.fit ?? 'fill';
  /*
   * What actually comes out. Only `tight` changes it — the others fill the requested box exactly.
   * Declared here because the dither, the rotation and the encode all need the REAL size, and
   * using `width`/`height` for a tight fit would pad the very bands this exists to remove.
   */
  let outW = width;
  let outH = height;
  const file = expandPath(request.source);

  if (!file) return { ok: false, error: 'NO IMAGE SET' };
  if (file.includes('..')) return { ok: false, error: `IMAGE PATH CONTAINS ".." — NOT ALLOWED — ${file}` };
  if (!existsSync(file)) return { ok: false, error: `IMAGE NOT FOUND — ${file}` };

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(file);
  } catch (err) {
    return { ok: false, error: `CANNOT READ IMAGE — ${(err as Error).message}` };
  }

  const ramp = themeRamp(theme);
  const key = cacheKey(file, stat.mtimeMs, stat.size, width, height, ramp, `${fit}r${rotation}`);

  // A GIF plays unless told not to. Anything it cannot animate falls through to the still below.
  if (request.animate !== false && isGifPath(file)) {
    const animated = buildGifMosaic(file, key, ramp, width, height, fit, rotation);
    if (animated) return animated;
  }

  const cached = join(thumbDir(), `${key}.png`);

  if (existsSync(cached)) {
    const bytes = readFileSync(cached);
    /*
     * Report what the FILE is, not what was asked for.
     *
     * A `tight` fit deliberately returns something other than the requested box — that is the
     * whole point of it — so echoing the request here made every cached logo claim to be square
     * and the renderer drew it square. The bars came back on the second load and nowhere else,
     * which is the worst kind of bug to be handed.
     *
     * A PNG's IHDR puts width and height at bytes 16-23, big-endian. Reading eight bytes beats
     * decoding the image or trusting a number from somewhere else.
     */
    const real = pngSize(bytes);
    return {
      ok: true,
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      width: real?.width ?? width,
      height: real?.height ?? height,
      source: file,
      cached: true
    };
  }

  const source = decodeStill(file);
  if (source.isEmpty()) {
    // Electron's image loader reads PNG and JPEG (and ICO on Windows); GIF goes through omggif above.
    // WebP and BMP are neither, so say which formats work rather than calling the file broken.
    if (/\.(webp|bmp)$/i.test(file)) {
      return { ok: false, error: `WEBP AND BMP CANNOT BE READ HERE YET — SAVE IT AS PNG, JPG OR GIF — ${file}` };
    }
    return { ok: false, error: `NOT A DECODABLE IMAGE — ${file}` };
  }

  const fitted = fitBitmap(source, fit, width, height);
  if ('error' in fitted) return { ok: false, error: `${fitted.error} — ${file}` };
  outW = fitted.width;
  outH = fitted.height;

  const { bitmap } = fitted;
  const dithered = ditherToRamp(bitmap, outW, outH, ramp);
  // Turn AFTER dithering: the dither is an ordered pattern locked to the pixel grid, and rotating
  // the source first would rotate the grid with it.
  const turned = rotateRgba(dithered, outW, outH, rotation);
  const png = nativeImage
    .createFromBitmap(rgbaToBgra(turned.data), { width: turned.width, height: turned.height })
    .toPNG();

  try {
    mkdirSync(thumbDir(), { recursive: true });
    writeFileSync(cached, png);
  } catch (err) {
    // A cache write failure is not a rendering failure. Log and return the pixels anyway.
    console.warn(`[mosaic] could not cache ${cached}: ${(err as Error).message}`);
  }

  return {
    ok: true,
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    width: turned.width,
    height: turned.height,
    source: file,
    cached: false
  };
}

/**
 * Build one of a node's two images.
 *
 *   face  the WALLPAPER, stretched to the whole footprint.
 *   logo  the BADGE, a proportional centred square with its aspect preserved.
 *
 * Both go through the same dither, the same palette and the same cache; only the box and the fit
 * differ. Two slots rather than one because they answer different questions: the wallpaper says
 * what a thing feels like, the logo says what it is, and stretching the second to a 6x4 rectangle
 * destroys the only property it has.
 */
/** The avatar's still face as an absolute path, or null while the frames folder has no idle.png. */
function avatarIdlePath(): string | null {
  const dir = avatarDir();
  try {
    const set = parseFrameNames(readdirSync(dir));
    return set.idle ? `${dir}/${set.idle}` : null;
  } catch {
    return null;
  }
}

export function mosaicForNode(board: Board, node: BoardNode, slot: 'face' | 'logo' = 'face'): MosaicResult {
  const fp = footprintOf(node);
  const tile = board.grid.tile;

  if (slot === 'logo') {
    /*
     * `logoSource: avatar` resolves to the avatar's idle.png and then takes EXACTLY the path a logo
     * file takes: the same dither onto the room's palette, the same tight crop, the same cache
     * (keyed on the file's mtime and size, so a replaced idle.png is re-dithered). docs/02 holds.
     */
    const logo = logoPathFor(node, avatarIdlePath);
    if (!logo.path) return { ok: false, error: logo.reason ?? 'NO LOGO SET' };
    /*
     * The footprint suggests a size; `logoScale` adjusts it; it never exceeds the node's face less
     * the bevel (logoBoxPx, shared with the board's live-face logo so both sit in the same box).
     * The box is a bound on BOTH axes and `tight` fits the picture inside it without padding, so a
     * wide logo comes out wide and a tall one comes out tall — there is no square to letterbox into.
     */
    const box = logoBoxPx(fp, node.logoScale, tile);
    return buildMosaic({
      source: logo.path,
      width: box.width,
      height: box.height,
      theme: board.theme,
      fit: 'tight',
      animate: node.imageAnimate !== false
    });
  }

  if (!node.image) return { ok: false, error: 'NO IMAGE SET' };
  return buildMosaic({
    source: node.image,
    width: Math.max(16, fp.w * tile),
    height: Math.max(16, fp.h * tile),
    theme: board.theme,
    fit: 'fill',
    animate: node.imageAnimate !== false,
    ...(node.rotation ? { rotation: node.rotation } : {})
  });
}

/**
 * The room's tiled background: `look.tileImage`, dithered onto the room's palette exactly the way a
 * backdrop is, so a tiled floor reads as part of the board and not as wallpaper pasted under it.
 *
 * William: "select an image that is a perfect square". A picture that is not square is REFUSED with
 * its size, never cropped or stretched to fit: a crop decides what to throw away, and a stretch
 * distorts every tile of the floor. The renderer falls back to the substrate and says why.
 *
 * The source is decoded once here for its size, and again inside buildMosaic on a cache miss. A
 * floor is loaded when a room opens or its look changes, never per frame, so the second decode is
 * the price of keeping buildMosaic's single, cached path.
 */
export function mosaicForBoardTile(board: Board): MosaicResult {
  const look = resolveLook(board.look);
  if (!look.tileImage) return { ok: false, error: 'NO TILE IMAGE SET' };
  const file = expandPath(look.tileImage);
  if (!file) return { ok: false, error: 'NO TILE IMAGE SET' };
  if (file.includes('..')) return { ok: false, error: `IMAGE PATH CONTAINS ".." — NOT ALLOWED — ${file}` };
  if (!existsSync(file)) return { ok: false, error: `IMAGE NOT FOUND — ${file}` };
  const size = decodeStill(file).getSize();
  const square = squareCheck(size.width, size.height);
  if (!square.ok) return { ok: false, error: square.reason };
  const px = tileSourcePx(square.size);
  // A tiled floor is a still: an animated floor under the whole board would be a screensaver.
  return buildMosaic({ source: look.tileImage, width: px, height: px, theme: board.theme, fit: 'fill', animate: false });
}
