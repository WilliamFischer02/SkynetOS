import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOLOGRAM_PALETTE } from '../packages/shared/hologram.js';
import { AGENT_METHODS, CHANNELS, REMOTE_METHODS } from '../packages/shared/ipc.js';
import {
  DEFAULT_TRAY,
  TRAY_ICONS,
  TRAY_TOOLTIP,
  normaliseTraySettings,
  trayIconFor,
  trayIconPath,
  trayMenuTemplate,
  type TrayMenuItem,
  type TrayState
} from '../packages/shared/tray.js';

/** The tray icon, M13.5 (packages/shared/tray.ts, src/main/services/tray.ts, tools/make-tray-icon.mjs). */

// pngjs ships no types and @types/pngjs is not a dependency; this is the one call used here.
const { PNG } = createRequire(import.meta.url)('pngjs') as {
  PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } } };
};

const ALL_OFF: TrayState = { voice: false, desktop: false, autostart: false, autostartSupported: true };

type Labelled = Exclude<TrayMenuItem, { type: 'separator' }>;

function byLabel(items: TrayMenuItem[], label: string): Labelled {
  const found = items.find((i): i is Labelled => i.type !== 'separator' && i.label === label);
  if (!found) throw new Error(`no menu item "${label}"`);
  return found;
}

describe('the tray menu', () => {
  it('lists the items in order, with two separators', () => {
    const shape = trayMenuTemplate(ALL_OFF).map((i) => (i.type === 'separator' ? '---' : i.label));
    expect(shape).toEqual(['Open board', 'JARVIS Voice', 'Voice', 'Desk control', '---', 'Start with Windows', '---', 'Quit']);
  });

  it('makes the three switches checkboxes and the rest plain items', () => {
    const items = trayMenuTemplate(ALL_OFF);
    for (const label of ['Voice', 'Desk control', 'Start with Windows']) expect(byLabel(items, label).type).toBe('checkbox');
    for (const label of ['Open board', 'JARVIS Voice', 'Quit']) expect(byLabel(items, label).type).toBe('normal');
  });

  it('ticks each switch from its own state and no other', () => {
    const ticks = (state: TrayState): boolean[] =>
      ['Voice', 'Desk control', 'Start with Windows'].map((l) => { const i = byLabel(trayMenuTemplate(state), l); return i.type === 'checkbox' && i.checked; });
    expect(ticks(ALL_OFF)).toEqual([false, false, false]);
    expect(ticks({ ...ALL_OFF, voice: true })).toEqual([true, false, false]);
    expect(ticks({ ...ALL_OFF, desktop: true })).toEqual([false, true, false]);
    expect(ticks({ ...ALL_OFF, autostart: true })).toEqual([false, false, true]);
    expect(ticks({ voice: true, desktop: true, autostart: true, autostartSupported: true })).toEqual([true, true, true]);
  });

  it('maps each item to its action', () => {
    const ids = trayMenuTemplate(ALL_OFF).flatMap((i) => (i.type === 'separator' ? [] : [i.id]));
    expect(ids).toEqual(['openBoard', 'openHologram', 'toggleVoice', 'toggleDesktop', 'toggleAutostart', 'quit']);
  });

  it('greys Start with Windows while its state is unread or unsupported, so a click never guesses', () => {
    const enabled = (state: TrayState): boolean | undefined => byLabel(trayMenuTemplate(state), 'Start with Windows').enabled;
    expect(enabled(ALL_OFF)).toBe(true);
    expect(enabled({ ...ALL_OFF, autostart: null })).toBe(false);
    expect(enabled({ ...ALL_OFF, autostartSupported: false })).toBe(false);
    const unread = byLabel(trayMenuTemplate({ ...ALL_OFF, autostart: null }), 'Start with Windows');
    expect(unread.type === 'checkbox' && unread.checked).toBe(false);
  });

  it('says SkynetOS on hover', () => {
    expect(TRAY_TOOLTIP).toBe('SkynetOS');
  });

  it('adds no channel: nothing tray-shaped exists, so no agent or phone can reach one', () => {
    const trayish = (CHANNELS as readonly string[]).filter((c) => /^tray:/.test(c));
    expect(trayish).toEqual([]);
    for (const c of [...(AGENT_METHODS as readonly string[]), ...(REMOTE_METHODS as readonly string[])]) expect(c).not.toMatch(/^tray:/);
  });
});

describe('the tray setting', () => {
  it('defaults minimise-to-tray off', () => {
    expect(DEFAULT_TRAY).toEqual({ minimizeToTray: false });
    expect(normaliseTraySettings(undefined)).toEqual({ minimizeToTray: false });
  });

  it('turns it on only for a literal true', () => {
    expect(normaliseTraySettings({ minimizeToTray: true })).toEqual({ minimizeToTray: true });
    for (const v of ['true', 1, 'yes', null, {}]) expect(normaliseTraySettings({ minimizeToTray: v })).toEqual({ minimizeToTray: false });
    expect(normaliseTraySettings('minimizeToTray')).toEqual({ minimizeToTray: false });
  });
});

describe('the tray icon files', () => {
  it('picks the 32 px file from 150% display scale up, the 16 px file below', () => {
    expect(trayIconFor(1).file).toBe('tray-16.png');
    expect(trayIconFor(1.25).file).toBe('tray-16.png');
    expect(trayIconFor(1.5).file).toBe('tray-32.png');
    expect(trayIconFor(2).file).toBe('tray-32.png');
    expect(trayIconFor(3).file).toBe('tray-32.png');
    expect(trayIconFor(Number.NaN).file).toBe('tray-16.png');
    expect(trayIconFor(0).file).toBe('tray-16.png');
  });

  it('finds them under the program root, the repo or resources/', () => {
    expect(trayIconPath('C:/dev/SkynetOS', 'tray-16.png')).toBe('C:/dev/SkynetOS/assets/tray/tray-16.png');
    expect(trayIconPath('C:/Users/w/AppData/Local/Programs/SkynetOS/resources/', 'tray-32.png'))
      .toBe('C:/Users/w/AppData/Local/Programs/SkynetOS/resources/assets/tray/tray-32.png');
  });
});

describe('the tray icon PNGs (npm run icon:tray)', () => {
  const six = new Set(HOLOGRAM_PALETTE.slice(0, 6).map((h) => h.toUpperCase()));
  const hex = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

  for (const icon of TRAY_ICONS) {
    it(`${icon.file} is ${icon.size}x${icon.size}, in at most the hologram's six blues plus transparent`, () => {
      const png = PNG.sync.read(readFileSync(join(__dirname, '..', 'assets', 'tray', icon.file)));
      expect(png.width).toBe(icon.size);
      expect(png.height).toBe(icon.size);
      const colours = new Set<string>();
      let transparent = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        const a = png.data[i + 3]!;
        // Whole pixels only: fully there or fully not (docs/02 Anti-mush).
        expect(a === 0 || a === 255).toBe(true);
        if (a === 0) { transparent++; continue; }
        colours.add(hex(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!));
      }
      expect(colours.size).toBeLessThanOrEqual(6);
      for (const c of colours) expect(six.has(c)).toBe(true);
      // The orb is round: its corners are see-through, and it fills most of the square.
      expect(transparent).toBeGreaterThan(0);
      expect(transparent).toBeLessThan(png.width * png.height / 2);
      for (const [x, y] of [[0, 0], [png.width - 1, 0], [0, png.height - 1], [png.width - 1, png.height - 1]] as const) {
        expect(png.data[(y * png.width + x) * 4 + 3]).toBe(0);
      }
    });
  }
});
