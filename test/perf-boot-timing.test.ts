import { beforeEach, describe, expect, it } from 'vitest';
import { bootMark, bootStart, bootTiming, resetBootTiming } from '../src/main/services/boot-timing.js';

describe('boot timing', () => {
  beforeEach(() => resetBootTiming());

  it('records nothing before boot starts', () => {
    bootMark('too-early');
    expect(bootTiming().marks).toEqual([]);
  });

  it('measures every mark from ready and names the slowest step first', async () => {
    bootStart();
    bootMark('fast');
    await new Promise((r) => setTimeout(r, 30));
    bootMark('slow');
    bootMark('fast-again');
    const timing = bootTiming();
    expect(timing.marks.map((m) => m.name)).toEqual(['ready', 'fast', 'slow', 'fast-again']);
    expect(timing.marks[0]!.sinceStart).toBe(0);
    expect(timing.slowest[0]).toMatchObject({ from: 'fast', to: 'slow' });
    expect(timing.slowest[0]!.ms).toBeGreaterThanOrEqual(25);
    expect(timing.processToReady).toBeGreaterThan(0);
  });
});
