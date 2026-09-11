/**
 * Opening an online document in the DESKTOP Office app instead of a browser tab.
 *
 * William: "many of my word docs are hosted in onedrive so instead of a hard drive directory they
 * have an https address."
 *
 * A document behind a URL opens in the browser by default, which always works and is Word Online.
 * Office also registers a family of URI schemes that hand the same URL to the installed desktop
 * app — `ms-word:ofe|u|<url>` — and for a long document that is a materially better experience:
 * real Word, real track changes, offline caching, no tab.
 *
 * ── Why this returns null rather than guessing ───────────────────────────────────────────────
 *
 * The scheme is chosen by the FILE TYPE, and the only honest source for that is the extension in
 * the URL's path. A SharePoint URL ending `/Novel.docx` is unambiguous. A OneDrive share link —
 * `https://1drv.ms/w/s!Ab3...`, or a `/:w:/g/personal/.../Ee7...` URL — is a redirect with no
 * extension, and Office cannot follow one: it opens a dialog saying the document could not be
 * found, and does NOT fall back to the browser.
 *
 * So a URL this cannot read returns null and the caller opens the browser instead. A wrong guess
 * here is not a cosmetic miss; it is a dead end with an error dialog on it.
 */

/** The Office URI scheme for a file extension, or null if it is not an Office document. */
const SCHEME_BY_EXTENSION: Record<string, string> = {
  doc: 'ms-word', docx: 'ms-word', docm: 'ms-word', dot: 'ms-word', dotx: 'ms-word',
  odt: 'ms-word', rtf: 'ms-word',
  xls: 'ms-excel', xlsx: 'ms-excel', xlsm: 'ms-excel', xlsb: 'ms-excel', csv: 'ms-excel',
  ods: 'ms-excel',
  ppt: 'ms-powerpoint', pptx: 'ms-powerpoint', pptm: 'ms-powerpoint', odp: 'ms-powerpoint',
  vsd: 'ms-visio', vsdx: 'ms-visio',
  one: 'onenote'
};

/**
 * The extension in an http(s) URL's PATH, lowercased, or null.
 *
 * Two traps, both closed here:
 *
 * 1. **The query string.** SharePoint appends `?d=w4f2...&csf=1&web=1` to nearly every link it
 *    generates, and a naive "text after the last dot" reads `1` out of `web=1`.
 * 2. **Windows paths parse as URLs.** `new URL('C:/Users/w/Novel.docx')` does not throw — the
 *    WHATWG parser reads `c:` as a scheme and hands back a pathname of
 *    `/Users/w/Novel.docx`. So a local file would confidently report `docx` and be treated as a
 *    document URL. The scheme check is what stops that, and it belongs here rather than in each
 *    caller.
 */
export function urlExtension(url: string): string | null {
  if (!/^https?:\/\//i.test(url.trim())) return null;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  if (dot <= 0 || dot === last.length - 1) return null;
  return decodeURIComponent(last.slice(dot + 1)).toLowerCase();
}

/**
 * `ms-word:ofe|u|<url>` for a document URL, or null when the type cannot be told from the URL.
 *
 * `ofe` is "open for edit". The URL is NOT encoded — the scheme takes it raw after `|u|`, and
 * percent-encoding it is the most common way to make this silently stop working.
 */
export function officeUri(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  const extension = urlExtension(trimmed);
  if (!extension) return null;

  const scheme = SCHEME_BY_EXTENSION[extension];
  if (!scheme) return null;

  return `${scheme}:ofe|u|${trimmed}`;
}

/**
 * Why `officeUri` said no, phrased for a person.
 *
 * A refusal the user cannot act on is worse than no feature: "it opened in the browser again"
 * with no explanation is exactly the kind of thing that gets filed as broken.
 */
export function officeRefusal(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return 'NOT AN HTTP URL';

  const extension = urlExtension(trimmed);
  if (!extension) {
    return 'THIS IS A SHARE LINK, NOT A DIRECT DOCUMENT URL — ' +
      'desktop Office cannot follow a redirect. In OneDrive or SharePoint, open the file, then ' +
      'copy the address bar URL (it ends in .docx). Opened in the browser instead.';
  }
  return `"${extension}" IS NOT AN OFFICE DOCUMENT TYPE — opened in the browser instead.`;
}
