import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_LIVE_LOGO,
  LOGO_SOURCES,
  LOGO_SOURCE_LABELS,
  isLiveAvatarLogo,
  logoBoxPx,
  logoCacheSource,
  logoPathFor,
  logoSourceOf
} from '../packages/shared/logo-source.js';
import { DEFAULT_TIMING, liveLogoLayout, wobbleOffset } from '../packages/shared/avatar.js';

const idle = (): string => 'C:/dev/SkynetOS/assets/avatar/jarvis/idle.png';

describe('logoSource: avatar-live', () => {
  it('is a real value with a label, alongside the still face', () => {
    expect(LOGO_SOURCES).toContain('avatar-live');
    expect(LOGO_SOURCE_LABELS['avatar-live']).toBe('JARVIS face (animated)');
    expect(LOGO_SOURCE_LABELS.avatar).toBe('JARVIS face (still)');
    for (const s of LOGO_SOURCES) expect(LOGO_SOURCE_LABELS[s]).toBeTruthy();
    expect(logoSourceOf({ logoSource: 'avatar-live' })).toBe('avatar-live');
  });

  it('bakes nothing: the mosaic is told the board draws it, and the renderer fetches nothing', () => {
    expect(logoPathFor({ logoSource: 'avatar-live' }, idle)).toEqual({ path: null, reason: AVATAR_LIVE_LOGO });
    expect(logoCacheSource({ logoSource: 'avatar-live' }, 3)).toBeUndefined();
  });

  it('is on only while Show logo is on', () => {
    expect(isLiveAvatarLogo({ logoSource: 'avatar-live' })).toBe(true);
    expect(isLiveAvatarLogo({ logoSource: 'avatar-live', showLogo: false })).toBe(false);
    expect(isLiveAvatarLogo({ logoSource: 'avatar' })).toBe(false);
    expect(isLiveAvatarLogo({})).toBe(false);
  });

  it('agrees with the schema, value for value', () => {
    const schema = JSON.parse(readFileSync(join(__dirname, '..', 'schema', 'board.schema.json'), 'utf8')) as {
      $defs: { node: { properties: Record<string, { enum?: string[] }> } };
    };
    expect(schema.$defs.node.properties['logoSource']?.enum).toEqual([...LOGO_SOURCES]);
  });
});

describe('logoBoxPx', () => {
  it('is the box the mosaic fits a logo into', () => {
    // 8x6 footprint: the shortest side is 6, 60% of it is 3 tiles, 48 px.
    expect(logoBoxPx({ w: 8, h: 6 }, undefined, 16)).toEqual({ width: 48, height: 48 });
    expect(logoBoxPx({ w: 8, h: 6 }, 200, 16)).toEqual({ width: 96, height: 92 });
    // Never larger than the node's face less the bevel.
    expect(logoBoxPx({ w: 2, h: 2 }, 300, 16)).toEqual({ width: 28, height: 28 });
  });
});

describe('liveLogoLayout', () => {
  const frame = { width: 96, height: 96 };

  it('uses the largest whole-number scale that fits the frame and its float', () => {
    const layout = liveLogoLayout(frame, { width: 300, height: 300 }, 2);
    expect(layout).toEqual({ integer: true, ratio: 3, divisor: 1, width: 288, height: 288 });
    // 300 / (96 + 4) = 3: exactly enough height for three whole frames plus the float.
    expect(liveLogoLayout(frame, { width: 96, height: 100 }, 2).integer).toBe(true);
  });

  it('takes every Nth pixel when the box is smaller than a frame, never a smoothed fraction', () => {
    // (96 + 2 x 2) / 48 needs a divisor of 3: every third pixel, 32 px, with room to float.
    expect(liveLogoLayout(frame, { width: 48, height: 48 }, 2))
      .toEqual({ integer: false, ratio: 1 / 3, divisor: 3, width: 32, height: 32 });
    // (96 + 4) / 50 is exactly 2.
    expect(liveLogoLayout(frame, { width: 50, height: 50 }, 2))
      .toEqual({ integer: false, ratio: 1 / 2, divisor: 2, width: 48, height: 48 });
    for (const side of [20, 33, 47, 60, 95]) {
      const layout = liveLogoLayout(frame, { width: side, height: side }, 2);
      expect(Number.isInteger(layout.divisor)).toBe(true);
      expect(layout.width).toBeLessThanOrEqual(side);
      expect(layout.height + 2 * Math.round(2 * layout.ratio)).toBeLessThanOrEqual(side + 1);
    }
  });

  it('floats a whole number of world pixels at every scale', () => {
    for (const box of [{ width: 48, height: 48 }, { width: 200, height: 200 }]) {
      const { ratio } = liveLogoLayout(frame, box, DEFAULT_TIMING.wobblePx);
      for (let t = 0; t < 3000; t += 50) expect(Number.isInteger(Math.round(wobbleOffset(t) * ratio))).toBe(true);
    }
  });

  it('draws nothing for a degenerate box or frame', () => {
    expect(liveLogoLayout({ width: 0, height: 0 }, { width: 48, height: 48 }, 2).width).toBe(0);
    expect(liveLogoLayout(frame, { width: 0, height: 10 }, 2).width).toBe(0);
  });
});
