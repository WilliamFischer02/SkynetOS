import { describe, expect, it } from 'vitest';
import {
  chooseFilename,
  extensionFor,
  filenameFromDisposition,
  filenameFromUrl,
  mergeManifest,
  parseArgs,
  restorePlan,
  sanitizeFilename,
  suspectHtml
} from '../tools/fetch-research-lib.mjs';

describe('fetch-research naming', () => {
  it('strips every character Windows refuses, and path separators', () => {
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j.pdf')).toBe('a-b-c-d-e-f-g-h-i-j.pdf');
  });

  it('turns control characters into dashes', () => {
    expect(sanitizeFilename(`a${String.fromCharCode(0)}b${String.fromCharCode(31)}c.txt`)).toBe('a-b-c.txt');
  });

  it('never returns an empty or hidden name', () => {
    expect(sanitizeFilename('')).toBe('download');
    expect(sanitizeFilename('...')).toBe('download');
    expect(sanitizeFilename('.env')).toBe('env');
  });

  it('suffixes names Windows reserves', () => {
    expect(sanitizeFilename('CON.txt')).toBe('CON_.txt');
    expect(sanitizeFilename('lpt1')).toBe('lpt1_');
  });

  it('caps the length but keeps the extension', () => {
    const name = sanitizeFilename(`${'x'.repeat(300)}.pdf`);
    expect(name.length).toBe(120);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('reads RFC 5987 and plain Content-Disposition names', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''Escondido%201994.csv")).toBe('Escondido 1994.csv');
    expect(filenameFromDisposition('attachment; filename="topo.pdf"')).toBe('topo.pdf');
    expect(filenameFromDisposition(null)).toBeNull();
  });

  it('takes the decoded last path segment of a URL', () => {
    expect(filenameFromUrl('https://x.test/a/CA_Valley%20Center_1996.pdf')).toBe('CA_Valley Center_1996.pdf');
    expect(filenameFromUrl('https://x.test/')).toBeNull();
  });

  it('prefers an explicit name, and adds an extension only when missing', () => {
    expect(chooseFilename({ explicit: 'weather 1994', url: 'https://x.test/data', contentType: 'text/csv; charset=utf-8' })).toBe('weather-1994.csv');
    expect(chooseFilename({ url: 'https://x.test/map.pdf', contentType: 'application/octet-stream' })).toBe('map.pdf');
    expect(chooseFilename({ url: 'https://x.test/', contentType: 'text/html' })).toBe('download.html');
    expect(extensionFor('application/x-unknown')).toBe('');
  });

  it('flags a web page arriving under a data name, and only then', () => {
    // The real failure: NCEI's storm-events export answered with its app shell, saved as .csv.
    expect(suspectHtml('storm-events.csv', 'text/html; charset=utf-8')).toBe(true);
    expect(suspectHtml('report.pdf', 'text/html')).toBe(true);
    expect(suspectHtml('penal-code.html', 'text/html')).toBe(false);
    expect(suspectHtml('storm-events.csv', 'text/csv')).toBe(false);
    expect(suspectHtml('map.pdf', null)).toBe(false);
  });
});

describe('fetch-research arguments', () => {
  it('parses a url, a folder and flags', () => {
    const options = parseArgs(['https://x.test/a.pdf', 'out', '--license', 'Public domain', '--max-mb', '80']);
    expect(options).toMatchObject({ mode: 'fetch', url: 'https://x.test/a.pdf', destDir: 'out', license: 'Public domain', maxMb: 80, name: null, allowHtml: false });
    expect(parseArgs(['https://x.test/a', 'out', '--allow-html'])).toMatchObject({ allowHtml: true });
  });

  it('parses restore mode', () => {
    expect(parseArgs(['--restore', 'research'])).toEqual({ mode: 'restore', dir: 'research' });
    expect(() => parseArgs(['--restore'])).toThrow(/usage/);
  });

  it('refuses anything that is not http or https', () => {
    expect(() => parseArgs(['file:///C:/secret.txt', 'out'])).toThrow(/only http and https/);
    expect(() => parseArgs(['ftp://x.test/a', 'out'])).toThrow(/only http and https/);
  });

  it('refuses a missing folder, a flag without a value, and unknown flags', () => {
    expect(() => parseArgs(['https://x.test/a'])).toThrow(/usage/);
    expect(() => parseArgs(['https://x.test/a', 'out', '--note'])).toThrow(/needs a value/);
    expect(() => parseArgs(['https://x.test/a', 'out', '--force', 'yes'])).toThrow(/unknown flag/);
  });
});

describe('fetch-research manifest', () => {
  const entry = { url: 'https://x.test/a.pdf', file: 'a.pdf', bytes: 3 };

  it('starts a manifest and appends to one', () => {
    const first = mergeManifest(null, entry);
    expect(JSON.parse(first)).toEqual([entry]);
    const second = mergeManifest(first, { ...entry, file: 'b.pdf' });
    expect(JSON.parse(second).map((e: { file: string }) => e.file)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('refuses to rewrite a manifest it cannot read', () => {
    expect(() => mergeManifest('{ not json', entry)).toThrow(/not valid JSON/);
    expect(() => mergeManifest('{"a":1}', entry)).toThrow(/not a JSON array/);
  });
});

describe('fetch-research restore plan', () => {
  const manifest = JSON.stringify([
    { url: 'https://x.test/a.pdf', finalUrl: 'https://cdn.x.test/a.pdf', file: 'a.pdf', bytes: 10, sha256: 'aa' },
    { url: 'https://x.test/b.pdf', file: 'b.pdf', bytes: 20, sha256: 'bb' },
    { url: 'https://x.test/c.pdf', file: 'c.pdf', bytes: 5 },
    { url: 'https://x.test/d.pdf', file: '../escape.pdf', sha256: 'dd' }
  ]);

  it('fetches only what is missing, from the final URL, with the recorded hash', () => {
    const plan = restorePlan(manifest, (file) => file === 'b.pdf');
    expect(plan.fetch).toEqual([{ url: 'https://cdn.x.test/a.pdf', file: 'a.pdf', sha256: 'aa', bytes: 10 }]);
  });

  it('reports entries it cannot restore faithfully instead of guessing', () => {
    const plan = restorePlan(manifest, () => false);
    expect(plan.skipped.map((s) => s.file)).toEqual(['c.pdf', '../escape.pdf']);
  });

  it('treats a missing manifest as nothing to do', () => {
    expect(restorePlan(null, () => false)).toEqual({ fetch: [], skipped: [] });
  });
});
