import { describe, expect, it } from 'vitest';
import {
  GESTURE_PAN_SETTLE_MS,
  GLIDE_MS,
  MOUSE_PAN_SETTLE_MS,
  PARALLAX,
  SETTLE_TOLERANCE,
  ZOOM_SETTLE_MS,
  applyGlide,
  initialMotion,
  omegaForSettle,
  parallaxOffset,
  renderPlan,
  snapMotion,
  startGlide,
  stepMotion,
  stepSpring
} from '../src/renderer/board/motion.js';
import { ZOOM_LEVELS, stagePosition, type Camera } from '../src/renderer/board/camera.js';

const centre = { ax: 800, ay: 500 };

describe('the spring', () => {
  it('settles to within half a percent inside its settle time, from rest', () => {
    for (const settle of [MOUSE_PAN_SETTLE_MS, ZOOM_SETTLE_MS, GESTURE_PAN_SETTLE_MS]) {
      const omega = omegaForSettle(settle);
      let s = { x: 0, v: 0 };
      let t = 0;
      while (t < settle) { s = stepSpring(s, 100, omega, 1000 / 60); t += 1000 / 60; }
      expect(Math.abs(s.x - 100)).toBeLessThan(100 * SETTLE_TOLERANCE + 1e-9);
    }
  });

  it('never overshoots from rest', () => {
    const omega = omegaForSettle(ZOOM_SETTLE_MS);
    let s = { x: 2, v: 0 };
    for (let i = 0; i < 120; i++) {
      s = stepSpring(s, 3, omega, 1000 / 60);
      expect(s.x).toBeLessThanOrEqual(3 + 1e-12);
      expect(s.x).toBeGreaterThanOrEqual(2);
    }
  });

  it('is frame-rate independent: 30, 60 and 240 Hz land in the same place', () => {
    const omega = omegaForSettle(MOUSE_PAN_SETTLE_MS);
    const run = (hz: number): number => {
      let s = { x: 0, v: 0 };
      const steps = Math.round(0.1 * hz);
      for (let i = 0; i < steps; i++) s = stepSpring(s, 50, omega, 1000 / hz);
      return s.x;
    };
    const a = run(30);
    const b = run(60);
    const c = run(240);
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
    expect(Math.abs(b - c)).toBeLessThan(1e-9);
  });

  it('solves the settle time it was asked for', () => {
    const omega = omegaForSettle(160);
    const u = omega * 0.16;
    expect(Math.exp(-u) * (1 + u)).toBeCloseTo(SETTLE_TOLERANCE, 6);
  });
});

describe('stepMotion', () => {
  it('does nothing, and says so, when the shown camera is already on the target', () => {
    const m = initialMotion({ x: 100, y: 50, zoom: 3 });
    let moves = 0;
    for (let i = 0; i < 100; i++) {
      const r = stepMotion(m, { x: 100, y: 50, zoom: 3 }, 16.7, centre);
      if (r.moving) moves++;
      expect(r.shown).toEqual({ x: 100, y: 50, zoom: 3 });
    }
    expect(moves).toBe(0);
  });

  it('eases a pan and settles exactly on the target within the mouse settle time', () => {
    const m = initialMotion({ x: 0, y: 0, zoom: 2 });
    const target = { x: 300, y: -40, zoom: 2 as const };
    let t = 0;
    let last = stepMotion(m, target, 16.7, centre);
    // Within half a percent by the settle time; exactly on the target (and idle) shortly after.
    while (t < MOUSE_PAN_SETTLE_MS) { last = stepMotion(m, target, 16.7, centre); t += 16.7; }
    expect(Math.abs(last.shown.x - 300)).toBeLessThan(300 * SETTLE_TOLERANCE);
    while (t < 2 * MOUSE_PAN_SETTLE_MS + 40) { last = stepMotion(m, target, 16.7, centre); t += 16.7; }
    expect(last.shown.x).toBe(300);
    expect(last.shown.y).toBe(-40);
    // And once settled, it idles.
    expect(stepMotion(m, target, 16.7, centre).moving).toBe(false);
  });

  it('keeps the world point under the anchor fixed through the whole zoom tween', () => {
    const m = initialMotion({ x: 100, y: 60, zoom: 2 });
    const anchor = { ax: 400, ay: 300 };
    // setZoom's arithmetic: the same world point under the anchor at the new zoom.
    const worldX = 100 + anchor.ax / 2;
    const worldY = 60 + anchor.ay / 2;
    const target = { x: worldX - anchor.ax / 3, y: worldY - anchor.ay / 3, zoom: 3 as const };
    for (let i = 0; i < 30; i++) {
      const r = stepMotion(m, target, 1000 / 60, anchor);
      expect(r.shown.x + anchor.ax / r.shown.zoom).toBeCloseTo(worldX, 9);
      expect(r.shown.y + anchor.ay / r.shown.zoom).toBeCloseTo(worldY, 9);
      expect(r.shown.zoom).toBeGreaterThanOrEqual(2);
      expect(r.shown.zoom).toBeLessThanOrEqual(3);
    }
    expect(m.zoom.x).toBe(3);
    expect(m.x.x).toBe(target.x);
    expect(m.anchor).toBeNull();
  });

  it('snaps to the exact level, never a fraction, when the zoom settles', () => {
    const m = initialMotion({ x: 0, y: 0, zoom: 1 });
    const target = { x: 0, y: 0, zoom: 4 as const };
    let settled = false;
    for (let i = 0; i < 60 && !settled; i++) {
      const r = stepMotion(m, target, 16, centre);
      settled = !m.anchor;
      if (settled) expect(r.shown.zoom).toBe(4);
    }
    expect(settled).toBe(true);
  });

  it('snapMotion puts the shown camera on the target at once', () => {
    const m = initialMotion({ x: 0, y: 0, zoom: 1 });
    stepMotion(m, { x: 500, y: 500, zoom: 1 }, 16, centre);
    snapMotion(m, { x: 500, y: 500, zoom: 1 });
    expect(stepMotion(m, { x: 500, y: 500, zoom: 1 }, 16, centre)).toEqual({ shown: { x: 500, y: 500, zoom: 1 }, moving: false });
  });
});

describe('the glide', () => {
  it('carries the target on after a release and dies inside GLIDE_MS', () => {
    const m = initialMotion({ x: 0, y: 0, zoom: 2 });
    startGlide(m, 1200, 0);
    let target: Camera = { x: 0, y: 0, zoom: 2 };
    let t = 0;
    let lastX = 0;
    while (m.glide && t < 1000) {
      target = applyGlide(m, target, 1000 / 60);
      expect(target.x).toBeGreaterThanOrEqual(lastX); // monotonic: no reversal
      lastX = target.x;
      t += 1000 / 60;
    }
    expect(m.glide).toBeNull();
    expect(t).toBeLessThanOrEqual(GLIDE_MS + 1000 / 60);
    expect(target.x).toBeGreaterThan(50);
    expect(target.x).toBeLessThan(1200 * GLIDE_MS / 1000); // less than free travel at full speed
  });

  it('ignores a release that was not moving', () => {
    const m = initialMotion({ x: 0, y: 0, zoom: 2 });
    startGlide(m, 0.5, 0.5);
    expect(m.glide).toBeNull();
    expect(applyGlide(m, { x: 1, y: 2, zoom: 2 }, 16)).toEqual({ x: 1, y: 2, zoom: 2 });
  });
});

describe('renderPlan', () => {
  it('renders at the level below and scales up, so the canvas always covers the viewport', () => {
    expect(renderPlan(2)).toEqual({ level: 2, scale: 1 });
    expect(renderPlan(2.5)).toEqual({ level: 2, scale: 1.25 });
    expect(renderPlan(0.3).level).toBe(0.25);
    expect(renderPlan(0.3).scale).toBeCloseTo(1.2, 9);
    expect(renderPlan(11.9).level).toBe(10);
    for (const z of ZOOM_LEVELS) expect(renderPlan(z)).toEqual({ level: z, scale: 1 });
  });

  it('never asks for a scale below one or a level outside the list', () => {
    for (let z = 0.05; z < 14; z += 0.07) {
      const p = renderPlan(z);
      expect(p.scale).toBeGreaterThanOrEqual(1);
      expect(ZOOM_LEVELS).toContain(p.level);
    }
  });
});

describe('parallax', () => {
  it('lands every layer on a whole device pixel at every zoom', () => {
    for (const zoom of ZOOM_LEVELS) {
      for (let cam = -1234.567; cam < 4000; cam += 97.31) {
        for (const factor of [PARALLAX.substrate, PARALLAX.parts]) {
          const off = parallaxOffset(cam, zoom, factor);
          const stage = stagePosition({ x: cam, y: 0, zoom });
          const screen = stage.x + off * zoom;
          expect(Math.abs(screen - Math.round(screen))).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('moves the substrate slower than the camera, and the parts slower still than the components', () => {
    const cam = 1000;
    const sub = parallaxOffset(cam, 2, PARALLAX.substrate);
    const parts = parallaxOffset(cam, 2, PARALLAX.parts);
    expect(sub).toBeGreaterThan(parts);
    expect(parts).toBeGreaterThan(0);
    expect(parallaxOffset(cam, 2, 1)).toBe(0);
  });
});
