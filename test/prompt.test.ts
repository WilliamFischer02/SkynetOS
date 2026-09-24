import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Board, BoardNode } from '../packages/shared/types.js';
import { DEFAULT_FOOTPRINT } from '../packages/shared/types.js';
import {
  PROMPT_LIMITS,
  checkAttachments,
  fileNameOf,
  isImageFile,
  mimeFor,
  promptLayout,
  promptModeOf,
  resolvePromptTarget
} from '../packages/shared/prompt.js';
import { AGENT_METHODS, CHANNELS } from '../packages/shared/ipc.js';
import {
  attachScript,
  clickSendScript,
  composerHolds,
  composerTextScript,
  focusComposerScript,
  hasComposerScript,
  sendButtonStateScript
} from '../src/main/services/prompt-page.js';
import { makeNode } from '../src/main/services/node-factory.js';

/**
 * The prompt node. William: "a typical empty prompt box that allows for file (image and other file
 * types) upload, and whatever is typed into that box is fed to Jarvis Head/Face".
 *
 * The delivery itself drives a real claude.ai page and cannot run here. What can, is held here: which
 * conversation a box feeds, the geometry the sprite and the overlay share, the limits, the scripts
 * that go into the page, and the rule that no agent can reach any of it.
 */

const node = (over: Partial<BoardNode>): BoardNode => ({ id: 'n', kind: 'agent.code', name: 'N', pos: { x: 0, y: 0 }, ...over });
const board = (nodes: BoardNode[]): Pick<Board, 'nodes'> => ({ nodes });

describe('which conversation a box feeds', () => {
  const jarvis = node({ id: 'u1_jarvis', kind: 'agent.jarvis', url: 'https://claude.ai/chat/x' });
  const chat = node({ id: 'u4_chat', kind: 'agent.chat', url: 'https://claude.ai/chat/y' });

  it('is the board\'s JARVIS head when the box names none', () => {
    expect(resolvePromptTarget(board([chat, jarvis]), {})?.id).toBe('u1_jarvis');
  });

  it('is the conversation it names', () => {
    expect(resolvePromptTarget(board([jarvis, chat]), { promptTarget: 'u4_chat' })?.id).toBe('u4_chat');
  });

  it('is nobody, not JARVIS, when the named node is missing or is not a conversation', () => {
    // A message typed into a box labelled for one conversation must never turn up in another.
    expect(resolvePromptTarget(board([jarvis]), { promptTarget: 'u9_gone' })).toBeNull();
    expect(resolvePromptTarget(board([jarvis, node({ id: 's1_repo', kind: 'store.repo' })]), { promptTarget: 's1_repo' })).toBeNull();
  });

  it('is nobody on a board with no JARVIS head', () => {
    expect(resolvePromptTarget(board([chat]), {})).toBeNull();
  });

  it('sends by default, because William asked for a quick chat', () => {
    expect(promptModeOf({})).toBe('send');
    expect(promptModeOf({ promptMode: 'draft' })).toBe('draft');
  });
});

describe('the box geometry the sprite and the overlay share', () => {
  const inside = (outer: { x: number; y: number; w: number; h: number }, r: { x: number; y: number; w: number; h: number }) =>
    r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;

  it.each([[176, 48], [256, 64], [96, 48], [176, 32]])('is whole pixels and self-consistent at %ix%i', (w, h) => {
    const layout = promptLayout(w, h);
    for (const r of Object.values(layout)) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
      expect(inside({ x: 0, y: 0, w, h }, r)).toBe(true);
    }
    for (const part of [layout.text, layout.clip, layout.send]) expect(inside(layout.box, part)).toBe(true);
    // Paperclip left, send right, both below the text, none overlapping.
    expect(layout.clip.x + layout.clip.w).toBeLessThan(layout.send.x);
    expect(layout.text.y + layout.text.h).toBeLessThanOrEqual(layout.clip.y);
  });

  it('fits the default 11x3 footprint with room for a real line of text', () => {
    const fp = DEFAULT_FOOTPRINT['agent.prompt'];
    const layout = promptLayout(fp.w * 16, fp.h * 16);
    expect(layout.text.h).toBeGreaterThanOrEqual(13);
  });
});

describe('attachments', () => {
  it('names types the page can recognise, and treats the rest as bytes', () => {
    expect(mimeFor('shot.PNG')).toBe('image/png');
    expect(mimeFor('notes.md')).toBe('text/markdown');
    expect(mimeFor('mystery.bin')).toBe('application/octet-stream');
    expect(isImageFile('a.jpeg')).toBe(true);
    expect(isImageFile('a.pdf')).toBe(false);
    expect(fileNameOf('C:\\dev\\x\\file name.txt')).toBe('file name.txt');
  });

  it('refuses what is over the limits, saying why, and keeps the rest', () => {
    const mb = 1024 * 1024;
    const { accepted, refused } = checkAttachments([
      { path: 'a', bytes: 5 * mb },
      { path: 'huge', bytes: PROMPT_LIMITS.maxFileBytes + 1 },
      { path: 'b', bytes: 18 * mb },
      { path: 'c', bytes: 10 * mb }
    ]);
    expect(accepted.map((f) => f.path)).toEqual(['a', 'b']);
    expect(refused.map((r) => r.file.path)).toEqual(['huge', 'c']);
    expect(refused[1]?.reason).toContain('MB');
  });

  it('caps the count', () => {
    const many = Array.from({ length: PROMPT_LIMITS.maxFiles + 2 }, (_, i) => ({ path: String(i), bytes: 1 }));
    expect(checkAttachments(many).refused).toHaveLength(2);
  });
});

describe('the scripts that go into the claude.ai page', () => {
  const compiles = (script: string): void => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function(`return ${script};`)).not.toThrow();
  };

  it('are all valid JavaScript', () => {
    for (const script of [hasComposerScript(), focusComposerScript(), composerTextScript(), sendButtonStateScript(), clickSendScript()]) {
      compiles(script);
    }
    compiles(attachScript([{ name: 'a.png', mime: 'image/png', base64: 'AAAA' }]));
  });

  it('carry a hostile file name as a string, never as code', () => {
    const name = '"); window.__pwned = 1; ("</script>`${1}`.png';
    const script = attachScript([{ name, mime: 'image/png', base64: 'AAAA' }]);
    compiles(script);
    expect(script).toContain(JSON.stringify(name));
  });

  it('check the box holds what was typed, whatever ProseMirror did to the line breaks', () => {
    expect(composerHolds('Look at\nthis   screenshot', 'Look at this screenshot')).toBe(true);
    expect(composerHolds('', 'hello')).toBe(false);
    expect(composerHolds(null, 'hello')).toBe(false);
  });
});

describe('who may use it', () => {
  it('is William only: no prompt channel is reachable by an agent', () => {
    // An agent that could call these could speak in his voice to the Face and ship any file.
    for (const channel of ['prompt:send', 'prompt:pickFiles', 'prompt:describeFiles'] as const) {
      expect(CHANNELS).toContain(channel);
      expect(AGENT_METHODS as readonly string[]).not.toContain(channel);
    }
  });
});

describe('a new prompt node from the palette', () => {
  const root = JSON.parse(readFileSync(join(process.cwd(), 'board', 'root.board.json'), 'utf8')) as Board;

  it('works without being bound, so it is not a provisional TODO', () => {
    const made = makeNode(root, 'agent.prompt', { x: 4, y: 4 });
    expect(made.provisional).toBeUndefined();
    expect(made.designator?.startsWith('P')).toBe(true);
    expect(made.id.startsWith('q_')).toBe(true);
    // Explicit, so the app and tools/validate-board.mjs agree on its size.
    expect(made.footprint).toEqual(DEFAULT_FOOTPRINT['agent.prompt']);
    // A designator printed across the middle of a message box would be in the way.
    expect(made.showDesignator).toBe(false);
  });

  it('sits on the root board under the JARVIS head, feeding it', () => {
    const box = root.nodes.find((n) => n.kind === 'agent.prompt');
    const jarvis = root.nodes.find((n) => n.id === 'u1_jarvis');
    expect(box?.promptTarget).toBe('u1_jarvis');
    expect(box && jarvis && box.pos.y).toBeGreaterThan((jarvis?.pos.y ?? 0) + (jarvis?.footprint?.h ?? 0) - 1);
  });
});
