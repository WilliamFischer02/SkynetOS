import { describe, expect, it } from 'vitest';
import {
  LEVEL_TOLERANCE,
  boundsOf,
  calibrationState,
  levelAdvice,
  reachVerdict,
  sanitiseCalibration,
  type CalibrationProfile,
  type HandObservation
} from '../packages/shared/calibration.js';

const at = (x: number, y: number, span = 0.2, camera = 'C922'): HandObservation => ({ camera, x, y, span });
const reference = at(0.5, 0.5, 0.2, 'C920');

describe('levelAdvice', () => {
  it('says nothing when the two cameras already agree', () => {
    const advice = levelAdvice(reference, at(0.52, 0.47));
    expect(advice.ok).toBe(true);
    expect(advice.notes).toEqual([]);
  });

  it('aims a camera DOWN when it sees the hand too low', () => {
    // It sees the hand below where the reference does, which means it is pointed too high.
    const advice = levelAdvice(reference, at(0.5, 0.74));
    expect(advice.ok).toBe(false);
    expect(advice.dy).toBeCloseTo(0.24, 5);
    expect(advice.notes[0]).toMatch(/^AIM C922 DOWN/);
  });

  it('aims a camera UP when it sees the hand too high', () => {
    expect(levelAdvice(reference, at(0.5, 0.2)).notes[0]).toMatch(/^AIM C922 UP/);
  });

  it('scales the wording with the size of the error', () => {
    expect(levelAdvice(reference, at(0.5, 0.6)).notes[0]).toContain('a touch');
    expect(levelAdvice(reference, at(0.5, 0.7)).notes[0]).toContain('a little');
    expect(levelAdvice(reference, at(0.5, 0.95)).notes[0]).toContain('a lot');
  });

  it('turns a camera towards the middle', () => {
    expect(levelAdvice(reference, at(0.85, 0.5)).notes[0]).toMatch(/^TURN C922 RIGHT/);
    expect(levelAdvice(reference, at(0.15, 0.5)).notes[0]).toMatch(/^TURN C922 LEFT/);
  });

  it('notices a camera at the wrong distance', () => {
    expect(levelAdvice(reference, at(0.5, 0.5, 0.1)).notes.join(' ')).toMatch(/FURTHER AWAY/);
    expect(levelAdvice(reference, at(0.5, 0.5, 0.4)).notes.join(' ')).toMatch(/CLOSER THAN THE OTHER/);
    expect(levelAdvice(reference, at(0.5, 0.5, 0.22)).ok).toBe(true);
  });

  it('reports the raw numbers as well as the words', () => {
    const advice = levelAdvice(reference, at(0.7, 0.6, 0.25));
    expect(advice.dx).toBeCloseTo(0.2, 5);
    expect(advice.dy).toBeCloseTo(0.1, 5);
    expect(advice.spanRatio).toBeCloseTo(1.25, 5);
    expect(LEVEL_TOLERANCE.dy).toBeLessThan(0.1);
  });
});

describe('boundsOf', () => {
  it('finds the box a reach filled', () => {
    expect(boundsOf([{ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.2 }, { x: 0.5, y: 0.8 }])).toEqual({
      minX: 0.3, maxX: 0.7, minY: 0.2, maxY: 0.8
    });
  });

  it('is null for nothing, rather than an empty box at the origin', () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe('reachVerdict', () => {
  it('turns a comfortable reach into the pointer mapping', () => {
    const verdict = reachVerdict({ minX: 0.2, maxX: 0.8, minY: 0.25, maxY: 0.75 });
    expect(verdict.ok).toBe(true);
    expect(verdict.clipped).toEqual([]);
    expect(verdict.region.x0).toBeCloseTo(0.21, 5);
    expect(verdict.region.x1).toBeCloseTo(0.79, 5);
    expect(verdict.region.y0).toBeCloseTo(0.26, 5);
    expect(verdict.region.y1).toBeCloseTo(0.74, 5);
  });

  it('names the edges the hand ran off, because that fix is physical', () => {
    const verdict = reachVerdict({ minX: 0.01, maxX: 0.99, minY: 0.02, maxY: 0.6 });
    expect(verdict.ok).toBe(false);
    expect(verdict.clipped).toEqual(['left', 'right', 'top']);
    expect(verdict.notes[0]).toMatch(/RUNS OFF THE LEFT AND RIGHT AND TOP/);
    expect(verdict.notes[0]).toMatch(/move the camera back/);
  });

  it('warns when the area is so small that a twitch crosses the screen', () => {
    const verdict = reachVerdict({ minX: 0.45, maxX: 0.55, minY: 0.45, maxY: 0.55 });
    expect(verdict.ok).toBe(false);
    expect(verdict.notes.join(' ')).toMatch(/VERY SMALL AREA/);
  });

  it('falls back to a usable region when nothing was recorded, and says so', () => {
    const verdict = reachVerdict(null);
    expect(verdict.ok).toBe(false);
    expect(verdict.notes[0]).toMatch(/NO REACH RECORDED/);
    expect(verdict.region).toEqual({ x0: 0.18, x1: 0.82, y0: 0.15, y1: 0.85 });
  });

  it('never produces an inverted or microscopic mapping', () => {
    // A recording where the hand barely moved must not invert the pointer or divide by nothing.
    const verdict = reachVerdict({ minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5 });
    expect(verdict.region.x1).toBeGreaterThan(verdict.region.x0);
    expect(verdict.region.y1).toBeGreaterThan(verdict.region.y0);
  });
});

describe('calibrationState', () => {
  const now = new Date('2026-09-12T00:00:00.000Z');
  const profile = (capturedAt: string, labels: string[]): CalibrationProfile => ({
    version: 1,
    capturedAt,
    driver: labels[0] ?? 'C920',
    cameras: labels.map((label) => ({ label, region: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 } }))
  });

  it('reports no calibration at all', () => {
    expect(calibrationState(null, ['C920'], now).state).toBe('none');
  });

  it('reports a fresh one as ready, with how long ago', () => {
    const result = calibrationState(profile('2026-09-11T20:00:00.000Z', ['C920', 'C922']), ['C920', 'C922'], now);
    expect(result.state).toBe('ready');
    expect(result.note).toMatch(/4 hours ago/);
  });

  it('reports a stale one', () => {
    expect(calibrationState(profile('2026-01-01T00:00:00.000Z', ['C920']), ['C920'], now).state).toBe('stale');
  });

  it('notices the cameras on the desk are not the ones it was made with', () => {
    // The likeliest reason a working rig stops working, and invisible until something is measured.
    const result = calibrationState(profile('2026-09-11T22:00:00.000Z', ['C920', 'C922']), ['C920', 'BRIO'], now);
    expect(result.state).toBe('cameras-changed');
    expect(result.note).toMatch(/BRIO/);
  });

  it('treats an unreadable date as stale rather than as fresh', () => {
    expect(calibrationState(profile('not a date', ['C920']), ['C920'], now).state).toBe('stale');
  });
});

describe('sanitiseCalibration', () => {
  it('keeps a good profile', () => {
    const clean = sanitiseCalibration({
      version: 1,
      capturedAt: '2026-09-11T22:00:00.000Z',
      driver: 'C922',
      cameras: [
        { label: 'C920', region: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 } },
        { label: 'C922', region: { x0: 0.1, x1: 0.9, y0: 0.1, y1: 0.9 } }
      ]
    });
    expect(clean?.cameras).toHaveLength(2);
    expect(clean?.driver).toBe('C922');
  });

  it('drops a region that would run the pointer backwards', () => {
    const clean = sanitiseCalibration({
      version: 1,
      capturedAt: '2026-09-11T22:00:00.000Z',
      cameras: [{ label: 'C920', region: { x0: 0.9, x1: 0.1, y0: 0.2, y1: 0.8 } }]
    });
    expect(clean).toBeNull();
  });

  it('falls back to the first camera when the named driver is not among them', () => {
    const clean = sanitiseCalibration({
      version: 1,
      capturedAt: '2026-09-11T22:00:00.000Z',
      driver: 'GONE',
      cameras: [{ label: 'C920', region: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 } }]
    });
    expect(clean?.driver).toBe('C920');
  });

  it('refuses another version, or anything that is not a profile', () => {
    expect(sanitiseCalibration({ version: 2, capturedAt: 'x', cameras: [] })).toBeNull();
    expect(sanitiseCalibration(null)).toBeNull();
    expect(sanitiseCalibration({ version: 1, capturedAt: 'x', cameras: [] })).toBeNull();
  });
});
