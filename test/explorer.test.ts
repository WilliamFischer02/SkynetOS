import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatSize,
  iconFor,
  isInside,
  isRunnable,
  joinInside,
  parentRel,
  relativeInside,
  sortEntries,
  splitRel,
  type ExplorerEntry
} from '../packages/shared/explorer.js';
import type { BoardNode } from '../packages/shared/types.js';
import { listExplorer } from '../src/main/services/explorer.js';

/*
 * The explorer node's one rule: a listing never leaves its root. The pure half is tested by
 * spelling; the disk half against a real folder with a real junction pointing out of it.
 */

describe('relative paths stay inside the root', () => {
  it('splits ordinary paths in either slash', () => {
    expect(splitRel('')).toEqual([]);
    expect(splitRel('maps/usgs')).toEqual(['maps', 'usgs']);
    expect(splitRel('maps\\usgs')).toEqual(['maps', 'usgs']);
    expect(splitRel('./maps//usgs/')).toEqual(['maps', 'usgs']);
  });

  it('refuses every spelling that could climb out', () => {
    for (const bad of ['..', '../x', 'a/../../b', 'a/..', 'C:/Windows', 'c:x', '/etc', '//server/share', '\\\\server\\share', 'notes.txt:hidden', 'a/b\u0001c']) {
      expect(splitRel(bad), bad).toBeNull();
      expect(joinInside('C:/dev/DirtyPlush/research', bad), bad).toBeNull();
    }
  });

  it('joins onto the root, and the empty path is the root itself', () => {
    expect(joinInside('C:/r', 'a/b')).toBe('C:/r/a/b');
    expect(joinInside('C:\\r\\', '')).toBe('C:/r');
  });

  it('knows inside from a sibling that merely shares a prefix', () => {
    expect(isInside('C:/dev/research', 'c:/DEV/Research/maps')).toBe(true);
    expect(isInside('C:/dev/research', 'C:/dev/research')).toBe(true);
    expect(isInside('C:/dev/research', 'C:/dev/research-old')).toBe(false);
    expect(isInside('C:/dev/research', 'C:/dev')).toBe(false);
  });

  it('reports a path relative to the root, or null outside it', () => {
    expect(relativeInside('C:/r', 'C:/r/a/b')).toBe('a/b');
    expect(relativeInside('C:/r', 'C:/r')).toBe('');
    expect(relativeInside('C:/r', 'C:/other')).toBeNull();
  });

  it('never goes above the root on Up', () => {
    expect(parentRel('a/b')).toBe('a');
    expect(parentRel('a')).toBe('');
    expect(parentRel('')).toBe('');
  });
});

describe('listing order and icons', () => {
  const e = (name: string, kind: ExplorerEntry['kind'], size: number | null, mtime: number): ExplorerEntry =>
    ({ name, kind, size, mtime, ext: kind === 'dir' ? '' : name.slice(name.lastIndexOf('.')).toLowerCase() });
  const entries = [
    e('file10.txt', 'file', 50, 3),
    e('zeta', 'dir', null, 1),
    e('file2.txt', 'file', 900, 1),
    e('Alpha', 'dir', null, 9),
    e('big.pdf', 'file', 5000, 2)
  ];

  it('puts folders first, then names in natural order', () => {
    expect(sortEntries(entries).map((x) => x.name)).toEqual(['Alpha', 'zeta', 'big.pdf', 'file2.txt', 'file10.txt']);
  });

  it('sorts by size and date, folders still first', () => {
    expect(sortEntries(entries, 'size', true).map((x) => x.name)).toEqual(['Alpha', 'zeta', 'big.pdf', 'file2.txt', 'file10.txt']);
    expect(sortEntries(entries, 'date', true).map((x) => x.name)).toEqual(['Alpha', 'zeta', 'file10.txt', 'big.pdf', 'file2.txt']);
  });

  it('draws a map for a map, whatever format it came in', () => {
    expect(iconFor({ kind: 'file', name: 'escondido-topo-1994.pdf', ext: '.pdf' })).toBe('map');
    expect(iconFor({ kind: 'file', name: 'usgs_quad.tif', ext: '.tif' })).toBe('map');
    expect(iconFor({ kind: 'file', name: 'weather report.pdf', ext: '.pdf' })).toBe('pdf');
    expect(iconFor({ kind: 'file', name: 'mapping-notes.pdf', ext: '.pdf' })).toBe('pdf');
    expect(iconFor({ kind: 'dir', name: 'maps', ext: '' })).toBe('folder');
    expect(iconFor({ kind: 'file', name: 'x.qqq', ext: '.qqq' })).toBe('unknown');
  });

  it('flags files that run code, so opening one is always confirmed', () => {
    expect(isRunnable('setup.EXE')).toBe(true);
    expect(isRunnable('fetch.ps1')).toBe(true);
    expect(isRunnable('shortcut.lnk')).toBe(true);
    expect(isRunnable('report.pdf')).toBe(false);
  });

  it('formats sizes the way Explorer does', () => {
    expect(formatSize(null)).toBe('—');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(31 * 1024 * 1024)).toBe('31 MB');
  });
});

describe('the disk half refuses to leave the root', () => {
  let fixture = '';
  let root = '';
  let junctioned = false;
  const node = (over: Partial<BoardNode> = {}): BoardNode =>
    ({ id: 's_research', kind: 'store.explorer', name: 'RESEARCH', pos: { x: 0, y: 0 }, path: root, ...over });

  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), 'skynet-explorer-')).replace(/\\/g, '/');
    root = `${fixture}/research`;
    mkdirSync(`${root}/maps/usgs`, { recursive: true });
    mkdirSync(`${root}/.git`);
    mkdirSync(`${fixture}/outside`);
    writeFileSync(`${root}/weather-1994.csv`, 'date,high\n');
    writeFileSync(`${root}/desktop.ini`, '');
    writeFileSync(`${root}/maps/escondido-topo.pdf`, '%PDF');
    writeFileSync(`${fixture}/outside/secret.txt`, 'not yours');
    try {
      // A junction needs no elevation on Windows; elsewhere this is a plain directory symlink.
      symlinkSync(`${fixture}/outside`, `${root}/escape`, 'junction');
      junctioned = true;
    } catch {
      junctioned = false;
    }
  });
  afterAll(() => { if (fixture) rmSync(fixture, { recursive: true, force: true }); });

  it('lists the root, folders first, hidden names left out', () => {
    const listing = listExplorer(node(), null);
    expect(listing.ok, listing.error).toBe(true);
    expect(listing.rel).toBe('');
    const names = listing.entries.map((x) => x.name);
    expect(names).not.toContain('.git');
    expect(names).not.toContain('desktop.ini');
    expect(names.indexOf('maps')).toBeLessThan(names.indexOf('weather-1994.csv'));
    expect(listing.entries.find((x) => x.name === 'weather-1994.csv')?.size).toBe(10);
  });

  it('walks down, and refuses to walk up', () => {
    expect(listExplorer(node(), 'maps').entries.map((x) => x.name)).toEqual(['usgs', 'escondido-topo.pdf']);
    const up = listExplorer(node(), '..');
    expect(up.ok).toBe(false);
    expect(up.error).toMatch(/OUTSIDE THE EXPLORER ROOT/);
  });

  it('refuses a junction whose real path leaves the root', () => {
    if (!junctioned) return;
    const listing = listExplorer(node(), 'escape');
    expect(listing.ok).toBe(false);
    expect(listing.error).toMatch(/LEADS OUTSIDE/);
  });

  it('opens where it rests, and ignores a resting folder outside the root', () => {
    const resting = listExplorer(node({ restPath: `${root}/maps` }), null);
    expect(resting.ok).toBe(true);
    expect(resting.rel).toBe('maps');
    expect(resting.rest).toBe('maps');

    const stray = listExplorer(node({ restPath: `${fixture}/outside` }), null);
    expect(stray.ok).toBe(true);
    expect(stray.rel).toBe('');
    expect(stray.restRefused).toMatch(/OUTSIDE THE ROOT/);
  });

  it('refuses a node that is not an explorer', () => {
    const listing = listExplorer(node({ kind: 'store.folder' }), null);
    expect(listing.ok).toBe(false);
  });
});
