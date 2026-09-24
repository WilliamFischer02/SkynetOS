import type { BoardNode } from './types.js';

/**
 * The JARVIS face windows: who gets one, where it sits, and when it talks. Pure.
 *
 * William: "when either is opened a tethered window will open that has equal priority / comes to
 * front / hides alongside the chat window with the JARVIS session … and close with the window as
 * well."
 *
 * Two kinds of window get a face, and they are tethered differently (src/main/services/avatar-window.ts):
 *   - the web Face (claude.ai in a SkynetOS window) — ours, so the face is an OWNED window;
 *   - a JARVIS Prime terminal (Windows Terminal) — not ours, so a tracker watches it by title.
 * Everything that can be decided without Electron or the OS is decided here, and tested.
 */

export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }
/** Where a face the user dragged sits relative to its window's top-left. */
export interface Offset { dx: number; dy: number }

export const AVATAR_WINDOW_SIZE: Size = { width: 220, height: 240 };
export const AVATAR_DOCK_GAP = 8;
/** A transcript written this recently means JARVIS is working or talking. */
export const SPEAKING_WINDOW_MS = 2500;
export const TRACKER_INTERVAL_MS = 250;

/**
 * Is this node a JARVIS iteration, i.e. does it get a face?
 *
 * The Face (`agent.jarvis`), JARVIS Prime (the Hands chip on the root board, `handsNodeId`), any
 * node tagged `jarvis`, and a conversation node named like JARVIS. Not every `agent.chat`: MC MIND
 * PALACE is a conversation, not JARVIS, and a face on it would say otherwise. `avatarWindow: false`
 * switches a node's face off; it never grants one to a node that is not JARVIS.
 */
export function isJarvisIteration(
  node: Pick<BoardNode, 'id' | 'kind' | 'name' | 'tags' | 'avatarWindow'>,
  handsNodeId: string | null
): boolean {
  if (node.avatarWindow === false) return false;
  if (node.tags?.some((t) => t.toLowerCase() === 'jarvis')) return true;
  if (node.kind === 'agent.jarvis') return true;
  if (node.kind === 'agent.chat') return /jarvis/i.test(node.name);
  if (node.kind === 'agent.code') return handsNodeId !== null && node.id === handsNodeId;
  return false;
}

function clampToArea(rect: Rect, area: Rect): Rect {
  const x = Math.max(area.x, Math.min(rect.x, area.x + area.width - rect.width));
  const y = Math.max(area.y, Math.min(rect.y, area.y + area.height - rect.height));
  return { x: Math.round(x), y: Math.round(y), width: rect.width, height: rect.height };
}

/**
 * Dock a face beside its window: to the LEFT, top-aligned, so it reads as the head of the
 * conversation. On the right when there is no room on the left; over the window's corner, inside
 * the work area, when there is room on neither side. Never off-screen.
 */
export function dockBeside(target: Rect, size: Size, workArea: Rect, gap = AVATAR_DOCK_GAP): Rect {
  const leftX = target.x - size.width - gap;
  const rightX = target.x + target.width + gap;
  let x: number;
  if (leftX >= workArea.x) x = leftX;
  else if (rightX + size.width <= workArea.x + workArea.width) x = rightX;
  else x = target.x;
  return clampToArea({ x, y: target.y, width: size.width, height: size.height }, workArea);
}

/** Docked, unless the user dragged the face somewhere: then it keeps that spot relative to the window. */
export function placeFace(target: Rect, size: Size, workArea: Rect, offset: Offset | null, gap = AVATAR_DOCK_GAP): Rect {
  if (!offset) return dockBeside(target, size, workArea, gap);
  return clampToArea({ x: target.x + offset.dx, y: target.y + offset.dy, width: size.width, height: size.height }, workArea);
}

export function offsetFrom(target: Rect, face: Rect): Offset {
  return { dx: Math.round(face.x - target.x), dy: Math.round(face.y - target.y) };
}

export function isSpeaking(lastWriteMs: number | null, now: number, windowMs = SPEAKING_WINDOW_MS): boolean {
  return lastWriteMs !== null && now - lastWriteMs >= 0 && now - lastWriteMs < windowMs;
}

/**
 * The exact ASCII transform services/launch-script.ts applies to a terminal's title (it writes an
 * ASCII-only script). The tracker looks for the title the terminal actually shows, so the two must
 * agree character for character; test/avatar-window.test.ts holds them to it.
 */
export function asciiTitle(value: string): string {
  return value
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[…]/g, '...')
    .replace(/[^\x20-\x7E]/g, '?');
}

/** The title a session's terminal carries: `SkynetOS — <designator> — <name>`, as ASCII. */
export function terminalTitleFragment(designator: string | null | undefined, name: string): string {
  return asciiTitle(`SkynetOS — ${designator ? designator + ' — ' : ''}${name}`);
}

/** One tracked window, as the tracker helper reports it. Physical pixels. */
export interface TrackedWindow {
  fragment: string;
  found: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  visible: boolean;
  foreground: boolean;
}

/** One line of the tracker helper's output: a JSON array (or, from PowerShell's quirks, one object). */
export function parseTrackerLine(line: string): TrackedWindow[] | null {
  const text = line.trim();
  if (!text) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const list = Array.isArray(raw) ? raw : [raw];
  const out: TrackedWindow[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o['f'] !== 'string') continue;
    const num = (k: string): number => {
      const v = o[k];
      return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
    };
    const found = o['found'] === true;
    out.push({
      fragment: o['f'],
      found,
      x: num('x'),
      y: num('y'),
      width: num('w'),
      height: num('h'),
      minimized: found && o['min'] === true,
      visible: found && o['vis'] !== false,
      foreground: found && o['fg'] === true
    });
  }
  return out;
}

/**
 * Is claude.ai streaming a response right now? A READ-ONLY question put to the page.
 *
 * It looks; it never clicks, types or dispatches anything. The same observation a person makes
 * glancing at the window, which is why it is allowed next to docs/07's rule that only William's
 * Enter may put text into the conversation. Several signals, because the page's markup is not
 * ours and moves: the stop button, a streaming flag on a message, a busy region.
 */
export function streamingProbeScript(): string {
  return `(() => {
  if (document.readyState !== 'complete') return false;
  const q = (s) => { try { return document.querySelector(s); } catch (e) { return null; } };
  const stop = q('button[aria-label="Stop response"]') || q('button[aria-label^="Stop"]') || q('[data-testid="stop-button"]');
  const streaming = q('[data-is-streaming="true"]');
  const busy = q('main [aria-busy="true"]');
  return Boolean(stop || streaming || busy);
})()`;
}
