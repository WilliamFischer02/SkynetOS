/**
 * Two hands place the cursor, zoom lands on it, and a click lands where the hand was aimed.
 *
 * William, 2026-09-12: "holding both hands up far apart or close together should be registered as the
 * cursor, and zoom should always happen on where the cursor is … it allows me to place the cursor where on
 * screen and the software zooms into that location." And: "Single click is the only gesture that isn't
 * running as smoothly, the rest are much better."
 *
 * Performed by the same kinematic hand as test/gesture-control.test.ts, at thirty frames a second.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA, FRONTAL, POSES, blendPose, render, type HandPose, type View } from '@shared/hand-synth.js';
import { createControl, type ControlEvent, type GestureControl, type HandObservation } from '@shared/gesture-control.js';
import { handGeometry } from '@shared/hand-geometry.js';
import { EMPTY_LIBRARY } from '@shared/gesture-library.js';

const FRAME = 33;
const DESK: View = { ...FRONTAL, distance: 0.5 };
const OPEN = POSES.openRelaxed;

const see = (pose: HandPose, view: Partial<View> = {}, chirality: 'right' | 'left' = 'right'): HandObservation => {
  const rendered = render(pose, { chirality, view: { ...DESK, ...view }, camera: DEFAULT_CAMERA });
  return { landmarks: rendered.landmarks, world: rendered.world, label: rendered.label };
};

const anchorOf = (hand: HandObservation): { x: number; y: number } => handGeometry({ landmarks: hand.landmarks, world: hand.world ?? null })!.anchor;

/** Run frames of hands; `hands(t)` is given 0 → 1 across the span. */
function play(control: GestureControl, ms: number, hands: (t: number) => HandObservation[], start: number): { events: { at: number; event: ControlEvent }[]; end: number } {
  const events: { at: number; event: ControlEvent }[] = [];
  const count = Math.max(1, Math.round(ms / FRAME));
  let at = start;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 1 : i / (count - 1);
    for (const event of control.push({ hands: hands(t), atMs: at })) events.push({ at, event });
    at += FRAME;
  }
  return { events, end: at };
}

const of = <T extends ControlEvent['type']>(events: { event: ControlEvent }[], type: T): Extract<ControlEvent, { type: T }>[] =>
  events.map((entry) => entry.event).filter((event): event is Extract<ControlEvent, { type: T }> => event.type === type);

/** Two open hands, fingers pointed at each other, centred at `cx`, `gap` metres apart. */
const pointed = (gap: number, cx = 0): HandObservation[] => [
  see(POSES.open, { x: cx - gap / 2, roll: 90 }, 'left'),
  see(POSES.open, { x: cx + gap / 2, roll: -90 }, 'right')
];
/** Two open hands side by side, palms to the camera. */
const sideBySide = (gap: number, cx = 0): HandObservation[] => [
  see(OPEN, { x: cx - gap / 2 }, 'left'),
  see(OPEN, { x: cx + gap / 2 }, 'right')
];
const midpoint = (hands: HandObservation[]): { x: number; y: number } => {
  const [a, b] = hands.map(anchorOf);
  return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
};

describe('two raised hands place the cursor', () => {
  it('between them, when they are turned towards each other', () => {
    const hands = pointed(0.24, 0.06);
    const { events } = play(createControl(EMPTY_LIBRARY), 600, () => hands, 0);
    const last = of(events, 'cursor').at(-1)!;
    const expected = midpoint(hands);
    expect(Math.abs(last.x - expected.x)).toBeLessThan(0.01);
    expect(Math.abs(last.y - expected.y)).toBeLessThan(0.01);
  });

  it('between them, far apart or close together, even palms to the camera — and then without zooming', () => {
    const control = createControl(EMPTY_LIBRARY);
    const { events } = play(control, 900, (t) => sideBySide(0.14 + 0.2 * t, -0.04), 0);
    expect(of(events, 'zoom')).toHaveLength(0);
    const last = of(events, 'cursor').at(-1)!;
    const expected = midpoint(sideBySide(0.34, -0.04));
    expect(Math.abs(last.x - expected.x)).toBeLessThan(0.015);
    expect(control.state().twoHanded).toBe(true);
  });

  it('glides from one hand to the point between two, rather than jumping', () => {
    const control = createControl(EMPTY_LIBRARY);
    const one = play(control, 400, () => [see(OPEN, { x: 0.15 })], 0);
    const from = of(one.events, 'cursor').at(-1)!;
    const both = play(control, 400, () => sideBySide(0.3, 0), one.end);
    const cursors = of(both.events, 'cursor');
    const to = midpoint(sideBySide(0.3, 0));
    const jump = Math.abs(to.x - from.x);
    expect(jump).toBeGreaterThan(0.1);
    let previous = from.x;
    for (const cursor of cursors) {
      expect(Math.abs(cursor.x - previous)).toBeLessThan(jump * 0.5);
      previous = cursor.x;
    }
    expect(Math.abs(cursors.at(-1)!.x - to.x)).toBeLessThan(0.01);
  });
});

describe('zoom lands on the cursor', () => {
  it('every zoom carries the point the two hands placed, and it is where the cursor was drawn', () => {
    const { events } = play(createControl(EMPTY_LIBRARY), 1000, (t) => pointed(0.16 + 0.24 * t, 0.08), 0);
    const zooms = of(events, 'zoom');
    expect(zooms.length).toBeGreaterThanOrEqual(2);
    const flat = events.map((entry) => entry.event);
    for (const zoom of zooms) {
      const index = flat.indexOf(zoom);
      const cursor = flat.slice(0, index).reverse().find((event) => event.type === 'cursor') as { x: number; y: number };
      expect(zoom.x).toBeCloseTo(cursor.x, 6);
      expect(zoom.y).toBeCloseTo(cursor.y, 6);
    }
    // Moving symmetrically apart, the point between the hands stays put, so every zoom is about one place.
    const xs = zooms.map((zoom) => zoom.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.02);
  });
});

describe('a click after two hands placed the cursor', () => {
  it('closing one hand clicks at the point between them, once, and does not drag', () => {
    const control = createControl(EMPTY_LIBRARY);
    const left = see(OPEN, { x: -0.13 }, 'left');
    const rightAt = { x: 0.13 };
    const placed = play(control, 500, () => [left, see(OPEN, rightAt)], 0);
    const aim = of(placed.events, 'cursor').at(-1)!;
    const clicked = play(control, 100, (t) => [left, see(blendPose(OPEN, POSES.fist, t), rightAt)], placed.end);
    const held = play(control, 90, () => [left, see(POSES.fist, rightAt)], clicked.end);
    const released = play(control, 400, (t) => [left, see(blendPose(POSES.fist, OPEN, Math.min(1, t * 4)), rightAt)], held.end);
    const all = [...clicked.events, ...held.events, ...released.events];
    const lefts = of(all, 'click').filter((click) => click.button === 'left');
    expect(lefts).toHaveLength(1);
    expect(of(all, 'dragStart')).toHaveLength(0);
    expect(Math.abs(lefts[0]!.x - aim.x)).toBeLessThan(0.02);
    expect(Math.abs(lefts[0]!.y - aim.y)).toBeLessThan(0.02);
  });
});

describe('the single click, made smoother', () => {
  const aimThenClick = (steps: { ms: number; pose: (t: number) => HandPose; y: (t: number) => number }[]) => {
    const control = createControl(EMPTY_LIBRARY);
    const aimed = play(control, 400, () => [see(OPEN)], 0);
    const aim = of(aimed.events, 'cursor').at(-1)!;
    const events: { at: number; event: ControlEvent }[] = [];
    let at = aimed.end;
    for (const step of steps) {
      const run = play(control, step.ms, (t) => [see(step.pose(t), { y: step.y(t) })], at);
      events.push(...run.events);
      at = run.end;
    }
    return { aim, events };
  };

  it('a quick click with the natural dip of the hand is one click, where he aimed, and not a drag', () => {
    const { aim, events } = aimThenClick([
      { ms: 100, pose: (t) => blendPose(OPEN, POSES.fist, t), y: (t) => 0.02 * t },
      { ms: 66, pose: () => POSES.fist, y: (t) => 0.02 + 0.015 * t },
      { ms: 100, pose: (t) => blendPose(POSES.fist, OPEN, t), y: (t) => 0.035 - 0.015 * t },
      { ms: 300, pose: () => OPEN, y: () => 0.02 }
    ]);
    const lefts = of(events, 'click').filter((click) => click.button === 'left');
    expect(lefts).toHaveLength(1);
    expect(of(events, 'dragStart')).toHaveLength(0);
    expect(Math.abs(lefts[0]!.x - aim.x)).toBeLessThan(0.012);
    expect(Math.abs(lefts[0]!.y - aim.y)).toBeLessThan(0.012);
  });

  it('a very quick click — a single frame closed — still clicks', () => {
    const { events } = aimThenClick([
      { ms: 66, pose: (t) => blendPose(OPEN, POSES.fist, t), y: () => 0 },
      { ms: 33, pose: () => POSES.fist, y: () => 0 },
      { ms: 66, pose: (t) => blendPose(POSES.fist, OPEN, t), y: () => 0 },
      { ms: 300, pose: () => OPEN, y: () => 0 }
    ]);
    expect(of(events, 'click').filter((click) => click.button === 'left')).toHaveLength(1);
    expect(of(events, 'dragStart')).toHaveLength(0);
  });

  it('after the click the cursor glides back to the hand rather than jumping', () => {
    const { events } = aimThenClick([
      { ms: 100, pose: (t) => blendPose(OPEN, POSES.fist, t), y: (t) => 0.03 * t },
      { ms: 66, pose: () => POSES.fist, y: () => 0.03 },
      { ms: 100, pose: (t) => blendPose(POSES.fist, OPEN, t), y: () => 0.03 },
      { ms: 400, pose: () => OPEN, y: () => 0.03 }
    ]);
    const flat = events.map((entry) => entry.event);
    const clickIndex = flat.findIndex((event) => event.type === 'click');
    expect(clickIndex).toBeGreaterThanOrEqual(0);
    const click = flat[clickIndex] as { y: number };
    const after = flat.slice(clickIndex).filter((event): event is Extract<ControlEvent, { type: 'cursor' }> => event.type === 'cursor');
    const total = Math.abs(after.at(-1)!.y - click.y);
    let previous = click.y;
    for (const cursor of after) {
      expect(Math.abs(cursor.y - previous)).toBeLessThan(Math.max(0.01, total * 0.6));
      previous = cursor.y;
    }
  });
});
