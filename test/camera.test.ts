import { describe, expect, it } from 'vitest';
import {
  type Camera,
  PAN_MAX_SPEED,
  PAN_MIN_SPEED,
  PAN_RAMP_FRAMES,
  TILE,
  ZOOM_LEVELS,
  boardPixelSize,
  clampCamera,
  isZoom,
  panSpeed,
  screenToWorld,
  setZoom,
  stagePosition,
  stepCamera,
  stepZoom,
  worldToTile
} from '../src/renderer/board/camera.js';

const view = { width: 1600, height: 1000 };
const board = boardPixelSize({ width: 64, height: 40 }); // the real root board: 1024x640 px

describe('zoom', () => {
  it('offers integer levels only', () => {
    expect(ZOOM_LEVELS).toEqual([2, 3, 4]);
    for (const z of ZOOM_LEVELS) expect(Number.isInteger(z)).toBe(true);
  });

  it('rejects fractional and out-of-range zooms', () => {
    expect(isZoom(2.5)).toBe(false);
    expect(isZoom(1)).toBe(false);
    expect(isZoom(5)).toBe(false);
    expect(isZoom(3)).toBe(true);
  });

  it('saturates at the ends instead of wrapping', () => {
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(2, -1)).toBe(2);
    expect(stepZoom(3, 1)).toBe(4);
    expect(stepZoom(3, -1)).toBe(2);
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
  it('keeps the viewport inside a board larger than the screen', () => {
    const bigBoard = { width: 8000, height: 8000 };
    const clamped = clampCamera({ x: -500, y: 99999, zoom: 2 }, bigBoard, view);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(bigBoard.height - view.height / 2);
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
