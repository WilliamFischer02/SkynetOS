import { describe, expect, it } from 'vitest';
import {
  PAN_MARGIN,
  PAN_MAX_SPEED,
  PAN_MIN_SPEED,
  PAN_RAMP_FRAMES,
  TILE,
  ZOOM_LEVELS,
  boardPixelSize,
  clampCamera,
  fitZoom,
  formatZoom,
  isZoom,
  panSpeed,
  screenToWorld,
  setZoom,
  stagePosition,
  stepCamera,
  stepZoom,
  type Camera,
  worldToTile
} from '../src/renderer/board/camera.js';

const view = { width: 1600, height: 1000 };
const board = boardPixelSize({ width: 64, height: 40 }); // the real root board: 1024x640 px

describe('zoom', () => {
  it('offers whole numbers for working and exact binary fractions for overview', () => {
    expect(ZOOM_LEVELS).toEqual([0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const z of ZOOM_LEVELS) {
      if (z >= 1) expect(Number.isInteger(z)).toBe(true);
      // A power-of-two fraction: 1/z is a whole power of two, so the scale is exact in floating point.
      else expect(Math.log2(1 / z) % 1).toBe(0);
    }
  });

  it('rejects arbitrary fractions and out-of-range zooms', () => {
    expect(isZoom(2.5)).toBe(false);
    expect(isZoom(0.75)).toBe(false);
    expect(isZoom(1.5)).toBe(false);
    expect(isZoom(0.0625)).toBe(false);
    expect(isZoom(9)).toBe(false);
    expect(isZoom(0.125)).toBe(true);
    expect(isZoom(5)).toBe(true);
    expect(isZoom(8)).toBe(true);
    expect(isZoom(1)).toBe(true);
    expect(isZoom(0.5)).toBe(true);
  });

  it('saturates at the ends instead of wrapping', () => {
    expect(stepZoom(8, 1)).toBe(8);
    expect(stepZoom(0.125, -1)).toBe(0.125);
    expect(stepZoom(4, 1)).toBe(5);
    expect(stepZoom(0.25, -1)).toBe(0.125);
    expect(stepZoom(3, 1)).toBe(4);
    expect(stepZoom(2, -1)).toBe(1);
    expect(stepZoom(1, -1)).toBe(0.5);
  });

  it('can show a whole tripled board on an ordinary screen', () => {
    // William: "I want to be able to see the whole board from far away." The tripled root board is
    // 192x120 tiles; the old floor of 2x showed under a third of its width in a 1920 window.
    const tripled = boardPixelSize({ width: 192, height: 120 });
    const screen = { width: 1920, height: 1080 };
    const zoom = fitZoom(tripled, screen);
    expect(tripled.width * zoom).toBeLessThanOrEqual(screen.width);
    expect(tripled.height * zoom).toBeLessThanOrEqual(screen.height);
    expect(zoom).toBe(0.5);
  });

  it('fits at the closest level that works, not the smallest', () => {
    expect(fitZoom({ width: 400, height: 200 }, view)).toBe(4);
    expect(fitZoom(boardPixelSize({ width: 64, height: 40 }), view)).toBe(1);
  });

  it('falls back on the smallest level for a board nothing fits', () => {
    expect(fitZoom(boardPixelSize({ width: 512, height: 512 }), { width: 800, height: 600 })).toBe(0.125);
  });

  it('prints fractions as fractions', () => {
    expect(formatZoom(8)).toBe('8X');
    expect(formatZoom(3)).toBe('3X');
    expect(formatZoom(1)).toBe('1X');
    expect(formatZoom(0.5)).toBe('1/2X');
    expect(formatZoom(0.25)).toBe('1/4X');
    expect(formatZoom(0.125)).toBe('1/8X');
  });

  it('keeps the anchor point over the same world position', () => {
    const cam: Camera = { x: 100, y: 60, zoom: 2 };
    const anchor = { x: 800, y: 500 };
    const before = screenToWorld(cam, anchor.x, anchor.y);
    const after = screenToWorld(setZoom(cam, 4, view, anchor), anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });
});

describe('stagePosition — the anti-mush guarantee', () => {
  it('is always a whole number of device pixels, for any camera position', () => {
    for (const zoom of ZOOM_LEVELS) {
      for (let i = 0; i < 500; i++) {
        const cam: Camera = { x: Math.random() * 4000 - 2000, y: Math.random() * 4000 - 2000, zoom };
        const pos = stagePosition(cam);
        expect(Number.isInteger(pos.x)).toBe(true);
        expect(Number.isInteger(pos.y)).toBe(true);
      }
    }
  });

  it('rounds AFTER scaling, not before', () => {
    // world x 10.4 at zoom 3 is 31.2 device px -> 31. Rounding first would give 10 -> 30,
    // a whole third of a tile of drift and a visible stutter while panning.
    expect(stagePosition({ x: 10.4, y: 0, zoom: 3 }).x).toBe(-31);
    expect(stagePosition({ x: 10.4, y: 0, zoom: 3 }).x).not.toBe(-30);
  });

  it('samples the same texels every frame below 1x, wherever the camera is', () => {
    /*
     * The one thing that could make the overview levels shimmer. Each screen pixel's left edge maps
     * to world (s - stage) / zoom. If that ever landed on a different multiple of 1/zoom, the
     * nearest-neighbour sample would pick a different texel from one frame to the next, and a pan
     * would crawl. A whole-pixel stage and a power-of-two scale keep it on the same phase.
     */
    for (const zoom of ZOOM_LEVELS.filter((z) => z < 1)) {
      const step = 1 / zoom;
      for (let i = 0; i < 300; i++) {
        const pos = stagePosition({ x: Math.random() * 6000 - 3000, y: Math.random() * 6000 - 3000, zoom });
        for (const s of [0, 1, 7, 333]) {
          // abs: a negative multiple leaves -0, which is the same phase and fails Object.is(0).
          expect(Math.abs(((s - pos.x) / zoom) % step), `x at 1/${step}`).toBe(0);
          expect(Math.abs(((s - pos.y) / zoom) % step), `y at 1/${step}`).toBe(0);
        }
      }
    }
  });

  it('moves by at most one device pixel per sub-pixel camera step', () => {
    let previous = stagePosition({ x: 0, y: 0, zoom: 4 }).x;
    for (let i = 1; i <= 200; i++) {
      const current = stagePosition({ x: i * 0.1, y: 0, zoom: 4 }).x;
      expect(Math.abs(current - previous)).toBeLessThanOrEqual(1);
      previous = current;
    }
  });
});

describe('pan', () => {
  it('ramps from the minimum to the maximum speed and stops there', () => {
    expect(panSpeed(0)).toBe(PAN_MIN_SPEED);
    expect(panSpeed(PAN_RAMP_FRAMES)).toBe(PAN_MAX_SPEED);
    expect(panSpeed(PAN_RAMP_FRAMES * 10)).toBe(PAN_MAX_SPEED);
    expect(panSpeed(-5)).toBe(PAN_MIN_SPEED);
  });

  it('ramps monotonically', () => {
    for (let f = 1; f <= PAN_RAMP_FRAMES; f++) {
      expect(panSpeed(f)).toBeGreaterThanOrEqual(panSpeed(f - 1));
    }
  });

  it('does not make diagonal panning faster than orthogonal', () => {
    const small = { width: 4000, height: 4000 };
    const start: Camera = { x: 500, y: 500, zoom: 2 };
    const right = stepCamera(start, { left: false, right: true, up: false, down: false, heldFrames: 99 }, small, view);
    const diag = stepCamera(start, { left: false, right: true, up: false, down: true, heldFrames: 99 }, small, view);

    const orthogonal = Math.hypot(right.x - start.x, right.y - start.y);
    const diagonal = Math.hypot(diag.x - start.x, diag.y - start.y);
    expect(diagonal).toBeCloseTo(orthogonal, 10);
  });

  it('is a no-op when no direction is held', () => {
    const cam: Camera = { x: 120, y: 80, zoom: 3 };
    const next = stepCamera(cam, { left: false, right: false, up: false, down: false, heldFrames: 40 }, { width: 4000, height: 4000 }, view);
    expect(next).toEqual(cam);
  });

  it('covers the same screen distance per frame at every zoom', () => {
    const big = { width: 20000, height: 20000 };
    const input = { left: false, right: true, up: false, down: false, heldFrames: 99 };
    const screenDistances = ZOOM_LEVELS.map((zoom) => {
      const start: Camera = { x: 1000, y: 1000, zoom };
      const next = stepCamera(start, input, big, view);
      return (next.x - start.x) * zoom;
    });
    for (const d of screenDistances) expect(d).toBeCloseTo(PAN_MAX_SPEED, 10);
  });
});

describe('clampCamera', () => {
  const bigBoard = { width: 8000, height: 8000 };

  /**
   * ── What the margin is FOR ────────────────────────────────────────────────────────────────
   *
   * The clamp used to pin the board's edge to the viewport's exactly, so a component near an edge
   * could not be brought to the middle of the screen to work on — and with the inspector open, a
   * node on the right edge could not be brought out from under it at all.
   *
   * PAN_MARGIN was eight tiles, and eight tiles never actually delivered that. Bringing a node in
   * the board's CORNER to the centre of the screen needs the camera at minus half a viewport —
   * 400 world px here, 60 tiles at zoom 2 on a wide monitor. The old margin was 128.
   *
   * So these test the promise rather than the number: every corner of the board can be brought to
   * the centre of the screen, and not one pixel further.
   */
  const centreOn = (x: number, y: number, zoom: Camera['zoom']): Camera =>
    ({ x: x - view.width / zoom / 2, y: y - view.height / zoom / 2, zoom });

  it.each([
    ['top-left', 0, 0],
    ['top-right', bigBoard.width, 0],
    ['bottom-left', 0, bigBoard.height],
    ['bottom-right', bigBoard.width, bigBoard.height]
  ])('can bring the %s corner of the board to the centre of the screen', (_corner, x, y) => {
    // Only where the board is bigger than the view. A board that fits is centred instead; see below.
    const panning = ZOOM_LEVELS.filter((z) => bigBoard.width > view.width / z && bigBoard.height > view.height / z);
    expect(panning.length).toBeGreaterThan(0);
    for (const zoom of panning) {
      const wanted = centreOn(x, y, zoom);
      const got = clampCamera(wanted, bigBoard, view);
      expect(got.x, `x at ${zoom}x`).toBeCloseTo(wanted.x, 6);
      expect(got.y, `y at ${zoom}x`).toBeCloseTo(wanted.y, 6);
    }
  });

  it('centres a board that fits in the view, at 1/8 even an 8000 px one', () => {
    // 1600 px of screen at 1/8 shows 12800 world px, so the whole board fits and sits in the middle.
    const got = clampCamera({ x: -99999, y: 99999, zoom: 0.125 }, bigBoard, view);
    expect(got.x).toBeCloseTo((bigBoard.width - view.width / 0.125) / 2, 6);
    expect(got.y).toBeCloseTo((bigBoard.height - view.height / 0.125) / 2, 6);
  });

  it('still refuses to let the board leave the screen entirely', () => {
    /*
     * Slack, not freedom. Half a viewport is the exact amount that makes the promise above true,
     * and it is self-limiting: at the extreme the board's edge sits at the middle of the screen,
     * so half the view is always still board.
     */
    for (const zoom of ZOOM_LEVELS) {
      const visibleW = view.width / zoom;
      const visibleH = view.height / zoom;
      const clamped = clampCamera({ x: -999999, y: -999999, zoom }, bigBoard, view);

      // Pushed as far off the board as the clamp allows, most of the screen is still board.
      const boardOnScreenX = (clamped.x + visibleW) / visibleW;
      const boardOnScreenY = (clamped.y + visibleH) / visibleH;
      expect(boardOnScreenX, `x at ${zoom}x`).toBeGreaterThanOrEqual(0.45);
      expect(boardOnScreenY, `y at ${zoom}x`).toBeGreaterThanOrEqual(0.45);
    }
  });

  it('never allows less slack than the old fixed margin', () => {
    // PAN_MARGIN survives as a floor for a window too small for half of it to be eight tiles.
    const cramped = { width: 100, height: 80 };
    const clamped = clampCamera({ x: -999999, y: -999999, zoom: 4 }, bigBoard, cramped);
    expect(clamped.x).toBe(-PAN_MARGIN);
    expect(clamped.y).toBe(-PAN_MARGIN);
  });

  it('centres a board smaller than the viewport instead of pinning it to the corner', () => {
    // The root board is 1024x640; at zoom 3 the viewport shows 533x333 world px, so the board
    // is larger. At zoom 1-equivalent framing it would be smaller — force that case directly.
    const tiny = { width: 200, height: 100 };
    const clamped = clampCamera({ x: 0, y: 0, zoom: 2 }, tiny, view);
    expect(clamped.x).toBe((tiny.width - view.width / 2) / 2);
    expect(clamped.y).toBe((tiny.height - view.height / 2) / 2);
  });

  it('preserves zoom', () => {
    expect(clampCamera({ x: 0, y: 0, zoom: 4 }, board, view).zoom).toBe(4);
  });
});

describe('grid', () => {
  it('converts the root board grid to pixels at 16px per tile', () => {
    expect(TILE).toBe(16);
    expect(board).toEqual({ width: 1024, height: 640 });
  });

  it('maps world pixels back to the containing tile', () => {
    expect(worldToTile(0, 0)).toEqual({ x: 0, y: 0 });
    expect(worldToTile(15.9, 15.9)).toEqual({ x: 0, y: 0 });
    expect(worldToTile(16, 32)).toEqual({ x: 1, y: 2 });
  });
});
