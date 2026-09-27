import { describe, expect, it } from 'vitest';
import { LAT_BANDS, LON_CELLS, MAX_LAT, cellOf, coordFor, extensionOf, hash32, kindOf, parentOf } from '../packages/shared/globe-atlas.js';

/**
 * Pins are permanent. The whole point of the globe is that William learns where things live, so
 * the coordinate must be a pure function of the path, siblings must cluster, and nothing may sit
 * on a pole, where a gridded sphere pinches.
 */

describe('coordFor', () => {
  it('gives the same pin for the same path, however it is spelled', () => {
    const a = coordFor('C:\\dev\\SkynetOS\\handoff.md');
    const b = coordFor('c:/dev/skynetos/handoff.md');
    const c = coordFor('C:/dev/SkynetOS/handoff.md/');
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('puts siblings in one cell and a cousin elsewhere', () => {
    const cell = cellOf('C:/dev/SkynetOS/src/main/ipc.ts');
    expect(cellOf('C:/dev/SkynetOS/src/main/index.ts')).toBe(cell);
    expect(cellOf('C:/dev/SkynetOS/src/main/services/speech.ts')).not.toBe(cell);
    const a = coordFor('C:/dev/SkynetOS/src/main/ipc.ts');
    const b = coordFor('C:/dev/SkynetOS/src/main/index.ts');
    expect(Math.abs(a.lat - b.lat)).toBeLessThan((2 * MAX_LAT) / LAT_BANDS);
    expect(Math.abs(a.lon - b.lon)).toBeLessThan(360 / LON_CELLS);
    expect(a).not.toEqual(b);
  });

  it('never uses the poles and stays inside the longitude range', () => {
    for (let i = 0; i < 2000; i++) {
      const { lat, lon } = coordFor(`C:/dev/p${i % 37}/f${i}.ts`);
      expect(Math.abs(lat)).toBeLessThanOrEqual(MAX_LAT);
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThan(180);
    }
  });

  it('spreads many folders across the grid rather than piling up', () => {
    const cells = new Set<number>();
    for (let i = 0; i < 500; i++) cells.add(cellOf(`C:/dev/project-${i}/README.md`));
    expect(cells.size).toBeGreaterThan(400);
  });
});

describe('hash32 and parentOf', () => {
  it('hashes deterministically and differently', () => {
    expect(hash32('a')).toBe(hash32('a'));
    expect(hash32('a')).not.toBe(hash32('b'));
  });
  it('finds the parent of a normalised path', () => {
    expect(parentOf('C:/dev/SkynetOS/handoff.md')).toBe('c:/dev/skynetos');
    expect(parentOf('C:/')).toBe('');
  });
});

describe('kindOf', () => {
  it.each([
    ['notes.md', 'doc'], ['a.TXT', 'doc'], ['x.docx', 'doc'], ['x.pdf', 'doc'], ['x.rtf', 'doc'],
    ['a.ts', 'code'], ['a.tsx', 'code'], ['a.py', 'code'], ['a.ps1', 'code'], ['a.cpp', 'code'], ['a.json', 'code'], ['a.html', 'code'],
    ['m.obj', 'model'], ['m.stl', 'model'], ['m.glb', 'model'], ['m.blend', 'model'],
    ['i.png', 'image'], ['i.jpeg', 'image'], ['i.webp', 'image'],
    ['run.exe', 'exe'], ['run.bat', 'exe'], ['run.lnk', 'exe'], ['setup.msi', 'exe'],
    ['C:/dev/SkynetOS/', 'folder'], ['Makefile', 'other'], ['archive.7z', 'other']
  ])('%s is %s', (path, kind) => {
    expect(kindOf(path)).toBe(kind);
  });

  it('calls a known directory a folder even without a slash', () => {
    expect(kindOf('C:/dev/SkynetOS', { directory: true })).toBe('folder');
    expect(kindOf('C:/dev/SkynetOS')).toBe('other');
  });

  it('reads the extension without the dot, lower-case', () => {
    expect(extensionOf('C:/x/Y.PNG')).toBe('png');
    expect(extensionOf('C:/x/.gitignore')).toBe('');
    expect(extensionOf('C:/x/noext')).toBe('');
  });
});
