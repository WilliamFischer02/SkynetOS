import { describe, expect, it } from 'vitest';
import {
  CONFIRM_KINDS,
  CONFIRM_MAX_HEIGHT,
  CONFIRM_MIN_HEIGHT,
  answerIndex,
  confirmHash,
  confirmHeightFor,
  decodeConfirm,
  encodeConfirm,
  normaliseConfirm
} from '../packages/shared/confirm.js';
import {
  AGENT_METHODS,
  CHANNELS,
  CONFIRM_ALLOWED,
  HOLOGRAM_ALLOWED,
  REMOTE_METHODS,
  VISION_METHODS,
  VISION_SHARED,
  VOICE_METHODS,
  isConfirmMethod
} from '../packages/shared/ipc.js';

/**
 * docs/07 § Path and execution policy: the confirmation is now a SkynetOS window with the same
 * default (the refusal) and one channel back. Held here so the look can change and the semantics
 * cannot.
 */
describe('the confirm window contract', () => {
  it('has exactly one channel, and it belongs to nobody but the confirm window', () => {
    expect(CONFIRM_ALLOWED).toEqual(['confirm:answer']);
    expect(CHANNELS).toContain('confirm:answer');
    expect(isConfirmMethod('confirm:answer')).toBe(true);
    expect(isConfirmMethod('command:apply')).toBe(false);
    for (const list of [AGENT_METHODS, REMOTE_METHODS, VISION_METHODS, VISION_SHARED, VOICE_METHODS, HOLOGRAM_ALLOWED]) {
      expect(list as readonly string[]).not.toContain('confirm:answer');
    }
  });

  it('round-trips a question through the URL hash unchanged', () => {
    const payload = normaliseConfirm('abc123', {
      title: 'Launch this program?',
      message: 'F3 — Renderer.exe',
      detail: 'C:\\dev\\TruthQuestRetro\\build\\Renderer.exe\n\nNot under any configured dev root. Ünïcode · ✓',
      buttons: ['Open', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      kind: 'launch',
      theme: { maskDark: '#101C26', maskLight: '#182734', signal: '#4FA8D8' }
    });
    const encoded = encodeConfirm(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeConfirm(encoded)).toEqual(payload);
    expect(confirmHash(2, payload)).toBe(`confirm?ui=2&q=${encoded}`);
  });

  it('keeps the refusal as the default whatever the caller wrote', () => {
    const p = normaliseConfirm('x', { title: 't', message: 'm', buttons: ['Delete', 'Cancel'], defaultId: 7, cancelId: 9 });
    expect(p.cancelId).toBe(1);
    expect(p.defaultId).toBe(1);
    // An unknown kind is `info`; a theme with a bad colour is dropped, never half-applied.
    const q = normaliseConfirm('y', { title: 't', message: 'm', buttons: ['OK'], defaultId: 0, cancelId: 0, kind: 'loud' as never, theme: { maskDark: 'red', maskLight: '#000000', signal: '#ffffff' } });
    expect(q.kind).toBe('info');
    expect(q.theme).toBeUndefined();
    expect(CONFIRM_KINDS).toEqual(['launch', 'danger', 'info']);
  });

  it('turns anything but a real button index into the refusal', () => {
    const p = normaliseConfirm('z', { title: 't', message: 'm', buttons: ['Launch', 'Cancel'], defaultId: 1, cancelId: 1 });
    expect(answerIndex(p, 0)).toBe(0);
    expect(answerIndex(p, 1)).toBe(1);
    expect(answerIndex(p, 2)).toBe(1);
    expect(answerIndex(p, -1)).toBe(1);
    expect(answerIndex(p, 0.5)).toBe(1);
    expect(answerIndex(p, 'Launch')).toBe(1);
    expect(answerIndex(p, undefined)).toBe(1);
  });

  it('refuses garbage in the hash rather than showing a half question', () => {
    expect(decodeConfirm('not-base64!!')).toBeNull();
    expect(decodeConfirm(encodeConfirm({ id: 'k', buttons: [], title: '', message: '', defaultId: 0, cancelId: 0 }))?.buttons).toEqual(['OK']);
    const noId = btoa(JSON.stringify({ buttons: ['a'] })).replace(/=+$/, '');
    expect(decodeConfirm(noId)).toBeNull();
  });

  it('sizes the window to the text, within bounds', () => {
    const short = normaliseConfirm('s', { title: 't', message: 'Delete?', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1 });
    const long = normaliseConfirm('l', { title: 't', message: 'x'.repeat(600), detail: 'y\n'.repeat(80), buttons: ['Ok'], defaultId: 0, cancelId: 0 });
    expect(confirmHeightFor(short)).toBe(CONFIRM_MIN_HEIGHT);
    expect(confirmHeightFor(long)).toBe(CONFIRM_MAX_HEIGHT);
    const mid = normaliseConfirm('m', { title: 't', message: 'One line', detail: 'a\nb\nc\nd\ne\nf', buttons: ['Ok'], defaultId: 0, cancelId: 0 });
    expect(confirmHeightFor(mid)).toBeGreaterThan(CONFIRM_MIN_HEIGHT);
    expect(confirmHeightFor(mid)).toBeLessThan(CONFIRM_MAX_HEIGHT);
  });
});
