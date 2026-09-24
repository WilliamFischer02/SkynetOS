/**
 * Silkscreen printing: `note.silk` text and `group.zone` outlines.
 *
 * These are the two node kinds that are printed ON the board rather than mounted TO it. They
 * occupy no grid space, never collide, and are drawn from geometry and thresholded text rather
 * than from atlas sprites — so a zone outline can take a relation colour without touching the
 * six-colour sprite budget.
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { BoardNode, BoardTheme } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import { SILK, hexToNumber, resolveToken, signalOf } from '@shared/palette.js';
import { TILE } from './camera.js';
import { renderSilkText } from './silkscreen.js';
import { renderTextBlock, styleForNode } from './text-plate.js';

/**
 * A block of engraved text at a tile position.
 *
 * Multi-line, and styled by the node: colour, a 1px outline, and an optional plate that sizes
 * itself to the text. `glowStep` shifts the colour up the room's ramp for the text pulse.
 *
 * It used to be one line in silk, always, with no box — which is why `U1 - PRIMARY JURISDICTION`
 * was unreadable wherever a trace or a backdrop ran under it.
 */
export function buildSilkNote(node: BoardNode, theme: BoardTheme, glowStep = 0): Sprite | null {
  const text = (node.text ?? '').trim();
  if (!text) return null;
  const crest = node.textGlowColor ? resolveToken(node.textGlowColor, theme) : undefined;
  const block = renderTextBlock(text, styleForNode(node, theme), theme, glowStep, crest);
  if (!block) return null;

  const sprite = new Sprite(Texture.from(block.canvas));
  sprite.texture.source.scaleMode = 'nearest';
  sprite.x = node.pos.x * TILE;
  sprite.y = node.pos.y * TILE;
  sprite.roundPixels = true;
  return sprite;
}

/**
 * A labelled outline box grouping related components, like a functional block on a schematic.
 *
 * Drawn as four filled 1px rects, not a stroke: a 1px strokeRect straddles the pixel boundary
 * and lands as two half-lit rows. The corners are broken with a gap so the box reads as
 * silkscreen printing rather than as a component body.
 */
export function buildZone(node: BoardNode, roomSignal: string): Container {
  const container = new Container();
  const fp = footprintOf(node);
  const w = Math.max(TILE, fp.w * TILE);
  const h = Math.max(TILE, fp.h * TILE);
  const x = node.pos.x * TILE;
  const y = node.pos.y * TILE;

  // Relation colour: a zone whose work relates to another room is outlined in that room's
  // signal, so the connection is visible without reading anything.
  const color = hexToNumber(node.relation ? signalOf(node.relation, roomSignal) : SILK);

  const label = node.name.trim().toUpperCase();
  const labelColor = node.relation ? signalOf(node.relation, roomSignal) : SILK;
  const rendered = label ? renderSilkText(label, 11, labelColor) : null;

  // The label sits ON the top edge, so the edge has to break around it. Without this gap the
  // zone's own dashed run draws straight through the text and every cluster title reads as
  // struck through. Real silkscreen leaves a clearance around printed text for the same reason.
  const CORNER = TILE; // length of each corner bracket arm
  const labelX = x + CORNER + 2;
  const labelGapStart = rendered ? labelX - 3 : 0;
  const labelGapEnd = rendered ? labelX + rendered.width + 3 : 0;
  const inLabelGap = (px: number, runWidth: number): boolean =>
    rendered !== null && px < labelGapEnd && px + runWidth > labelGapStart;

  const g = new Graphics();
  // Top-left, top-right, bottom-left, bottom-right brackets only — an open box.
  if (!inLabelGap(x, CORNER)) g.rect(x, y, CORNER, 1);
  g.rect(x, y, 1, CORNER);
  if (!inLabelGap(x + w - CORNER, CORNER)) g.rect(x + w - CORNER, y, CORNER, 1);
  g.rect(x + w - 1, y, 1, CORNER);
  g.rect(x, y + h - 1, CORNER, 1);
  g.rect(x, y + h - CORNER, 1, CORNER);
  g.rect(x + w - CORNER, y + h - 1, CORNER, 1);
  g.rect(x + w - 1, y + h - CORNER, 1, CORNER);
  // Dashed run along the top and bottom between the brackets, 8 on / 8 off.
  for (let dx = CORNER + 8; dx < w - CORNER - 8; dx += 16) {
    if (!inLabelGap(x + dx, 8)) g.rect(x + dx, y, 8, 1);
    g.rect(x + dx, y + h - 1, 8, 1);
  }
  g.fill({ color });
  container.addChild(g);

  if (rendered) {
    const sprite = new Sprite(Texture.from(rendered.canvas));
    sprite.texture.source.scaleMode = 'nearest';
    sprite.x = labelX;
    sprite.y = y - Math.floor(rendered.height / 2);
    sprite.roundPixels = true;
    container.addChild(sprite);
  }

  for (const child of container.children) {
    if ('roundPixels' in child) (child as { roundPixels: boolean }).roundPixels = true;
  }
  return container;
}

/**
 * Selection overlay: four corner brackets in the room's signal colour, drawn as filled rects.
 * A real board marks a component's extents with silkscreen corners; this is the same idea, lit.
 */
export function buildSelectionOverlay(rect: { x: number; y: number; w: number; h: number }, color: string): Graphics {
  const g = new Graphics();
  const ARM = 5;
  const T = 1;
  const { x, y, w, h } = rect;
  // Brackets sit just OUTSIDE the footprint so they never hide the node's own pixels.
  const ox = x - 2, oy = y - 2, ow = w + 4, oh = h + 4;
  g.rect(ox, oy, ARM, T); g.rect(ox, oy, T, ARM);
  g.rect(ox + ow - ARM, oy, ARM, T); g.rect(ox + ow - T, oy, T, ARM);
  g.rect(ox, oy + oh - T, ARM, T); g.rect(ox, oy + oh - ARM, T, ARM);
  g.rect(ox + ow - ARM, oy + oh - T, ARM, T); g.rect(ox + ow - T, oy + oh - ARM, T, ARM);
  g.fill({ color: hexToNumber(color) });
  g.roundPixels = true;
  return g;
}

/**
 * Broken-target overlay: a hairline diagonal-free cross-hatch plus a fault-coloured border.
 * Prime directive 1 — "if it can't resolve, show it broken" — needs to be visible on the board,
 * not only in the inspector.
 */
export function buildBrokenOverlay(
  rect: { x: number; y: number; w: number; h: number },
  color: string
): Graphics {
  const g = new Graphics();
  const { x, y, w, h } = rect;
  // Fault border, 1px, inset by 1 so it reads as damage to the component and not as selection.
  g.rect(x + 1, y + 1, w - 2, 1);
  g.rect(x + 1, y + h - 2, w - 2, 1);
  g.rect(x + 1, y + 1, 1, h - 2);
  g.rect(x + w - 2, y + 1, 1, h - 2);
  // Stipple: dither, never a blur, never a diagonal. docs/02 anti-mush 6 and 7.
  //
  // Deliberately sparse, and skipping the middle band. A dense fill did read as "broken" but it
  // buried the reference designator, so you could see that something had failed and not which
  // component it was — which is the one thing the board needs to tell you.
  const labelTop = Math.floor(h / 2) - 7;
  const labelBottom = Math.floor(h / 2) + 7;
  for (let py = 3; py < h - 3; py += 6) {
    if (py >= labelTop && py <= labelBottom) continue;
    for (let px = 3 + ((py / 6) % 2) * 3; px < w - 3; px += 6) {
      g.rect(x + px, y + py, 2, 2);
    }
  }
  g.fill({ color: hexToNumber(color) });
  g.roundPixels = true;
  return g;
}
