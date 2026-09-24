import { describe, expect, it } from 'vitest';
import { LiveSlots } from '../src/renderer/board/live-slots.js';

/**
 * The bookkeeping that keeps a monitor widget from filling the texture cache. A widget refreshes
 * every couple of seconds; each refresh must free the texture it replaces, and nothing else.
 */
describe('LiveSlots', () => {
  it('hands back the previous key when a slot moves on', () => {
    const slots = new LiveSlots();
    expect(slots.swap('m1', 'k1')).toBeNull();
    expect(slots.swap('m1', 'k2')).toBe('k1');
    expect(slots.swap('m1', 'k3')).toBe('k2');
  });

  it('frees nothing when the same key is asked for again', () => {
    // A rebuild redraws the node with the widget it already has: same key, and the texture that
    // key names is the one about to be put back on the sprite.
    const slots = new LiveSlots();
    slots.swap('m1', 'k1');
    expect(slots.swap('m1', 'k1')).toBeNull();
  });

  it('keeps one entry per slot however long it runs', () => {
    const slots = new LiveSlots();
    for (let i = 0; i < 1800; i++) { slots.swap('m1', `m1:${i}`); slots.swap('m2', `m2:${i}`); }
    expect(slots.size).toBe(2);
  });

  it('never frees another slot\'s texture', () => {
    const slots = new LiveSlots();
    slots.swap('m1', 'a');
    expect(slots.swap('m2', 'b')).toBeNull();
    expect(slots.swap('m2', 'c')).toBe('b');
  });

  it('hands back the last key once when a slot is released, as a deleted GIF node is', () => {
    const slots = new LiveSlots();
    slots.swap('anim:n1', 'f0');
    slots.swap('anim:n1', 'f1');
    slots.swap('m1', 'w');
    expect(slots.release('anim:n1')).toBe('f1');
    expect(slots.release('anim:n1')).toBeNull();
    expect(slots.release('never-live')).toBeNull();
    expect(slots.size).toBe(1);
    // Live again later: a fresh slot, with nothing stale to free.
    expect(slots.swap('anim:n1', 'f0')).toBeNull();
  });
});
