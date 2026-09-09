/**
 * Camera maths. Deliberately pure — no Pixi, no DOM — so test/camera.test.ts can prove the
 * anti-mush guarantees instead of asserting them in a comment.
 *
 * The invariant this file exists to hold: whatever the camera's internal position is, the value
 * handed to the stage every frame is a WHOLE NUMBER of device pixels. Fractional stage positions
 * are what makes a pixel-art camera shimmer (docs/02, anti-mush rule 4).
 */

/** Integer zoom only. There is no 1x — the board is unreadable below 2x. */
export const ZOOM_LEVELS = [2, 3, 4] as const;
export type Zoom = (typeof ZOOM_LEVELS)[number];

export const TILE = 16;

/** Pan acceleration, in SCREEN pixels per frame, so panning feels identical at every zoom. */
export const PAN_MIN_SPEED = 4;
export const PAN_MAX_SPEED = 16;
/** Frames of held input to reach full speed. 20 frames ≈ 1/3 s at 60fps. */
export const PAN_RAMP_FRAMES = 20;

export interface Camera {
  /** Top-left of the viewport, in world (board) pixels. May be fractional; render rounds it. */
  x: number;
  y: number;
  zoom: Zoom;
}

export interface Viewport {
  /** In CSS pixels, which the main process has forced to equal device pixels. */
  width: number;
  height: number;
}

export interface PanInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** How many consecutive frames a pan key has been held. Drives the ramp. */
  heldFrames: number;
}

export function isZoom(value: number): value is Zoom {
  return (ZOOM_LEVELS as readonly number[]).includes(value);
}

/** Screen pixels this frame, ramping from PAN_MIN_SPEED to PAN_MAX_SPEED. */
export function panSpeed(heldFrames: number): number {
  const t = Math.min(1, Math.max(0, heldFrames) / PAN_RAMP_FRAMES);
  return PAN_MIN_SPEED + (PAN_MAX_SPEED - PAN_MIN_SPEED) * t;
}

/**
 * Board extent in world pixels. A board is grid.width x grid.height TILES.
 */
export function boardPixelSize(grid: { width: number; height: number }): { width: number; height: number } {
  return { width: grid.width * TILE, height: grid.height * TILE };
}

/**
 * Keep the camera over the board. When the board is smaller than the viewport on an axis, centre
 * it on that axis rather than pinning it to the origin — an under-filled window should look like
 * a board sitting on a bench, not a board jammed into a corner.
 */
export function clampCamera(cam: Camera, board: { width: number; height: number }, view: Viewport): Camera {
  const visibleW = view.width / cam.zoom;
  const visibleH = view.height / cam.zoom;

  const x = board.width <= visibleW
    ? (board.width - visibleW) / 2
    : Math.min(Math.max(cam.x, 0), board.width - visibleW);

  const y = board.height <= visibleH
    ? (board.height - visibleH) / 2
    : Math.min(Math.max(cam.y, 0), board.height - visibleH);

  return { x, y, zoom: cam.zoom };
}

/** Advance the camera by one frame of pan input. */
export function stepCamera(cam: Camera, input: PanInput, board: { width: number; height: number }, view: Viewport): Camera {
  const dxScreen = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dyScreen = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dxScreen === 0 && dyScreen === 0) return cam;

  // Normalise diagonals so holding two keys is not 1.41x faster than holding one.
  const len = Math.hypot(dxScreen, dyScreen);
  const speed = panSpeed(input.heldFrames) / cam.zoom; // screen px -> world px

  return clampCamera(
    { x: cam.x + (dxScreen / len) * speed, y: cam.y + (dyScreen / len) * speed, zoom: cam.zoom },
    board,
    view
  );
}

/**
 * Change zoom while keeping the given SCREEN point looking at the same world point. Anchor
 * defaults to the viewport centre, which is what the 2/3/4 keys want.
 */
export function setZoom(cam: Camera, zoom: Zoom, view: Viewport, anchor?: { x: number; y: number }): Camera {
  const ax = anchor?.x ?? view.width / 2;
  const ay = anchor?.y ?? view.height / 2;
  const worldX = cam.x + ax / cam.zoom;
  const worldY = cam.y + ay / cam.zoom;
  return { x: worldX - ax / zoom, y: worldY - ay / zoom, zoom };
}

/** Next / previous zoom level, saturating at the ends. Used by Ctrl+scroll. */
export function stepZoom(zoom: Zoom, direction: 1 | -1): Zoom {
  const i = ZOOM_LEVELS.indexOf(zoom);
  const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i + direction))];
  return next ?? zoom;
}

/**
 * THE anti-mush function. The stage position handed to Pixi every frame, in whole device pixels.
 *
 * Note the order: multiply by zoom FIRST, then round. Rounding the world position before scaling
 * would still land on a fractional device pixel at zoom 3 (a world x of 10.5 rounds to 11, then
 * scales to 33 — fine — but 10.4 rounds to 10 and the camera visibly stutters by a third of a
 * tile). Rounding after the multiply quantises to the device pixel grid, which is the finest
 * step that cannot shimmer.
 */
export function stagePosition(cam: Camera): { x: number; y: number } {
  return { x: -Math.round(cam.x * cam.zoom), y: -Math.round(cam.y * cam.zoom) };
}

/** Screen point -> world point, for hit-testing and Ctrl+scroll anchoring. */
export function screenToWorld(cam: Camera, screenX: number, screenY: number): { x: number; y: number } {
  return { x: cam.x + screenX / cam.zoom, y: cam.y + screenY / cam.zoom };
}

/** World point -> the tile containing it. */
export function worldToTile(x: number, y: number): { x: number; y: number } {
  return { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
}
