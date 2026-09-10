import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Board } from '../packages/shared/types.js';
import { parseVersion, producerOf, producerRepo } from '../src/main/services/artifacts.js';
import { classify, suggestionToNode } from '../src/main/services/ingest.js';
import { usePolling, watchTargetsFor } from '../src/main/services/watchers.js';
import { findFreeSpaceOnBoard } from '../src/main/services/placement.js';

const minecraft = JSON.parse(
  readFileSync(join(process.cwd(), 'board', 'minecraftos', 'room.board.json'), 'utf8')
) as Board;
const root = JSON.parse(readFileSync(join(process.cwd(), 'board', 'root.board.json'), 'utf8')) as Board;

describe('parseVersion', () => {
  it('captures the version the seeded board asks for', () => {
    // The real pattern on a1_jar_stalker, against the real filename in C:/dev/TheStalker.
    expect(parseVersion('thestalker-0.1.0.jar', '-(\\d+\\.\\d+\\.\\d+)\\.jar$')).toBe('0.1.0');
    expect(parseVersion('thestalker-0.4.2.jar', '-(\\d+\\.\\d+\\.\\d+)\\.jar$')).toBe('0.4.2');
  });

  it('does not match the sources jar the node excludes', () => {
    expect(parseVersion('thestalker-0.1.0-sources.jar', '-(\\d+\\.\\d+\\.\\d+)\\.jar$')).toBeUndefined();
  });

  it('is undefined when the node declares no pattern', () => {
    expect(parseVersion('anything.jar', undefined)).toBeUndefined();
  });

  it('survives a malformed regex in board data rather than throwing', () => {
    // A bad pattern is a typo in a JSON file. It must not take the board down.
    expect(parseVersion('x-1.0.0.jar', '([unclosed')).toBeUndefined();
  });
});

describe('producer resolution — what "stale" is measured against', () => {
  it('follows the produces edge back to whatever directly produces the jar', () => {
    /*
     * The seeded board wires a chain: u1_agent_stalker -produces-> s1_repo_stalker -produces->
     * a1_jar_stalker. So the jar's DIRECT producer is the repo, not the agent — which is the
     * right modelling, because the repo is the working tree whose commits decide staleness.
     * The agent produces the repo's contents; the repo produces the jar.
     */
    const producer = producerOf(minecraft, 'a1_jar_stalker');
    expect(producer).toBeDefined();
    expect(producer!.id).toBe('s1_repo_stalker');
    expect(producer!.kind).toBe('store.repo');
  });

  it('resolves that producer to a real working tree', () => {
    expect(producerRepo(minecraft, 'a1_jar_stalker')).toBe('C:/dev/TheStalker');
  });

  it('reports no producer for an artifact nothing claims to build', () => {
    expect(producerOf(minecraft, 'does_not_exist')).toBeUndefined();
    expect(producerRepo(minecraft, 'does_not_exist')).toBeUndefined();
  });

  it('finds a producer for every artifact on the seeded MinecraftOS board', () => {
    // If an artifact has no produces edge, its staleness can never be anything but 'unknown',
    // which is a board-data omission worth catching here rather than noticing on screen.
    const artifacts = minecraft.nodes.filter((n) => n.kind === 'file.artifact');
    expect(artifacts.length).toBeGreaterThan(0);
    for (const a of artifacts) {
      expect(producerRepo(minecraft, a.id), `${a.id} has no producer repo`).toBeDefined();
    }
  });
});

describe('usePolling — the CLAUDE.md landmine', () => {
  it('polls UNC shares', () => {
    expect(usePolling('\\\\server\\share\\build')).toBe(true);
    expect(usePolling('//server/share/build')).toBe(true);
  });

  it('polls cloud-sync folders by name', () => {
    expect(usePolling('C:/Users/me/OneDrive/Documents')).toBe(true);
    expect(usePolling('C:/Users/me/Dropbox/project')).toBe(true);
    expect(usePolling('C:/Users/me/Google Drive/x')).toBe(true);
    expect(usePolling('C:/Users/me/iCloud Drive/x')).toBe(true);
  });

  it('is case-insensitive about them', () => {
    expect(usePolling('c:/users/me/onedrive/docs')).toBe(true);
  });

  it('uses native notifications on a plain local disk', () => {
    expect(usePolling('C:/dev/TheStalker/build/libs')).toBe(false);
    expect(usePolling('D:/games/mods')).toBe(false);
  });

  it('polls anything without a local drive letter, rather than trusting it', () => {
    expect(usePolling('relative/path')).toBe(true);
    expect(usePolling('')).toBe(true);
  });

  it('does not mistake a folder merely CONTAINING the word for a cloud root', () => {
    // "onedriveish" is not OneDrive; the boundary matters or half of C:/ gets polled.
    expect(usePolling('C:/dev/onedriveish/build')).toBe(false);
  });
});

describe('watchTargetsFor', () => {
  it('watches the DIRECTORY of an artifact glob, not the file', () => {
    // A build replaces the jar rather than editing it, so watching the file misses the rebuild.
    const map = watchTargetsFor(minecraft);
    expect([...map.keys()]).toContain('C:/dev/TheStalker/build/libs');
  });

  it('maps each directory to the nodes that care about it', () => {
    const map = watchTargetsFor(minecraft);
    expect([...(map.get('C:/dev/TheStalker/build/libs') ?? [])]).toContain('a1_jar_stalker');
  });

  it('ignores kinds that are not files', () => {
    const map = watchTargetsFor(root);
    const allNodes = [...map.values()].flatMap((s) => [...s]);
    expect(allNodes).not.toContain('u1_jarvis');
    expect(allNodes).not.toContain('d1_minecraftos');
  });
});

describe('classify — drop-in ingestion', () => {
  it('turns a jar in build/libs into a GLOB, not a pinned filename', () => {
    // The whole reason file.artifact exists: the next build has a different filename, and a
    // pinned node would immediately render broken.
    const s = classify('C:/dev/TheStalker/build/libs/thestalker-0.1.0.jar');
    expect(s).not.toBeNull();
    expect(s!.kind).toBe('file.artifact');
    expect(s!.fields.glob).toBe('C:/dev/TheStalker/build/libs/*.jar');
    expect(s!.fields.exclude).toContain('*-sources.jar');
    expect(s!.reason).toContain('newest build');
  });

  it('recognises a git working tree as a repo drive', () => {
    const s = classify(process.cwd());
    expect(s).not.toBeNull();
    expect(s!.kind).toBe('store.repo');
    expect(s!.fields.openWith).toBe('vscode');
  });

  it('returns null for a path that does not exist — never invents a node', () => {
    expect(classify('C:/definitely/not/here.jar')).toBeNull();
  });

  it('suggests an id that is legal for the schema', () => {
    const s = classify(process.cwd())!;
    expect(s.suggestedId).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('suggestionToNode', () => {
  it('does not collide with an existing node id', () => {
    const s = classify(process.cwd())!;
    const taken = new Set([s.suggestedId]);
    const node = suggestionToNode(s, { x: 2, y: 2 }, taken);
    expect(node.id).not.toBe(s.suggestedId);
    expect(node.id).toMatch(/^[a-z0-9_]+$/);
  });

  it('clamps the name to the schema maximum', () => {
    const s = { ...classify(process.cwd())!, name: 'x'.repeat(80) };
    expect(suggestionToNode(s, { x: 1, y: 1 }, new Set()).name.length).toBeLessThanOrEqual(40);
  });
});

describe('findFreeSpaceOnBoard', () => {
  it('honours the drop position when it is free', () => {
    const spot = findFreeSpaceOnBoard(root, { w: 2, h: 2 }, { x: 20, y: 34 });
    expect(spot).toEqual({ x: 20, y: 34 });
  });

  it('finds the nearest gap when the drop lands on a component', () => {
    // u1_jarvis occupies 28,17 to 35,22.
    const spot = findFreeSpaceOnBoard(root, { w: 2, h: 2 }, { x: 29, y: 18 });
    expect(spot).not.toBeNull();
    const overlapsJarvis =
      spot!.x < 36 && spot!.x + 2 > 28 && spot!.y < 23 && spot!.y + 2 > 17;
    expect(overlapsJarvis).toBe(false);
  });

  it('keeps the footprint on the board', () => {
    const spot = findFreeSpaceOnBoard(root, { w: 4, h: 4 }, { x: 999, y: 999 });
    expect(spot).not.toBeNull();
    expect(spot!.x + 4).toBeLessThanOrEqual(root.grid.width);
    expect(spot!.y + 4).toBeLessThanOrEqual(root.grid.height);
  });

  it('returns null when nothing could fit', () => {
    expect(findFreeSpaceOnBoard(root, { w: 999, h: 999 }, { x: 0, y: 0 })).toBeNull();
  });
});
