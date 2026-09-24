/**
 * One texture per live face, not one per refresh.
 *
 * The sprite store caches every component texture by a key that includes its face, and never
 * frees one: a board's faces change when you edit it, which is rare, so the cache stays small.
 * A monitor widget changes its face every couple of seconds for as long as the board is open.
 * Keyed the ordinary way, it would add a texture (and a canvas, and a GPU upload) to that cache on
 * every refresh and keep all of them: about 1,800 an hour per monitor.
 *
 * So a live face names its SLOT (the node it belongs to), and the store remembers which key each
 * slot is currently showing. When a slot moves on to a new key, the old texture is handed back to
 * be destroyed. Pure, so test/live-slots.test.ts can hold the bookkeeping.
 */
export class LiveSlots {
  private readonly current = new Map<string, string>();

  /**
   * Record that `slot` now shows `key`. Returns the key it showed before when that is a different
   * one, for the caller to free, and null otherwise.
   */
  swap(slot: string, key: string): string | null {
    const previous = this.current.get(slot);
    this.current.set(slot, key);
    return previous !== undefined && previous !== key ? previous : null;
  }

  /**
   * Stop tracking `slot`: its node is gone, or has stopped being live. Returns the key it showed,
   * for the caller to free, and null when it was not tracked.
   */
  release(slot: string): string | null {
    const previous = this.current.get(slot);
    this.current.delete(slot);
    return previous ?? null;
  }

  /** How many live faces are being tracked. */
  get size(): number {
    return this.current.size;
  }
}
