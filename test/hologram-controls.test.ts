import { describe, expect, it } from 'vitest';
import { HOLOGRAM_CONTROLS, HOLOGRAM_DROPDOWNS, HOLOGRAM_PANELS, describeControl, isHologramControlId, type HologramControl } from '../packages/shared/hologram-control.js';
import { CONTROL_CAPTION_MS, controlEffect, panelForButton } from '../src/renderer/hologram/controls.js';

/**
 * A spoken command presses exactly what a click would (William, 2026-09-26: "every submenu and
 * button should have voice commands preset"). The renderer applies the effect this mapping
 * returns; the mapping itself has no DOM, so it is held here.
 */
describe('controlEffect', () => {
  it('routes every panel and dropdown to state, never to a click', () => {
    for (const panel of HOLOGRAM_PANELS) expect(controlEffect({ op: 'panel', panel })).toEqual({ kind: 'panel', panel });
    for (const name of HOLOGRAM_DROPDOWNS) {
      expect(controlEffect({ op: 'dropdown', name, open: true })).toEqual({ kind: 'dropdown', name, open: true });
      expect(controlEffect({ op: 'dropdown', name, open: false })).toEqual({ kind: 'dropdown', name, open: false });
    }
  });

  it('sets switches by value, so "turn off talkback" is idempotent', () => {
    expect(controlEffect({ op: 'talkback', on: false })).toEqual({ kind: 'toggle', which: 'talkback', on: false });
    expect(controlEffect({ op: 'mic', on: true })).toEqual({ kind: 'toggle', which: 'mic', on: true });
    expect(controlEffect({ op: 'desk', on: true })).toEqual({ kind: 'toggle', which: 'desk', on: true });
    expect(controlEffect({ op: 'dictate', on: true })).toEqual({ kind: 'toggle', which: 'dictate', on: true });
    expect(controlEffect({ op: 'train-action', on: false })).toEqual({ kind: 'toggle', which: 'train-action', on: false });
  });

  it('presses any declared control by id and nothing else', () => {
    for (const id of HOLOGRAM_CONTROLS) expect(controlEffect({ op: 'press', id })).toEqual({ kind: 'press', id });
    expect(isHologramControlId('btn-close')).toBe(true);
    expect(isHologramControlId('btn-format-disk')).toBe(false);
  });

  it('close and shut down go straight to main, and shut down is the JARVIS window, not the machine', () => {
    expect(controlEffect({ op: 'close' })).toEqual({ kind: 'call', channel: 'hologram:close' });
    expect(controlEffect({ op: 'shutdown' })).toEqual({ kind: 'call', channel: 'hologram:shutdown' });
    expect(controlEffect({ op: 'minimise' })).toEqual({ kind: 'call', channel: 'hologram:minimize' });
    expect(describeControl({ op: 'shutdown' })).toBe('SHUTTING DOWN JARVIS VOICE');
  });

  it('knows which buttons open a panel', () => {
    expect(panelForButton('btn-train')).toBe('train');
    expect(panelForButton('btn-desk')).toBe('desk');
    expect(panelForButton('btn-actions')).toBe('actions');
    expect(panelForButton('btn-mic')).toBeNull();
    expect(panelForButton('btn-close')).toBeNull();
  });

  it('captions every op in upper case, briefly', () => {
    const all: HologramControl[] = [
      { op: 'panel', panel: 'train' }, { op: 'dropdown', name: 'profiles', open: true }, { op: 'talkback', on: true },
      { op: 'mic', on: false }, { op: 'desk', on: true }, { op: 'press', id: 'btn-use-voice' }, { op: 'dictate', on: true },
      { op: 'train-action', on: true }, { op: 'minimise' }, { op: 'close' }, { op: 'shutdown' }
    ];
    for (const c of all) {
      const line = describeControl(c);
      expect(line).toBe(line.toUpperCase());
      expect(line.length).toBeGreaterThan(2);
    }
    expect(CONTROL_CAPTION_MS).toBe(1200);
  });
});
