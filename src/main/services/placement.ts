import { footprintOf, type Board, type Footprint } from '@shared/types.js';

/**
 * Finding free grid space for a new node.
 *
 * A node dropped on top of another one fails validation, so the placer has to find a real gap
 * rather than putting it where the cursor happened to be. It starts from the requested position
 * and spirals outward, so a dropped file lands near where you dropped it when there is room and
 * somewhere sensible when there is not.
 *
 * Deliberately in main rather than reusing the renderer's `findFreeSpace`: ingestion happens in
 * main, and main must not import from src/renderer. The rule they both implement — "no two
 * mounted footprints may overlap" — is the schema's, enforced by the command bus either way.
 */
export function findFreeSpaceOnBoard(
  board: Board,
  footprint: Footprint,
  preferred: { x: number; y: number }
): { x: number; y: number } | null {
  const occupied = new Set<string>();
  for (const node of board.nodes) {
    // Zones and notes are printed on the board, not mounted to it — they never collide.
    if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
    const fp = footprintOf(node);
    for (let y = node.pos.y; y < node.pos.y + fp.h; y++) {
      for (let x = node.pos.x; x < node.pos.x + fp.w; x++) occupied.add(`${x},${y}`);
    }
  }

  const fits = (ox: number, oy: number): boolean => {
    if (ox < 0 || oy < 0) return false;
    if (ox + footprint.w > board.grid.width || oy + footprint.h > board.grid.height) return false;
    for (let y = oy; y < oy + footprint.h; y++) {
      for (let x = ox; x < ox + footprint.w; x++) if (occupied.has(`${x},${y}`)) return false;
    }
    return true;
  };

  const startX = Math.max(0, Math.min(board.grid.width - footprint.w, Math.round(preferred.x)));
  const startY = Math.max(0, Math.min(board.grid.height - footprint.h, Math.round(preferred.y)));
  if (fits(startX, startY)) return { x: startX, y: startY };

  // Expanding square rings around the drop point. The first gap found is the nearest one.
  const maxRadius = Math.max(board.grid.width, board.grid.height);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only the ring itself; the interior was covered by a smaller radius.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = startX + dx;
        const y = startY + dy;
        if (fits(x, y)) return { x, y };
      }
    }
  }
  return null;
}
