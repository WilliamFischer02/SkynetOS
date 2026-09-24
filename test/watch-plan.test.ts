import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { leadsTo, nearestExistingAncestor, parentDir, planWatch } from '../packages/shared/watch-plan.js';
import type { Board } from '../packages/shared/types.js';

/**
 * William, 2026-09-21: "my TimeServed mod was just rebuilt and the board still shows no build for
 * it." The watcher skipped every directory that did not exist when the room was opened, so a mod's
 * FIRST build, and any build after `gradlew clean`, was never seen. These hold the rule that
 * replaced it: wait at the nearest ancestor that does exist.
 */

const fs = (...present: string[]) => (path: string): boolean => present.includes(path);

describe('parentDir', () => {
  it('walks up to the drive root and stops there', () => {
    expect(parentDir('C:/dev/TimeServed/build/libs')).toBe('C:/dev/TimeServed/build');
    expect(parentDir('C:/dev')).toBe('C:/');
    expect(parentDir('C:/')).toBeNull();
  });

  it('reads backslashes and a trailing slash the same way', () => {
    expect(parentDir('C:\\dev\\TimeServed\\')).toBe('C:/dev');
  });
});

describe('nearestExistingAncestor', () => {
  it('finds the repo when the build folder has never existed', () => {
    const exists = fs('C:/', 'C:/dev', 'C:/dev/TimeServed');
    expect(nearestExistingAncestor('C:/dev/TimeServed/build/libs', exists)).toBe('C:/dev/TimeServed');
  });

  it('finds `build` once gradle has made it', () => {
    const exists = fs('C:/', 'C:/dev', 'C:/dev/TimeServed', 'C:/dev/TimeServed/build');
    expect(nearestExistingAncestor('C:/dev/TimeServed/build/libs', exists)).toBe('C:/dev/TimeServed/build');
  });

  it('is null when not even the drive is there', () => {
    expect(nearestExistingAncestor('Z:/mods/build/libs', fs())).toBeNull();
  });

  it('never waits at a drive root, where everything is on the way', () => {
    expect(nearestExistingAncestor('C:/gone/libs', fs('C:/'))).toBeNull();
  });

  it('never waits in a Windows system folder for a program that is not installed', () => {
    const exists = fs('C:/', 'C:/Program Files', 'C:/Users', 'C:/Users/w');
    expect(nearestExistingAncestor('C:/Program Files/Anki', exists)).toBeNull();
    expect(nearestExistingAncestor('C:/Users/REPLACE_ME/Documents/Deduction', exists)).toBeNull();
    // A real profile is fine: that is one person's folder, not everybody's.
    expect(nearestExistingAncestor('C:/Users/w/Documents', exists)).toBe('C:/Users/w');
  });

  it('reaches the dev root for a repo that is missing, and no further', () => {
    const exists = fs('C:/', 'C:/dev', 'C:/Users', 'C:/Users/w');
    expect(nearestExistingAncestor('C:/dev/NotCloned/build/libs', exists)).toBe('C:/dev');
    expect(nearestExistingAncestor('C:/Users/w/a/b/c/d/libs', exists)).toBeNull();
  });
});

describe('planWatch', () => {
  const exists = fs('C:/', 'C:/dev', 'C:/dev/TheStalker', 'C:/dev/TheStalker/build', 'C:/dev/TheStalker/build/libs', 'C:/dev/TimeServed', 'C:/dev/LociBook');

  it('watches what exists directly and waits for the rest at an ancestor', () => {
    const plan = planWatch(['C:/dev/TheStalker/build/libs', 'C:/dev/TimeServed/build/libs'], exists);
    expect(plan.direct).toEqual(['C:/dev/TheStalker/build/libs']);
    expect([...plan.waiting]).toEqual([['C:/dev/TimeServed', ['C:/dev/TimeServed/build/libs']]]);
    expect(plan.unreachable).toEqual([]);
  });

  it('never drops a wanted directory silently', () => {
    const wanted = ['C:/dev/TheStalker/build/libs', 'C:/dev/TimeServed/build/libs', 'C:/dev/LociBook/build/libs', 'Z:/gone/build/libs'];
    const plan = planWatch(wanted, exists);
    const accounted = [...plan.direct, ...[...plan.waiting.values()].flat(), ...plan.unreachable];
    expect(accounted.sort()).toEqual([...wanted].sort());
    expect(plan.unreachable).toEqual(['Z:/gone/build/libs']);
  });

  it('lets one ancestor stand in for several wanted directories', () => {
    const plan = planWatch(['C:/dev/A/build/libs', 'C:/dev/B/build/libs'], fs('C:/', 'C:/dev'));
    expect([...plan.waiting]).toEqual([['C:/dev', ['C:/dev/A/build/libs', 'C:/dev/B/build/libs']]]);
  });
});

describe('leadsTo', () => {
  it('recognises each step on the way down, and the directory itself', () => {
    expect(leadsTo('C:/dev/TimeServed/build', 'C:/dev/TimeServed/build/libs')).toBe(true);
    expect(leadsTo('C:\\dev\\TimeServed\\build\\libs', 'C:/dev/TimeServed/build/libs')).toBe(true);
  });

  it('ignores a sibling, and a name that merely starts the same', () => {
    expect(leadsTo('C:/dev/TimeServed/src', 'C:/dev/TimeServed/build/libs')).toBe(false);
    expect(leadsTo('C:/dev/TimeServed/buildSrc', 'C:/dev/TimeServed/build/libs')).toBe(false);
  });

  it('is case-insensitive, as the filesystem is', () => {
    expect(leadsTo('c:/DEV/timeserved/BUILD', 'C:/dev/TimeServed/build/libs')).toBe(true);
  });
});

/**
 * The real thing, against a real directory: a repo with no build folder, watched, then built.
 * This is the exact sequence that left TimeServed reading NO BUILD.
 */
describe('watchBoard sees a first build', () => {
  const root = mkdtempSync(join(tmpdir(), 'skynet-watch-'));
  const repo = join(root, 'TimeServed').replace(/\\/g, '/');
  mkdirSync(repo, { recursive: true });

  const board = {
    id: 'watchtest',
    nodes: [{ id: 'a4_jar_time', kind: 'file.artifact', name: 'timeserved.jar', pos: { x: 0, y: 0 }, glob: `${repo}/build/libs/*.jar` }],
    edges: []
  } as unknown as Board;

  afterAll(async () => {
    const { stopWatching } = await import('../src/main/services/watchers.js');
    await stopWatching();
  });

  it('reports the artifact node when build/libs and a jar appear after the watch began', async () => {
    const { onFileChanged, watchBoard } = await import('../src/main/services/watchers.js');
    const seen: string[] = [];
    const off = onFileChanged((event) => { if (event.boardId === 'watchtest') seen.push(...event.nodeIds); });

    const first = await watchBoard(board);
    expect(first).toMatchObject({ watched: 0, waiting: 1 });

    // Let chokidar finish its initial scan before the build starts.
    await new Promise((r) => setTimeout(r, 300));
    mkdirSync(join(repo, 'build', 'libs'), { recursive: true });
    writeFileSync(join(repo, 'build', 'libs', 'timeserved-1.2.0.jar'), 'jar');

    const deadline = Date.now() + 8000;
    while (!seen.includes('a4_jar_time') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    off();
    expect(seen).toContain('a4_jar_time');
  }, 12_000);

  it('survives `gradlew clean`: the build folder goes, comes back, and the new jar is still seen', async () => {
    const { onFileChanged } = await import('../src/main/services/watchers.js');
    const reasons: string[] = [];
    const off = onFileChanged((event) => { if (event.nodeIds.includes('a4_jar_time')) reasons.push(event.reason); });

    // Only this test's own temp folder, made above.
    rmSync(join(repo, 'build'), { recursive: true, force: true });
    let deadline = Date.now() + 8000;
    while (!reasons.includes('removed') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(reasons).toContain('removed');

    // Give the re-plan time to settle on the repo folder again, then build.
    await new Promise((r) => setTimeout(r, 1000));
    reasons.length = 0;
    mkdirSync(join(repo, 'build', 'libs'), { recursive: true });
    writeFileSync(join(repo, 'build', 'libs', 'timeserved-1.2.1.jar'), 'jar');
    deadline = Date.now() + 8000;
    while (!reasons.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    off();
    expect(reasons.length).toBeGreaterThan(0);
  }, 25_000);
});
