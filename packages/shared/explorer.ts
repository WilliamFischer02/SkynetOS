/**
 * The explorer node: a retro file browser over one real folder on this disk.
 *
 * William: "a pixel art representation of file explorer within a folder that actually exists on my
 * disk — selectable by user — and browsing the files within looks like a pixel art / retro file
 * explorer but references real files / folders — the default / resting folder is selectable."
 *
 * Everything here is pure, so the one rule that matters can be tested without a disk: a listing
 * never leaves the node's root. `..`, a drive letter, a UNC path or an alternate data stream in a
 * relative path is refused before it is ever joined, and main checks the REAL path (junctions and
 * symlinks resolved) against the real root before it reads anything. See
 * src/main/services/explorer.ts for the disk half.
 */

export type ExplorerEntryKind = 'dir' | 'file';

export interface ExplorerEntry {
  name: string;
  kind: ExplorerEntryKind;
  /** Bytes, for a file. Null for a folder, or when the file could not be read. */
  size: number | null;
  /** Last modified, epoch ms. Null when unreadable. */
  mtime: number | null;
  /** Lowercase extension with the dot, e.g. `.pdf`. Empty for a folder or a bare name. */
  ext: string;
  /** A symlink or junction. Listed, but entering one that leads outside the root is refused. */
  link?: boolean;
}

export interface ExplorerListing {
  ok: boolean;
  /** The root as the board spells it (tokens intact), for display and for building `restPath`. */
  root: string;
  /** The folder listed, relative to the root, `/`-separated. Empty string is the root itself. */
  rel: string;
  /** The resting folder, relative to the root. Null when unset or unusable. */
  rest: string | null;
  entries: ExplorerEntry[];
  /** More entries than the listing cap; the rest were not read. */
  truncated: boolean;
  error?: string;
  /** Why a set `restPath` was not used — outside the root, or gone — so the window can say so. */
  restRefused?: string;
}

export type ExplorerSort = 'name' | 'date' | 'size';

/** Most entries one listing returns. A folder of a hundred thousand files is a folder to open in Explorer. */
export const EXPLORER_MAX_ENTRIES = 5000;

/**
 * The segments of a relative path, or null if it could step outside the root.
 *
 * Refused, not cleaned: a request for `a/../../etc` is a bug or an attack, and quietly turning it
 * into `etc` would answer a question nobody asked.
 */
export function splitRel(rel: string): string[] | null {
  const text = rel.replace(/\\/g, '/');
  // Absolute in any Windows spelling: `C:`, `/x`, `//server/share`.
  if (/^[A-Za-z]:/.test(text) || text.startsWith('/')) return null;
  const segments = text.split('/').filter((s) => s !== '' && s !== '.');
  for (const segment of segments) {
    if (segment === '..') return null;
    // `:` is an alternate data stream on NTFS (`file.txt:hidden`), never part of a real name.
    if (segment.includes(':')) return null;
    // Control characters are not in any name Explorer can make.
    if (/[\u0000-\u001f]/.test(segment)) return null;
  }
  return segments;
}

/** Forward slashes, no trailing slash (except a bare drive root, which keeps `C:/`'s meaning as `C:`). */
export function normaliseAbs(path: string): string {
  const out = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return out;
}

/** `root` joined with a relative path, or null if the relative path could escape. */
export function joinInside(root: string, rel: string): string | null {
  const segments = splitRel(rel);
  if (!segments) return null;
  const base = normaliseAbs(root);
  return segments.length ? `${base}/${segments.join('/')}` : base;
}

/** Is `candidate` the root or somewhere under it? Case-insensitive, because Windows paths are. */
export function isInside(root: string, candidate: string): boolean {
  const r = normaliseAbs(root).toLowerCase();
  const c = normaliseAbs(candidate).toLowerCase();
  return c === r || c.startsWith(`${r}/`);
}

/** `abs` relative to `root`, or null if it is not inside it. The root itself is `''`. */
export function relativeInside(root: string, abs: string): string | null {
  if (!isInside(root, abs)) return null;
  const r = normaliseAbs(root);
  const a = normaliseAbs(abs);
  return a.length === r.length ? '' : a.slice(r.length + 1);
}

/** One folder up, relative to the root. The root's parent is the root: the window never leaves it. */
export function parentRel(rel: string): string {
  const segments = splitRel(rel) ?? [];
  return segments.slice(0, -1).join('/');
}

/** Names Explorer hides by default, and so does this. */
export function isHiddenName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('.') || lower === 'desktop.ini' || lower === 'thumbs.db' ||
    lower === '$recycle.bin' || lower === 'system volume information';
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * Folders first, always — then by the chosen key. Ties fall back to the name so the order is stable
 * between two listings of the same folder.
 */
export function sortEntries(entries: readonly ExplorerEntry[], sort: ExplorerSort = 'name', descending = false): ExplorerEntry[] {
  const byName = (a: ExplorerEntry, b: ExplorerEntry): number =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const byKey = (a: ExplorerEntry, b: ExplorerEntry): number => {
    if (sort === 'date') return (a.mtime ?? -Infinity) - (b.mtime ?? -Infinity);
    if (sort === 'size') return (a.size ?? -1) - (b.size ?? -1);
    return byName(a, b);
  };
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    const primary = byKey(a, b) * (descending ? -1 : 1);
    return primary !== 0 ? primary : byName(a, b);
  });
}

export type ExplorerIcon =
  | 'folder' | 'doc' | 'text' | 'pdf' | 'image' | 'map' | 'data'
  | 'archive' | 'audio' | 'video' | 'code' | 'program' | 'unknown';

const ICON_BY_EXT: Record<string, ExplorerIcon> = {};
const register = (icon: ExplorerIcon, exts: string[]): void => { for (const e of exts) ICON_BY_EXT[`.${e}`] = icon; };
register('image', ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'heic', 'avif']);
register('map', ['kml', 'kmz', 'gpx', 'geojson', 'shp', 'tif', 'tiff', 'jp2', 'sid', 'dem', 'mbtiles']);
register('pdf', ['pdf']);
register('doc', ['doc', 'docx', 'odt', 'rtf', 'pages']);
register('text', ['txt', 'md', 'markdown', 'log', 'nfo']);
register('data', ['csv', 'tsv', 'xls', 'xlsx', 'ods', 'json', 'xml', 'yaml', 'yml', 'sqlite', 'db']);
register('archive', ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz']);
register('audio', ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma']);
register('video', ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v']);
register('code', ['js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'c', 'cpp', 'h', 'cs', 'java', 'rs', 'go', 'html', 'css', 'sh']);
register('program', ['exe', 'msi', 'bat', 'cmd', 'com', 'lnk', 'scr', 'ps1', 'appref-ms']);

/**
 * A picture or a PDF whose name says it is a map draws as a map. "Geography files like maps" are
 * mostly scanned sheets — a USGS quad is a PDF or a GeoTIFF — and the folded-map icon is the one
 * that says what they are at a glance.
 */
const MAP_NAME = /(^|[^a-z])(map|maps|topo|topographic|quad|quadrangle|atlas|usgs|sanborn)([^a-z]|$)/i;

export function iconFor(entry: Pick<ExplorerEntry, 'kind' | 'name' | 'ext'>): ExplorerIcon {
  if (entry.kind === 'dir') return 'folder';
  const icon = ICON_BY_EXT[entry.ext] ?? 'unknown';
  if ((icon === 'image' || icon === 'pdf') && MAP_NAME.test(entry.name)) return 'map';
  return icon;
}

/**
 * Extensions that RUN something rather than open a document. Opening one from the explorer is
 * confirmed every time, whoever asked — a research folder is where downloaded files live, and a
 * downloaded script is exactly the thing that should not start on a double-click.
 */
const RUNNABLE = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.msi', '.msp', '.scr', '.lnk', '.hta', '.cpl', '.reg', '.jar', '.pif', '.appref-ms', '.url'
]);

export function isRunnable(name: string): boolean {
  return RUNNABLE.has(extensionOf(name));
}

/** `12 B`, `4.2 KB`, `31 MB`: one decimal below ten, none above. */
export function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  if (unit === 0) return `${bytes} B`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
