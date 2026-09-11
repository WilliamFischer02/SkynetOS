import { describe, expect, it } from 'vitest';
import { officeRefusal, officeUri, urlExtension } from '../packages/shared/office.js';
import { missingRequired, primaryTargetField } from '../packages/shared/node-fields.js';
import type { BoardNode } from '../packages/shared/types.js';

/**
 * Documents that live behind a URL.
 *
 * William: "many of my word docs are hosted in onedrive so instead of a hard drive directory they
 * have an https address."
 */

describe('urlExtension', () => {
  it('reads the extension out of the path', () => {
    expect(urlExtension('https://contoso-my.sharepoint.com/personal/w/Documents/Novel.docx')).toBe('docx');
  });

  it('ignores the query string', () => {
    /*
     * The case that would have broken it. SharePoint appends `?d=w4f2...&csf=1&web=1` to nearly
     * every link it generates, and "text after the last dot" reads `1` out of `web=1`.
     */
    expect(urlExtension('https://contoso-my.sharepoint.com/x/Novel.docx?d=w4f2a&csf=1&web=1&e=Xy7')).toBe('docx');
    expect(urlExtension('https://example.com/path/to/page?v=1.2')).toBeNull();
  });

  it('decodes a percent-encoded name', () => {
    expect(urlExtension('https://example.com/My%20Novel%20Draft.docx')).toBe('docx');
  });

  it('finds nothing in a share link', () => {
    // These are redirects with no file name in them at all.
    expect(urlExtension('https://1drv.ms/w/s!AbCdEfGhIjKlMnOp')).toBeNull();
    expect(urlExtension('https://contoso-my.sharepoint.com/:w:/g/personal/w/Ee7xKq2')).toBeNull();
  });

  it('survives a string that is not a URL', () => {
    expect(urlExtension('C:/Users/w/Documents/Novel.docx')).toBeNull();
    expect(urlExtension('')).toBeNull();
    expect(urlExtension('not a url at all')).toBeNull();
  });

  it('ignores a dot that is not an extension', () => {
    expect(urlExtension('https://example.com/files/')).toBeNull();
    expect(urlExtension('https://example.com/.hidden')).toBeNull();
    expect(urlExtension('https://example.com/trailing.')).toBeNull();
  });
});

describe('officeUri', () => {
  it('builds an ms-word URI for a Word document', () => {
    const url = 'https://contoso-my.sharepoint.com/personal/w/Documents/Novel.docx';
    expect(officeUri(url)).toBe(`ms-word:ofe|u|${url}`);
  });

  it('picks the right app per type', () => {
    expect(officeUri('https://x.com/a.xlsx')).toContain('ms-excel:ofe|u|');
    expect(officeUri('https://x.com/a.pptx')).toContain('ms-powerpoint:ofe|u|');
    expect(officeUri('https://x.com/a.doc')).toContain('ms-word:ofe|u|');
  });

  it('leaves the URL raw, query string and all', () => {
    /*
     * The scheme takes the URL verbatim after `|u|`. Percent-encoding it is the most common way to
     * make this silently stop working — Office receives a mangled address and reports that the
     * document does not exist.
     */
    const url = 'https://x.sharepoint.com/My%20Doc.docx?d=w1&csf=1&web=1';
    expect(officeUri(url)).toBe(`ms-word:ofe|u|${url}`);
  });

  it('refuses a share link rather than guessing', () => {
    // Office cannot follow a redirect. It fails with a dialog and does NOT fall back, so guessing
    // "probably Word" here would turn a working browser open into a dead end.
    expect(officeUri('https://1drv.ms/w/s!AbCdEf')).toBeNull();
    expect(officeUri('https://contoso-my.sharepoint.com/:w:/g/personal/w/Ee7')).toBeNull();
  });

  it('refuses a non-Office file and a non-URL', () => {
    expect(officeUri('https://x.com/photo.png')).toBeNull();
    expect(officeUri('C:/Users/w/Novel.docx')).toBeNull();
    expect(officeUri('ftp://x.com/a.docx')).toBeNull();
  });
});

describe('officeRefusal explains itself', () => {
  it('names the share-link problem and what to do about it', () => {
    const reason = officeRefusal('https://1drv.ms/w/s!AbCdEf');
    expect(reason).toContain('SHARE LINK');
    expect(reason).toContain('.docx');
    expect(reason).toContain('browser');
  });

  it('names the type when the type is simply wrong', () => {
    expect(officeRefusal('https://x.com/photo.png')).toContain('png');
  });
});

/**
 * ── A document is bound by a path OR a url ───────────────────────────────────────────────────
 *
 * Forcing `path` would mean either a second node kind for the same thing, or a node that renders
 * broken forever. `requiredOneOf` is how the form and the schema agree on "one of these two".
 */
describe('file.document takes either binding', () => {
  const doc = (fields: Partial<BoardNode>): BoardNode =>
    ({ id: 'f1', kind: 'file.document', name: 'NOVEL', pos: { x: 0, y: 0 }, ...fields }) as BoardNode;

  it('resolves against the filesystem when it has a path', () => {
    const field = primaryTargetField('file.document', doc({ path: 'C:/Users/w/Novel.docx' }));
    expect(field?.key).toBe('path');
    expect(field?.control).toBe('path-file');
  });

  it('resolves against the URL when it has only a url', () => {
    // The half that matters: without the node, this would guess `path` and look for a OneDrive
    // document on disk, which renders it broken forever.
    const field = primaryTargetField('file.document', doc({ url: 'https://x.sharepoint.com/a.docx' }));
    expect(field?.key).toBe('url');
    expect(field?.control).toBe('url');
  });

  it('prefers the path when a node somehow has both', () => {
    // A local file opens instantly in the desktop app and works offline. If both are filled in,
    // the one on this machine wins.
    const field = primaryTargetField('file.document', doc({ path: 'C:/a.docx', url: 'https://x.com/a.docx' }));
    expect(field?.key).toBe('path');
  });

  it('treats a whitespace-only value as unfilled', () => {
    const field = primaryTargetField('file.document', doc({ path: '   ', url: 'https://x.sharepoint.com/a.docx' }));
    expect(field?.key).toBe('url');
  });

  it('accepts a node with either one filled in', () => {
    expect(missingRequired(doc({ path: 'C:/a.docx' }))).toEqual([]);
    expect(missingRequired(doc({ url: 'https://x.sharepoint.com/a.docx' }))).toEqual([]);
  });

  it('reports the whole group when neither is filled', () => {
    // Naming one arbitrarily would tell the user to fill in a path when a URL would have done.
    const missing = missingRequired(doc({})).map((f) => f.key);
    expect(missing).toContain('path');
    expect(missing).toContain('url');
  });

  it('still demands the fields other kinds require', () => {
    const repo = { id: 's1', kind: 'store.repo', name: 'R', pos: { x: 0, y: 0 } } as BoardNode;
    expect(missingRequired(repo).map((f) => f.key)).toContain('path');
  });
});
