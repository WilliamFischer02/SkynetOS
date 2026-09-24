/**
 * Overlays never sit on one another.
 *
 * Seen in a screenshot: at overview zoom the board shrinks but a chrome plate keeps its readable
 * size, so two neighbours overlapped and the upper one covered the lower one's controls, taking
 * their clicks. The phantom plates got this first; the drag badges (DIRTY PLUSH over PANIC) had
 * the same fault. One rule for both: place top to bottom, and push each plate below any plate
 * already placed that it would cover. A handful of plates, so a handful of comparisons a frame.
 */

export interface PlateBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether two screen boxes share any pixel. */
export function boxesOverlap(a: PlateBox, b: PlateBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * The y at which `box` clears every box in `placed`, pushed down by `gap` past each one it would
 * cover. Never moves sideways and never moves up, so a plate stays under the thing it labels.
 */
export function pushBelow(box: PlateBox, placed: readonly PlateBox[], gap: number): number {
  let y = box.y;
  for (let moved = true; moved;) {
    moved = false;
    for (const r of placed) {
      if (boxesOverlap({ ...box, y }, r)) {
        y = r.y + r.h + gap;
        moved = true;
      }
    }
  }
  return y;
}

/** Top to bottom, then left to right: the order plates are placed in, so the upper one wins. */
export function plateOrder(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.y - b.y || a.x - b.x;
}
