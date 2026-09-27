import { describe, expect, it } from 'vitest';
import {
  AGENT_METHODS,
  CHANNELS,
  CONFIRM_ALLOWED,
  EVENTS,
  HOLOGRAM_ALLOWED,
  REMOTE_METHODS,
  VISION_METHODS,
  VISION_SHARED,
  VOICE_METHODS,
  WINDOW_METHODS,
  isWindowMethod
} from '../packages/shared/ipc.js';

/**
 * The board window's frame controls and the chrome scale (2026-09-27). docs/07 § Agent authority:
 * an agent that could minimise the board could hide what it is doing, and a phone has no business
 * resizing a desktop it is not in front of. Settings are user-only. Held here so a later edit
 * cannot grant any of them by accident.
 */
const WINDOW_CHANNELS = ['window:maximize', 'window:minimize', 'window:state'] as const;
const USER_ONLY = [...WINDOW_CHANNELS, 'settings:setUiScale'] as const;

describe('window controls contract', () => {
  it('declares the three window channels, the scale writer and the change event', () => {
    for (const c of USER_ONLY) expect(CHANNELS as readonly string[]).toContain(c);
    expect(EVENTS as readonly string[]).toContain('window:changed');
    expect([...WINDOW_METHODS].sort()).toEqual([...WINDOW_CHANNELS].sort());
    for (const c of WINDOW_CHANNELS) expect(isWindowMethod(c)).toBe(true);
    expect(isWindowMethod('settings:setUiScale')).toBe(false);
  });

  it('grants none of them to an agent or a remote device', () => {
    for (const c of USER_ONLY) {
      expect(AGENT_METHODS as readonly string[]).not.toContain(c);
      expect(REMOTE_METHODS as readonly string[]).not.toContain(c);
    }
  });

  it('keeps them away from every other window with the bridge', () => {
    for (const c of USER_ONLY) {
      expect(HOLOGRAM_ALLOWED as readonly string[]).not.toContain(c);
      expect(VISION_METHODS as readonly string[]).not.toContain(c);
      expect(VISION_SHARED as readonly string[]).not.toContain(c);
      expect(VOICE_METHODS as readonly string[]).not.toContain(c);
      expect(CONFIRM_ALLOWED as readonly string[]).not.toContain(c);
    }
  });
});
