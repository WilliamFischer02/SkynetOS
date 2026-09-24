/**
 * The pure half of tools/fetch-research.mjs: naming, arguments, and the provenance manifest.
 *
 * Kept apart from the network code so it can be tested without touching the internet. Every
 * function here is deterministic and throws a legible Error rather than guessing.
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const WINDOWS_FORBIDDEN = '<>:"/\\|?*';
const MAX_NAME = 120;

/** Content types worth giving an extension to, when the URL did not carry one. */
const EXTENSIONS = {
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/geo+json': '.geojson',
  'text/html': '.html',
  'text/plain': '.txt',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/tiff': '.tif',
  'image/gif': '.gif',
  'application/zip': '.zip',
  'application/xml': '.xml',
  'text/xml': '.xml'
};

/** A name Windows, macOS and git will all accept. Never empty, never a path. */
export function sanitizeFilename(raw) {
  // Path separators, every character Windows forbids, and control characters all become '-'.
  let name = Array.from(String(raw ?? ''), (c) => (c.charCodeAt(0) < 32 || WINDOWS_FORBIDDEN.includes(c) ? '-' : c)).join('')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    // Leading dots would hide the file; trailing dots and spaces Windows silently strips.
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '');
  if (!name) name = 'download';
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let safeStem = WINDOWS_RESERVED.test(stem) ? `${stem}_` : stem;
  if (safeStem.length + ext.length > MAX_NAME) safeStem = safeStem.slice(0, Math.max(1, MAX_NAME - ext.length));
  return safeStem + ext;
}

/** The extension a content type implies, or '' when it implies none worth adding. */
export function extensionFor(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[type] ?? '';
}

/**
 * True when the server answered with a web page but the file is named as data (.csv, .pdf…).
 *
 * The failure this exists for: NCEI's storm-events export and the Census API both answer a bad
 * or keyless request with 200 and an HTML page — an app shell, a "Missing Key" notice — and the
 * first version of this tool saved one of them as `…csv`. A research folder must never hold a
 * file whose name lies about what it is.
 */
export function suspectHtml(file, contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'text/html' && type !== 'application/xhtml+xml') return false;
  return !/\.(html?|xhtml)$/i.test(file);
}

/** `filename=` or RFC 5987 `filename*=` out of a Content-Disposition header, or null. */
export function filenameFromDisposition(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  if (plain) return (plain[2] ?? plain[1]).trim();
  return null;
}

/** The last path segment of a URL, decoded, or null when the path ends in a slash. */
export function filenameFromUrl(url) {
  const path = new URL(url).pathname;
  const last = path.split('/').filter(Boolean).pop();
  if (!last) return null;
  try { return decodeURIComponent(last); } catch { return last; }
}

/**
 * Pick the saved name: an explicit --name wins, then the server's own name, then the URL's.
 * An extension is appended from the content type only when the chosen name has none.
 */
export function chooseFilename({ explicit, disposition, url, contentType }) {
  const picked = explicit || filenameFromDisposition(disposition) || filenameFromUrl(url) || 'download';
  let name = sanitizeFilename(picked);
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) name += extensionFor(contentType);
  return name;
}

export const DEFAULT_MAX_MB = 50;

const USAGE = [
  'usage: node tools/fetch-research.mjs <url> <destDir> [--name file] [--license "..."] [--note "..."] [--max-mb 50] [--allow-html]',
  '       node tools/fetch-research.mjs --restore <dir>   (re-download every SOURCES.json entry missing under <dir>)'
].join('\n');

/** argv (without node and the script) → options. Throws with a usage line on anything wrong. */
export function parseArgs(argv) {
  if (argv[0] === '--restore') {
    if (argv.length !== 2) throw new Error(USAGE);
    return { mode: 'restore', dir: argv[1] };
  }
  const positional = [];
  const options = { name: null, license: null, note: null, maxMb: DEFAULT_MAX_MB, allowHtml: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-html') { options.allowHtml = true; continue; }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value\n${USAGE}`);
      i++;
      if (key === 'name') options.name = value;
      else if (key === 'license') options.license = value;
      else if (key === 'note') options.note = value;
      else if (key === 'max-mb') {
        const mb = Number(value);
        if (!Number.isFinite(mb) || mb <= 0) throw new Error(`--max-mb must be a positive number\n${USAGE}`);
        options.maxMb = mb;
      } else throw new Error(`unknown flag ${arg}\n${USAGE}`);
    } else positional.push(arg);
  }
  if (positional.length !== 2) throw new Error(USAGE);
  const [url, destDir] = positional;
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`not a URL: ${url}\n${USAGE}`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`only http and https are fetched, not ${parsed.protocol}`);
  }
  return { mode: 'fetch', url: parsed.href, destDir, ...options };
}

/** Parse a SOURCES.json text into its entries, refusing anything that is not an array. */
export function readManifest(text) {
  if (text === null || text.trim() === '') return [];
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('SOURCES.json is not valid JSON; fix it by hand, it was not touched'); }
  if (!Array.isArray(parsed)) throw new Error('SOURCES.json is not a JSON array; fix it by hand, it was not touched');
  return parsed;
}

/**
 * Append one entry to a SOURCES.json manifest's text. `existingText` is null when the file does not
 * exist yet. A manifest that is not a JSON array is refused, not replaced: it is somebody's record.
 */
export function mergeManifest(existingText, entry) {
  return JSON.stringify([...readManifest(existingText), entry], null, 2) + '\n';
}

/**
 * Which manifest entries are missing on this machine and can be fetched again.
 *
 * What makes a git-ignored research binary safe to leave out of the repo: the manifest travels,
 * and it names the URL and the sha256 of exactly what was saved. `exists` is injected so this
 * stays pure. Entries without a URL, a file name or a hash cannot be restored faithfully and
 * are reported, never guessed at.
 */
export function restorePlan(manifestText, exists) {
  const fetch = [];
  const skipped = [];
  for (const entry of readManifest(manifestText)) {
    const url = entry?.finalUrl || entry?.url;
    const file = entry?.file;
    if (!url || !file || !entry?.sha256) { skipped.push({ file: file ?? '(unnamed)', reason: 'entry lacks a url, file or sha256' }); continue; }
    if (sanitizeFilename(file) !== file) { skipped.push({ file, reason: 'file name is not a plain name' }); continue; }
    if (!exists(file)) fetch.push({ url, file, sha256: entry.sha256, bytes: Number(entry.bytes) || 0 });
  }
  return { fetch, skipped };
}
