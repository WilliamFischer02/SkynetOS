import { describe, expect, it } from 'vitest';
import {
  AVATAR_LOGO_MISSING,
  LOGO_SOURCES,
  logoCacheSource,
  logoPathFor,
  logoSourceOf
} from '../packages/shared/logo-source.js';

const IDLE = 'C:/dev/SkynetOS/assets/avatar/jarvis/idle.png';
const withFrames = (): string | null => IDLE;
const noFrames = (): string | null => null;

describe('logoSource', () => {
  it('offers exactly file, avatar and none, defaulting to file', () => {
    expect([...LOGO_SOURCES]).toEqual(['file', 'avatar', 'avatar-live', 'none']);
    expect(logoSourceOf({})).toBe('file');
    expect(logoSourceOf({ logoSource: 'avatar' })).toBe('avatar');
  });

  it('file: draws the node\'s own logo, as before', () => {
    expect(logoPathFor({ logo: '%SKYNET%/a.png' }, noFrames)).toEqual({ path: '%SKYNET%/a.png', reason: null });
    expect(logoPathFor({}, withFrames).path).toBeNull();
  });

  it('avatar: draws the still face when there is one, and says why not when there is none', () => {
    expect(logoPathFor({ logoSource: 'avatar', logo: '%SKYNET%/a.png' }, withFrames)).toEqual({ path: IDLE, reason: null });
    expect(logoPathFor({ logoSource: 'avatar' }, noFrames)).toEqual({ path: null, reason: AVATAR_LOGO_MISSING });
  });

  it('none: draws nothing, even with a logo file set', () => {
    expect(logoPathFor({ logoSource: 'none', logo: '%SKYNET%/a.png' }, withFrames).path).toBeNull();
  });

  it('Show logo off wins over every source, and never touches the frames folder', () => {
    let asked = false;
    const spy = (): string | null => { asked = true; return IDLE; };
    for (const logoSource of LOGO_SOURCES) {
      expect(logoPathFor({ showLogo: false, logoSource, logo: 'x.png' }, spy).path).toBeNull();
    }
    expect(asked).toBe(false);
  });

  it('only an avatar node reads the frames folder', () => {
    let asked = 0;
    const spy = (): string | null => { asked++; return IDLE; };
    logoPathFor({ logo: 'x.png' }, spy);
    logoPathFor({ logoSource: 'none' }, spy);
    expect(asked).toBe(0);
    logoPathFor({ logoSource: 'avatar' }, spy);
    expect(asked).toBe(1);
  });

  it('the renderer key changes when the frames folder does, and is empty when nothing is drawn', () => {
    expect(logoCacheSource({ logoSource: 'avatar' }, 1)).not.toBe(logoCacheSource({ logoSource: 'avatar' }, 2));
    expect(logoCacheSource({ logo: 'x.png' }, 1)).toBe('x.png');
    expect(logoCacheSource({ logo: 'x.png' }, 1)).toBe(logoCacheSource({ logo: 'x.png' }, 9));
    expect(logoCacheSource({ logoSource: 'none', logo: 'x.png' }, 1)).toBeUndefined();
    expect(logoCacheSource({ showLogo: false, logoSource: 'avatar' }, 1)).toBeUndefined();
    expect(logoCacheSource({}, 1)).toBeUndefined();
  });
});
