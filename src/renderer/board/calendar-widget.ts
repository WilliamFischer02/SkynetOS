/**
 * The calendar pane's painter: a `panel.calendar` node's face, from schedule/calendar.json.
 *
 * The layout is packages/shared/calendar-face.ts (pure, held by test/calendar-face.test.ts); this
 * file only turns its ops into pixels on a canvas the size of the footprint at 1x, exactly as
 * monitor-widget.ts does for the PSU. The sprite store draws that canvas as the node's face and the
 * board's whole-number zoom scales it, so the pane is as crisp at 4x as the rest of the board.
 *
 * Six colours, the room's own (see calendar-face.ts § Six colours): mask-dark, mask-light, copper,
 * copper-dark, silk, signal. Text is the board's silkscreen, Departure Mono at 11 px, binary alpha.
 */
import {
  calendarOptions,
  layoutCalendarFace,
  type CalendarFaceInput,
  type FaceColor,
  type FaceOp
} from '@shared/calendar-face.js';
import { COPPER, COPPER_DARK, SILK } from '@shared/palette.js';
import type { BoardNode } from '@shared/types.js';
import { measureSilkText, renderSilkText } from './silkscreen.js';

export function measureCalendarText(text: string): number {
  return measureSilkText(text, 11);
}

function colorOf(color: FaceColor, theme: { maskDark: string; maskLight: string; signal: string }): string {
  switch (color) {
    case 'screen': return theme.maskDark;
    case 'panel': return theme.maskLight;
    case 'copper': return COPPER;
    case 'dim': return COPPER_DARK;
    case 'silk': return SILK;
    case 'signal': return theme.signal;
  }
}

function paint(ctx: CanvasRenderingContext2D, op: FaceOp, fill: string): void {
  ctx.fillStyle = fill;
  switch (op.t) {
    case 'rect':
      ctx.fillRect(op.x, op.y, op.w, op.h);
      return;
    case 'text':
      ctx.drawImage(renderSilkText(op.text, 11, fill).canvas, op.x, op.y);
      return;
    case 'dash':
      for (let x = op.x; x < op.x + op.w; x += 2) ctx.fillRect(x, op.y, 1, 1);
      return;
    case 'dots':
      for (let y = op.y; y < op.y + op.h; y += op.step) {
        for (let x = op.x; x < op.x + op.w; x += op.step) ctx.fillRect(x, y, 1, 1);
      }
      return;
    case 'hatch':
      // Single pixels where (x + y) is a multiple of the step: a staircase at 45°, whole pixels only.
      for (let y = op.y; y < op.y + op.h; y++) {
        const first = op.x + ((op.step - ((op.x + y) % op.step)) % op.step);
        for (let x = first; x < op.x + op.w; x += op.step) ctx.fillRect(x, y, 1, 1);
      }
      return;
  }
}

let revision = 0;

/**
 * Bring a pane's face up to date. Returns the canvas to use and whether it changed. Nothing is
 * repainted, and no new texture is asked for, when the ops come out the same as last time: the NOW
 * line moves one pixel every few minutes, so most one-minute ticks change nothing.
 */
export function updateCalendarFace(
  previous: HTMLCanvasElement | undefined,
  slot: string,
  input: CalendarFaceInput,
  node: Pick<BoardNode, 'days' | 'start' | 'showHours' | 'compact'>,
  w: number,
  h: number,
  theme: { maskDark: string; maskLight: string; signal: string },
  now: number
): { canvas: HTMLCanvasElement; changed: boolean } {
  const ops = layoutCalendarFace(w, h, input, calendarOptions(node), now, measureCalendarText);
  const signature = `${w}x${h}|${theme.maskDark}|${theme.maskLight}|${theme.signal}|${JSON.stringify(ops)}`;
  if (previous && previous.dataset['widgetSig'] === signature) return { canvas: previous, changed: false };

  const canvas = previous ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, changed: false };
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  for (const op of ops) paint(ctx, op, colorOf(op.color, theme));
  canvas.dataset['widgetSig'] = signature;
  canvas.dataset['liveFace'] = slot;
  canvas.dataset['glowKey'] = `calendar:${slot}:${++revision}`;
  return { canvas, changed: true };
}
