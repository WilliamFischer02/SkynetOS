import { app, nativeImage, type WebContents } from 'electron';
import type { Board, BoardNode } from '@shared/types.js';
import { hexToRgb, COPPER, COPPER_DARK, SILK } from '@shared/palette.js';
import { resolveGlob } from './target-resolver.js';
import { resolveNodeTarget } from './target-resolver.js';

/**
 * Dragging a real file OUT of SkynetOS and into another program.
 *
 * This is the reason docs/01 picked Electron over Tauri: `webContents.startDrag` hands the OS a
 * real file drag, so a `.jar` can go straight from the board into the Minecraft launcher, a mods
 * folder, or a Discord message.
 *
 * ── The landmine ──────────────────────────────────────────────────────────────────────────────
 * CLAUDE.md: "Electron `startDrag` on Windows kills in-app drop targets for the same gesture.
 * Distinguish drag-out (from the node's file badge) from drag-to-move (from the node body) at the
 * DOM level, with different handles."
 *
 * Once `startDrag` is called, Windows owns the gesture: the app stops receiving mouse events for
 * it, so an in-app drag that started as a move can never become a drag-out and vice versa. The
 * decision has to be made at `dragstart`, before any of that, from *which element* was grabbed.
 *
 * So the artifact cartridge gets a small DOM badge overlaid on the canvas, and that badge is the
 * only drag-out handle. The node body stays canvas and keeps drag-to-move. Two handles, two
 * gestures, decided by the DOM before Windows takes over. See ui/DragBadges.tsx.
 */

/**
 * A drag icon. Windows requires a non-empty image or `startDrag` throws.
 *
 * `app.getFileIcon` gives the real shell icon for the file, which is what the user expects to see
 * under the cursor — a jar looks like a jar. When that fails (no association, an unusual
 * extension) it falls back to a drawn cartridge in the board's own palette rather than throwing.
 */
async function dragIcon(file: string): Promise<Electron.NativeImage> {
  try {
    const icon = await app.getFileIcon(file, { size: 'large' });
    if (!icon.isEmpty()) return icon;
  } catch {
    // Fall through to the drawn one.
  }
  return cartridgeIcon();
}

/**
 * A 32x32 cartridge, drawn from the locked palette. Flat fills and hard edges, like everything
 * else — a soft gradient icon under the cursor would look like it came from a different program.
 */
function cartridgeIcon(): Electron.NativeImage {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const put = (x: number, y: number, rgb: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // nativeImage.createFromBitmap wants BGRA.
    buf[i] = rgb[2]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[0]; buf[i + 3] = 255;
  };

  const body = hexToRgb(COPPER_DARK);
  const edge = hexToRgb(SILK);
  const pins = hexToRgb(COPPER);

  for (let y = 4; y < 28; y++) for (let x = 6; x < 26; x++) put(x, y, body);
  for (let x = 6; x < 26; x++) { put(x, 4, edge); put(x, 27, edge); }
  for (let y = 4; y < 28; y++) { put(6, y, edge); put(25, y, edge); }
  // Connector fingers along the bottom, which is what makes it read as a cartridge.
  for (let x = 9; x < 23; x += 3) for (let y = 22; y < 27; y++) { put(x, y, pins); put(x + 1, y, pins); }

  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export interface DragOutResult {
  ok: boolean;
  file?: string;
  error?: string;
}

/**
 * The file a node would drag out, or an explanation.
 *
 * Only kinds that ARE a file can be dragged: an artifact resolves its glob to the newest build,
 * a document and an executable are the file itself. A repo drive is a directory — Windows can
 * drag those too, but dragging a repo into a chat window is far more likely to be an accident
 * than an intention, so it is not offered.
 */
export function dragFileFor(node: BoardNode): { file: string | null; error?: string } {
  if (node.kind === 'file.artifact') {
    const target = resolveGlob(node.glob ?? '', node.exclude ?? [], node.versionPattern);
    if (!target.resolved) return { file: null, error: target.detail ?? 'NO BUILD TO DRAG' };
    return { file: target.resolved };
  }

  if (node.kind === 'file.document' || node.kind === 'file.exe') {
    const target = resolveNodeTarget(node);
    if (!target.resolved || target.state === 'missing') {
      return { file: null, error: target.detail ?? 'FILE NOT FOUND' };
    }
    return { file: target.resolved };
  }

  return { file: null, error: `${node.kind} IS NOT A FILE YOU CAN DRAG OUT` };
}

/**
 * Hand the drag to Windows.
 *
 * Must be called synchronously-ish from the renderer's `dragstart`; once this returns the OS owns
 * the gesture and the app will not see the rest of it.
 */
export async function startDragOut(
  sender: WebContents,
  board: Board,
  nodeId: string
): Promise<DragOutResult> {
  const node = board.nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, error: `NO SUCH NODE — "${nodeId}"` };

  const { file, error } = dragFileFor(node);
  if (!file) return { ok: false, ...(error ? { error } : {}) };

  try {
    sender.startDrag({ file: file.replace(/\//g, '\\'), icon: await dragIcon(file) });
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: `DRAG FAILED — ${(err as Error).message}` };
  }
}
