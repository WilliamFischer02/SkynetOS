import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  VOICE_METHODS
} from '../packages/shared/ipc.js';

/**
 * The calendar pane's channel (docs/07 § ScheduleOS). `schedule:calendar` carries William's week:
 * the board window reads it, main pushes it to the board window, and nothing else may ask. The iCal
 * URLs behind it are settings-only and never logged. Held here so a later edit cannot widen it.
 */

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('schedule:calendar', () => {
  it('is a channel and an event', () => {
    expect(CHANNELS as readonly string[]).toContain('schedule:calendar');
    expect(EVENTS as readonly string[]).toContain('schedule:calendar');
  });

  it('is granted to no agent and no remote device', () => {
    expect(AGENT_METHODS as readonly string[]).not.toContain('schedule:calendar');
    expect(REMOTE_METHODS as readonly string[]).not.toContain('schedule:calendar');
  });

  it('is kept from every other window with the bridge', () => {
    for (const list of [HOLOGRAM_ALLOWED, VISION_METHODS, VISION_SHARED, VOICE_METHODS, CONFIRM_ALLOWED]) {
      expect(list as readonly string[]).not.toContain('schedule:calendar');
    }
  });

  it('is refused by registerIpc unless the board window asks', () => {
    const ipc = read('src/main/ipc.ts');
    const check = ipc.split(/\r?\n/).find((l) => l.includes("channel === 'schedule:calendar'"));
    expect(check, 'no sender check names schedule:calendar').toBeDefined();
    expect(check).toMatch(/event\.sender !== boardWindow\(\)\?\.webContents/);
  });

  it('is pushed to the board window alone, never broadcast to a phone', () => {
    const feed = read('src/main/services/schedule-feed.ts');
    expect(feed).toMatch(/webContents\.send\('schedule:calendar'/);
    expect(feed).not.toMatch(/remoteBroadcast/);
  });

  it('has no channel that writes the iCal feeds: they are settings.json only', () => {
    for (const c of CHANNELS) expect(c).not.toMatch(/^schedule:(set|add|write)/);
  });

  it('never puts a feed URL in a log line', () => {
    const feed = read('src/main/services/schedule-feed.ts');
    const logs = feed.split(/\r?\n/).filter((l) => /console\.(log|warn|error)/.test(l));
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line, line.trim()).not.toMatch(/\$\{(url|raw|u)\}|\burls\b(?!\.length)/);
  });
});
