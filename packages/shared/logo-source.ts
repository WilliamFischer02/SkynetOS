import type { BoardNode, Footprint } from './types.js';
import { logoBoxTiles } from './types.js';

/**
 * Where a node's logo badge comes from.
 *
 * William: "I also want to be able to add a persistent version of this face graphic as the logo
 * image for the U1 jarvis node … where I can hide the logo or replace it with a persistent face of
 * jarvis." And later: "on a node I can select the animated robot face as a logo instead of an image
 * file and it uses the box it generates for the typical window but as a logo graphic."
 *
 *   file         the node's own `logo` image (the default; today's behaviour)
 *   avatar       the JARVIS avatar's still face, assets/avatar/jarvis/idle.png, dithered onto the
 *                room's palette like any logo
 *   avatar-live  the ANIMATED face in the face window's own box: dark ground, the frames in their
 *                true colours, the float, the blinks and the talking. Drawn live by the board, not
 *                baked into the node's texture. docs/02 records it as a user-chosen exception.
 *   none         no logo, said explicitly
 *
 * `showLogo: false` still wins over all four: it is the on/off switch, and `logoSource` only says
 * what is drawn when it is on. So there is exactly one way to hide a logo temporarily (the switch,
 * which keeps the chosen source) and one way to say a node has none (`none`); neither can
 * contradict the other.
 *
 * Pure. The avatar's frames are looked up by the caller and passed in as a function, so a node
 * that is not asking for the avatar never touches the frames folder.
 */

export const LOGO_SOURCES = ['file', 'avatar', 'avatar-live', 'none'] as const;
export type LogoSource = (typeof LOGO_SOURCES)[number];

/** What the editor shows for each value. The values are what the board file stores. */
export const LOGO_SOURCE_LABELS: Record<LogoSource, string> = {
  file: 'Logo image',
  avatar: 'JARVIS face (still)',
  'avatar-live': 'JARVIS face (animated)',
  none: 'None'
};

export const AVATAR_LOGO_MISSING = 'AVATAR HAS NO idle.png YET — drop frames in assets/avatar/jarvis';
export const AVATAR_LIVE_LOGO = 'DRAWN LIVE BY THE BOARD — the animated JARVIS face';

export function logoSourceOf(node: Pick<BoardNode, 'logoSource'>): LogoSource {
  const value = node.logoSource;
  return value === 'avatar' || value === 'avatar-live' || value === 'none' ? value : 'file';
}

/** Does this node show the animated face in its logo box right now? */
export function isLiveAvatarLogo(node: Pick<BoardNode, 'logoSource' | 'showLogo'>): boolean {
  return node.showLogo !== false && logoSourceOf(node) === 'avatar-live';
}

/**
 * The image a node's logo slot draws, or null with the reason. `avatarIdle` returns the absolute
 * path of the avatar's idle.png, or null while there is none. `avatar-live` has no image to bake:
 * the board draws it itself, so the mosaic is told so rather than handed a file.
 */
export function logoPathFor(
  node: Pick<BoardNode, 'logo' | 'logoSource' | 'showLogo'>,
  avatarIdle: () => string | null
): { path: string | null; reason: string | null } {
  if (node.showLogo === false) return { path: null, reason: 'LOGO HIDDEN (Show logo is off)' };
  switch (logoSourceOf(node)) {
    case 'none':
      return { path: null, reason: 'NO LOGO (Logo source: none)' };
    case 'avatar-live':
      return { path: null, reason: AVATAR_LIVE_LOGO };
    case 'avatar': {
      const path = avatarIdle();
      return path ? { path, reason: null } : { path: null, reason: AVATAR_LOGO_MISSING };
    }
    default:
      return node.logo ? { path: node.logo, reason: null } : { path: null, reason: 'NO LOGO SET' };
  }
}

/**
 * The renderer's cache identity for the baked logo slot, or undefined when nothing is to be baked.
 *
 * `avatarStamp` changes whenever the frames folder does, so a replaced idle.png is a new key and
 * gets refetched; main's mosaic cache is keyed on the file's mtime and size, so it re-dithers too.
 * `avatar-live` is undefined here because it is not baked: see `isLiveAvatarLogo`.
 */
export function logoCacheSource(
  node: Pick<BoardNode, 'logo' | 'logoSource' | 'showLogo'>,
  avatarStamp: number
): string | undefined {
  if (node.showLogo === false) return undefined;
  const source = logoSourceOf(node);
  if (source === 'none' || source === 'avatar-live') return undefined;
  if (source === 'avatar') return `avatar:jarvis#${avatarStamp}`;
  return node.logo || undefined;
}

/**
 * The logo box, in world pixels: the most room a badge may take on this node.
 *
 * One definition, shared by the mosaic (which fits a baked logo inside it) and the board (which
 * draws the live face's box at exactly this size), so the animated face sits where a logo would.
 * The footprint suggests a size, `logoScale` adjusts it, and it never exceeds the node's face less
 * the two-pixel bevel on each side.
 */
export function logoBoxPx(fp: Footprint, logoScale: number | undefined, tile: number): { width: number; height: number } {
  const suggested = Math.max(16, logoBoxTiles(fp) * tile);
  const percent = Math.min(300, Math.max(10, logoScale ?? 100));
  const box = Math.max(8, Math.round((suggested * percent) / 100));
  const limitW = Math.max(8, fp.w * tile - 4);
  const limitH = Math.max(8, fp.h * tile - 4);
  return { width: Math.min(box, limitW), height: Math.min(box, limitH) };
}
