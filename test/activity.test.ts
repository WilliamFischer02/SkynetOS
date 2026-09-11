import { describe, expect, it } from 'vitest';
import { attributeActivity, normalisePath, toolPaths, type ActivityEvent, type NodeClaim } from '../packages/shared/usage.js';

/**
 * Who gets the couriers. William: "the bot movement should be proportional and updating based on
 * which repos or files claude has worked within."
 *
 * The rule under test is proportion. Every message is split between the nodes that claim it and
 * never counted twice, so a board's shares sum to at most 1 whatever overlaps it contains.
 */

const claim = (nodeId: string, over: Partial<NodeClaim> = {}): NodeClaim => ({ nodeId, projects: [], dirs: [], files: [], ...over });

describe('toolPaths', () => {
  it('reads the files a message\'s tool calls named', () => {
    const content = [
      { type: 'text', text: 'Reading C:/not/a/tool/path.ts' },
      { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\dev\\SkynetOS\\src\\main\\ipc.ts' } },
      { type: 'tool_use', name: 'NotebookEdit', input: { notebook_path: 'C:/dev/Notes/a.ipynb' } },
      { type: 'tool_use', name: 'Grep', input: { pattern: 'x', path: 'C:/dev/TheStalker/src' } }
    ];
    expect(toolPaths(content)).toEqual([
      'c:/dev/skynetos/src/main/ipc.ts',
      'c:/dev/notes/a.ipynb',
      'c:/dev/thestalker/src'
    ]);
  });

  it('resolves a relative path against the conversation\'s own working directory', () => {
    const content = [{ type: 'tool_use', name: 'Edit', input: { file_path: 'docs/design.md' } }];
    expect(toolPaths(content, 'C:\\dev\\TruthQuestRetro')).toEqual(['c:/dev/truthquestretro/docs/design.md']);
    expect(toolPaths(content)).toEqual([]);
  });

  it('does not guess paths out of a shell command', () => {
    expect(toolPaths([{ type: 'tool_use', name: 'Bash', input: { command: 'cat C:/dev/SkynetOS/README.md' } }])).toEqual([]);
  });

  it('survives content that is not what it expects', () => {
    expect(toolPaths('just text')).toEqual([]);
    expect(toolPaths([null, 3, { type: 'tool_use' }])).toEqual([]);
  });
});

describe('attributeActivity', () => {
  it('gives a node the conversations started in its own directory', () => {
    const events: ActivityEvent[] = [{ w: 100, project: 'C--dev-TheStalker', paths: [] }];
    const routes = attributeActivity(events, [claim('stalker', { projects: ['C--dev-TheStalker'] })]);
    expect(routes).toEqual([{ nodeId: 'stalker', share: 1, projects: ['C--dev-TheStalker'], windowTokens: 100, touchedFiles: 0 }]);
  });

  it('credits a repo for work done inside it from a conversation started somewhere else', () => {
    // The case that motivated this: a session in C:/dev editing the SkynetOS source.
    const events: ActivityEvent[] = [{ w: 100, project: 'C--dev', paths: [normalisePath('C:/dev/SkynetOS/src/main/ipc.ts')] }];
    const routes = attributeActivity(events, [
      claim('prime', { projects: ['C--dev'] }),
      claim('repo', { dirs: ['C:/dev/SkynetOS'] })
    ]);
    expect(routes.map((r) => [r.nodeId, r.share])).toEqual([['prime', 0.5], ['repo', 0.5]]);
    expect(routes.find((r) => r.nodeId === 'repo')?.touchedFiles).toBe(1);
  });

  it('never counts a message twice, so a board\'s shares sum to at most 1', () => {
    const events: ActivityEvent[] = [
      { w: 60, project: 'C--dev-SkynetOS', paths: ['c:/dev/skynetos/readme.md'] },
      { w: 40, project: 'C--dev-Other', paths: [] }
    ];
    const routes = attributeActivity(events, [
      claim('agent', { projects: ['C--dev-SkynetOS'] }),
      claim('repo', { projects: ['C--dev-SkynetOS'], dirs: ['c:/dev/skynetos'] }),
      claim('room', { projects: ['C--dev-SkynetOS'], dirs: ['c:/dev/skynetos'] }),
      claim('doc', { files: ['C:/dev/SkynetOS/README.md'] })
    ]);
    const total = routes.reduce((sum, r) => sum + r.share, 0);
    expect(total).toBeCloseTo(0.6, 10);
    // Four claimants split the one message evenly.
    for (const r of routes) expect(r.share).toBeCloseTo(0.15, 10);
  });

  it('counts unclaimed activity toward the total, so a quiet board looks quiet', () => {
    const events: ActivityEvent[] = [
      { w: 10, project: 'C--dev-Mine', paths: [] },
      { w: 90, project: 'C--dev-Elsewhere', paths: [] }
    ];
    expect(attributeActivity(events, [claim('mine', { projects: ['C--dev-Mine'] })])[0]?.share).toBeCloseTo(0.1, 10);
  });

  it('does not mistake a sibling folder with a shared prefix for the repo', () => {
    const events: ActivityEvent[] = [{ w: 10, project: 'X', paths: ['c:/dev/skynetos-old/a.ts'] }];
    expect(attributeActivity(events, [claim('repo', { dirs: ['C:/dev/SkynetOS'] })])).toEqual([]);
  });

  it('says nothing at all when nothing ran', () => {
    expect(attributeActivity([], [claim('a', { projects: ['P'] })])).toEqual([]);
  });
});
