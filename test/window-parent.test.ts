import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dialogs belong to the board window.
 *
 * Electron lists windows newest first, so `BrowserWindow.getAllWindows()[0]` is the Face's
 * conversation window as soon as it has been opened, and a file picker parented to it opens on
 * a window nobody is looking at. That is how Browse stopped working. See
 * src/main/services/main-window.ts. This is structural on purpose: the bug has no symptom in a
 * unit test, only on a desktop with two windows open.
 */

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

describe('dialogs are parented to the board window', () => {
  it('never picks a window by its position in getAllWindows()', () => {
    // Code only: the comments explaining why this is banned have to be able to name it.
    const code = (file: string): string =>
      readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const offenders = sources(join(process.cwd(), 'src', 'main'))
      .filter((file) => /getAllWindows\(\)\s*\[\s*\d+\s*\]/.test(code(file)))
      .map((file) => relative(process.cwd(), file).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
