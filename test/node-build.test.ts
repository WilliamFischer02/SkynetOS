import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../packages/shared/types.js';
import { DEFAULT_FOOTPRINT, NODE_KINDS } from '../packages/shared/types.js';
import { buildNodePrompt, suggestedBuildTile } from '../packages/shared/node-build.js';
import {
  PROMPT_TO_NODE_KIND,
  PROMPT_TO_NODE_TAB,
  isPromptBoxKind,
  promptLayout,
  promptTabFor
} from '../packages/shared/prompt.js';
import { AGENT_METHODS, CHANNELS } from '../packages/shared/ipc.js';

const box = {
  id: 'q_prompt_node',
  kind: PROMPT_TO_NODE_KIND,
  name: 'PROMPT → NODE',
  designator: 'P2',
  pos: { x: 92, y: 71 },
  footprint: { w: 11, h: 4 }
} as BoardNode;

const brief = (over: Partial<Parameters<typeof buildNodePrompt>[0]> = {}) => buildNodePrompt({
  boardId: 'root',
  boardName: 'SKYNETOS',
  box,
  text: 'a repo node for C:/dev/BitRunners\nwired to U3',
  files: [],
  ...over
});

describe('the PROMPT → NODE brief', () => {
  it('says it is a build task, names the board id for the tools, and where the box is', () => {
    const text = brief();
    expect(text.startsWith('BUILD A NODE.')).toBe(true);
    expect(text).toContain('Pass boardId "root" to every skynet tool');
    expect(text).toContain('P2 PROMPT → NODE at tile 92,71, footprint 11x4');
  });

  it('suggests a start just right of the box', () => {
    expect(suggestedBuildTile(box)).toEqual({ x: 105, y: 71 });
    expect(brief()).toContain('Start at tile 105,71');
  });

  it('carries what William wrote verbatim, line by line', () => {
    expect(brief()).toContain('  a repo node for C:/dev/BitRunners\n  wired to U3');
  });

  it('lists attachments only when there are any', () => {
    expect(brief()).not.toContain('ATTACHED FILES');
    const withFiles = brief({ files: ['C:\\x\\map.png'] });
    expect(withFiles).toContain('ATTACHED FILES');
    expect(withFiles).toContain('  - C:\\x\\map.png');
  });

  it('names the real skynet tools, forbids wiring to the box, and keeps the boundary', () => {
    const text = brief();
    for (const tool of ['node_fields', 'node_create', 'node_update', 'edge_create', 'phantom_propose']) {
      expect(text).toContain(tool);
    }
    expect(text).toContain('Do NOT wire it to the');
    expect(text).toContain('q_prompt_node');
    expect(text).toContain('docs/07-SECURITY.md');
    expect(text).toContain('CODEX PATCH and HANDOFF');
  });
});

describe('the PROMPT → NODE kind', () => {
  it('is a kind, one row taller than the quick-chat box for its tab', () => {
    expect(NODE_KINDS).toContain(PROMPT_TO_NODE_KIND);
    expect(DEFAULT_FOOTPRINT[PROMPT_TO_NODE_KIND]).toEqual({ w: 11, h: 4 });
    expect(isPromptBoxKind(PROMPT_TO_NODE_KIND)).toBe(true);
    expect(isPromptBoxKind('agent.prompt')).toBe(true);
    expect(isPromptBoxKind('agent.code')).toBe(false);
    expect(promptTabFor(PROMPT_TO_NODE_KIND)).toBe(PROMPT_TO_NODE_TAB);
    expect(promptTabFor('agent.prompt')).toBe(0);
  });

  it('lays out a tab above the box, whole pixels, with the box starting under it', () => {
    const fp = DEFAULT_FOOTPRINT[PROMPT_TO_NODE_KIND];
    const w = fp.w * 16;
    const h = fp.h * 16;
    const layout = promptLayout(w, h, { tab: PROMPT_TO_NODE_TAB });
    for (const r of Object.values(layout)) for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
    expect(layout.tab).toMatchObject({ y: 0, h: PROMPT_TO_NODE_TAB });
    expect(layout.tab.w).toBeGreaterThanOrEqual(48);
    expect(layout.tab.w).toBeLessThanOrEqual(layout.box.w);
    expect(layout.box.y).toBe(PROMPT_TO_NODE_TAB);
    expect(layout.box.y + layout.box.h).toBeLessThanOrEqual(h);
    // The same text room as the quick-chat box, which is the reason for the extra row.
    expect(layout.text.h).toBeGreaterThanOrEqual(13);
  });

  it('gives the quick-chat box no tab and leaves its layout as it was', () => {
    const layout = promptLayout(176, 48);
    expect(layout.tab.w).toBe(0);
    expect(layout.tab.h).toBe(0);
    expect(layout.box).toEqual({ x: 2, y: 2, w: 172, h: 44 });
  });

  it('is a user-only channel: no agent can make it open a Prime terminal', () => {
    expect(CHANNELS).toContain('prompt:build');
    expect(AGENT_METHODS as readonly string[]).not.toContain('prompt:build');
  });
});
