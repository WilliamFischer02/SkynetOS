import { describe, expect, it } from 'vitest';
import { refreshChanges, refreshSummary } from '../packages/shared/refresh-summary.js';
import type { TargetInfo } from '../packages/shared/targets.js';

/**
 * F5 is pressed to answer one question: did the new build turn up? The toast has to answer it.
 */

const missing: TargetInfo = { state: 'missing', raw: 'C:/dev/TimeServed/build/libs/*.jar', resolved: null, detail: 'GLOB DIRECTORY NOT FOUND' };
const jar = (file: string, mtimeMs: number): TargetInfo => ({
  state: 'ok', raw: 'C:/dev/TimeServed/build/libs/*.jar', resolved: `C:/dev/TimeServed/build/libs/${file}`, detail: null, kind: 'file', mtimeMs
});
const names = { a4: 'timeserved.jar', a1: 'thestalker.jar', l1: 'CurseForge', n1: 'a note' };

describe('refreshChanges', () => {
  it('sees a first build appear', () => {
    expect(refreshChanges({ a4: missing }, { a4: jar('timeserved-1.2.0.jar', 10) }, names)).toEqual([{ nodeId: 'a4', name: 'timeserved.jar', what: 'appeared' }]);
  });

  it('sees a rebuild of the same file name by its time', () => {
    expect(refreshChanges({ a4: jar('timeserved-1.2.0.jar', 10) }, { a4: jar('timeserved-1.2.0.jar', 20) }, names)[0]?.what).toBe('updated');
  });

  it('sees a new version replace the old one', () => {
    expect(refreshChanges({ a4: jar('timeserved-1.2.0.jar', 10) }, { a4: jar('timeserved-1.3.0.jar', 10) }, names)[0]?.what).toBe('updated');
  });

  it('sees a build vanish after a clean', () => {
    expect(refreshChanges({ a4: jar('timeserved-1.2.0.jar', 10) }, { a4: missing }, names)[0]?.what).toBe('gone');
  });

  it('reports nothing when nothing moved, and ignores URLs and nodes with no target', () => {
    const same = { a4: jar('timeserved-1.2.0.jar', 10), l1: { state: 'ok', raw: 'https://x', resolved: 'https://x', detail: null, kind: 'url' } as TargetInfo, n1: { state: 'none', raw: null, resolved: null, detail: null } as TargetInfo };
    expect(refreshChanges(same, same, names)).toEqual([]);
  });

  it('treats a file outside the dev roots as present: that is policy, not absence', () => {
    const outside: TargetInfo = { ...jar('x.jar', 10), state: 'outside-dev-root' };
    expect(refreshChanges({ a4: outside }, { a4: outside }, names)).toEqual([]);
  });
});

describe('refreshSummary', () => {
  it('names the file that turned up', () => {
    const after = { a4: jar('timeserved-1.2.0.jar', 10) };
    const line = refreshSummary(refreshChanges({ a4: missing }, after, names), 7, after);
    expect(line).toBe('REFRESHED · TIMESERVED.JAR FOUND (timeserved-1.2.0.jar)');
  });

  it('says so plainly when nothing changed', () => {
    expect(refreshSummary([], 7)).toBe('REFRESHED · 7 NODES RE-READ, NOTHING NEW');
    expect(refreshSummary([], 1)).toBe('REFRESHED · 1 NODE RE-READ, NOTHING NEW');
  });

  it('keeps the line short when a whole room rebuilt', () => {
    const changes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ nodeId: id, name: `${id}.jar`, what: 'updated' as const }));
    expect(refreshSummary(changes, 7)).toBe('REFRESHED · A.JAR UPDATED · B.JAR UPDATED · C.JAR UPDATED · AND 2 MORE');
  });
});
