/**
 * Where a path lives on the hologram's globe, forever.
 *
 * William, 2026-09-26: "all files, folders, and actions are assigned a permanent position
 * somewhere on the globe". Permanent means a pure function of the path, so the same file lands on
 * the same spot on every machine and after every restart, with no store needed to agree with
 * itself. (main/services/globe-atlas-store.ts still remembers the first answer, so that a later
 * change to THIS function can never move a pin William has learned.)
 *
 * The globe is a grid: 36 latitude bands between −80° and +80° (the poles are left empty, where a
 * gridded sphere pinches) by 72 longitude cells of 5°. The CELL comes from the parent folder's
 * hash, the position INSIDE the cell from the file's own, so the files of one folder cluster and a
 * folder reads as a small constellation rather than a scatter.
 */
import type { HoloKind } from './holo-scene.js';
import { normalisePath } from './usage.js';

export const LAT_BANDS = 36;
export const LON_CELLS = 72;
/** Highest latitude a pin may take, in degrees. */
export const MAX_LAT = 80;

const BAND_DEG = (2 * MAX_LAT) / LAT_BANDS;
const CELL_DEG = 360 / LON_CELLS;
/** Pins stay this far inside their cell's edges, so neighbours in adjacent cells never touch. */
const INSET = 0.12;

/** FNV-1a, 32-bit. Deterministic across runtimes; not for security. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The parent of a normalised path, or '' for a root. */
export function parentOf(path: string): string {
  const p = normalisePath(path);
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i);
}

export interface GlobeCoord { lat: number; lon: number }

export function coordFor(path: string): GlobeCoord {
  const p = normalisePath(path);
  const parent = parentOf(p);
  const cell = hash32(parent || p) % (LAT_BANDS * LON_CELLS);
  const band = Math.floor(cell / LON_CELLS);
  const col = cell % LON_CELLS;
  const j = hash32(`${p}#pin`);
  const jx = INSET + ((j & 0xffff) / 0xffff) * (1 - 2 * INSET);
  const jy = INSET + (((j >>> 16) & 0xffff) / 0xffff) * (1 - 2 * INSET);
  const lat = -MAX_LAT + (band + jy) * BAND_DEG;
  const lon = -180 + (col + jx) * CELL_DEG;
  return { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
}

/** The cell index a path's pin sits in. Two siblings share it. */
export function cellOf(path: string): number {
  const p = normalisePath(path);
  return hash32(parentOf(p) || p) % (LAT_BANDS * LON_CELLS);
}

const KIND_BY_EXT: Record<string, HoloKind> = {
  md: 'doc', txt: 'doc', docx: 'doc', doc: 'doc', pdf: 'doc', rtf: 'doc',
  ts: 'code', tsx: 'code', js: 'code', mjs: 'code', cjs: 'code', py: 'code', ps1: 'code', cpp: 'code',
  h: 'code', hpp: 'code', c: 'code', cs: 'code', java: 'code', json: 'code', yaml: 'code', yml: 'code',
  toml: 'code', css: 'code', html: 'code',
  obj: 'model', stl: 'model', gltf: 'model', glb: 'model', fbx: 'model', blend: 'model',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
  exe: 'exe', bat: 'exe', cmd: 'exe', lnk: 'exe', msi: 'exe'
};

/** The extension of a path, lower-case, without the dot; '' when there is none. */
export function extensionOf(path: string): string {
  const name = normalisePath(path).split('/').pop() ?? '';
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * What kind of thing a path is, by extension. A path that ends in a slash, or that the caller
 * knows to be a directory, is a folder; a bare name without an extension is `other` unless the
 * caller says it is a directory, because `Makefile` and `LICENSE` are files.
 */
export function kindOf(path: string, opts: { directory?: boolean } = {}): HoloKind {
  if (opts.directory || /[\\/]$/.test(path)) return 'folder';
  const ext = extensionOf(path);
  return KIND_BY_EXT[ext] ?? 'other';
}

/**
 * A file whose CONTENTS the globe must never draw, trusted root or not (2026-09-26 audit; the same
 * list the terminal drop hook refuses): env files, private keys and certificates, credential and
 * secret stores, and anything inside `.git/` or `node_modules/`. The pin and the name still show.
 */
const SECRET_NAME = /^(\.env(\..+)?|.+\.(pem|key|p12|pfx|jks|kdbx)|id_(rsa|dsa|ecdsa|ed25519)(\..+)?|credentials(\..+)?|secrets?(\..+)?|.*\.secret)$/i;

export function isSecretPath(path: string): boolean {
  const p = normalisePath(path);
  if (/(^|\/)(\.git|node_modules)\//.test(p)) return true;
  const name = p.split('/').pop() ?? '';
  return SECRET_NAME.test(name);
}
