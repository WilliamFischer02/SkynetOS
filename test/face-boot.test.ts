import { describe, expect, it } from 'vitest';
import {
  BOOT_MARKER,
  MAIL_LIMIT,
  composeFaceBoot,
  handoffState,
  sameBake,
  type BootBoard,
  type BootMail,
  type FaceBootInput
} from '../src/main/services/face-boot.js';

/**
 * FACE-BOOT.md is the Face's whole view of this repo from a cold start: it can reach the root page
 * and one hop from there, nothing else. So what is IN the file, and in what order, is the contract.
 */

const mail = (file: string, subject = file): BootMail => ({
  file,
  subject,
  from: 'hands',
  sentAt: '2026-09-11T05:00:00.000Z',
  body: `Body of ${subject}.`
});

const board = (over: Partial<BootBoard> = {}): BootBoard => ({
  id: 'root',
  name: 'SkynetOS Mainboard',
  file: 'board/root.board.json',
  nodeCount: 3,
  edgeCount: 1,
  faults: [],
  provisional: [],
  ...over
});

const input = (over: Partial<FaceBootInput> = {}): FaceBootInput => ({
  bakedAt: '2026-09-11T06:00:00.000Z',
  machine: 'WILLIAM-DESKTOP',
  index: '# Codex index\n\n- `persona.md` — who JARVIS is.',
  mail: [],
  boards: [board()],
  handoff: '# handoff.md\n\n**Last session:** did things.\n\n---\n\n## What is next\n\n1. **A board selector** — more.\n',
  standing: null,
  tools: ['board_read', 'node_update'],
  ...over
});

describe('FACE-BOOT.md', () => {
  it('opens with the generated marker, so nobody edits it by hand', () => {
    expect(composeFaceBoot(input()).split('\n')[0]).toBe(BOOT_MARKER);
  });

  it('puts the four sections in the order the Face asked for', () => {
    const text = composeFaceBoot(input());
    const order = ['## 1. Codex index', '## 2. Mail for the Face', '## 3. Board truth', '## 4. State of the Hands'];
    const at = order.map((heading) => text.indexOf(heading));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('inlines the codex index verbatim', () => {
    expect(composeFaceBoot(input())).toContain('- `persona.md` — who JARVIS is.');
  });

  it('says so when the index is missing, instead of leaving a hole', () => {
    expect(composeFaceBoot(input({ index: null }))).toContain('`codex/index.md` is missing.');
  });

  it('lists mail newest first, whatever order it was read in', () => {
    const text = composeFaceBoot(input({
      mail: [mail('2026-09-10T01-00-00-000--older.md', 'Older'), mail('2026-09-11T01-00-00-000--newer.md', 'Newer')]
    }));
    expect(text.indexOf('### Newer')).toBeLessThan(text.indexOf('### Older'));
    expect(text).toContain('(2 unread, newest first)');
  });

  it('inlines only the newest messages and counts the rest', () => {
    const many = Array.from({ length: MAIL_LIMIT + 2 }, (_, i) => mail(`2026-09-${String(i + 1).padStart(2, '0')}--m${i}.md`));
    const text = composeFaceBoot(input({ mail: many }));
    expect(text).toContain('2 older message(s) not shown');
    // The two oldest are the ones left out.
    expect(text).not.toContain('Body of 2026-09-01--m0.md.');
    expect(text).toContain(`Body of ${many[many.length - 1]?.file}.`);
  });

  it('fences a body that contains fences of its own', () => {
    // A body that closed the block early would spill the rest of itself into the page.
    const text = composeFaceBoot(input({ mail: [{ ...mail('x.md'), body: 'Look:\n\n````ts\nconst a = 1;\n````' }] }));
    expect(text).toContain('`````markdown');
  });

  it('lists every unresolved target with its path, and every provisional node', () => {
    const text = composeFaceBoot(input({
      boards: [board({
        faults: [{ nodeId: 'f4', label: 'F4 Truth Quest Retro', kind: 'file.exe', state: 'missing', target: 'C:/dev/TruthQuestRetro/player.exe' }],
        provisional: [{ nodeId: 'j2', label: 'J2 DIRTY PLUSH', kind: 'link.url' }]
      })]
    }));
    expect(text).toContain('### Unresolved targets (1)');
    expect(text).toContain('**MISSING** `C:/dev/TruthQuestRetro/player.exe`');
    expect(text).toContain('### Provisional nodes (1)');
    expect(text).toContain('J2 DIRTY PLUSH (`j2`, link.url)');
  });

  it('says plainly when nothing is broken', () => {
    expect(composeFaceBoot(input())).toContain('Every target on every board resolves.');
  });

  it('names the machine the board truth was resolved on', () => {
    // Two desktops resolve the same board differently. A fault list without a machine is a claim
    // about nowhere.
    expect(composeFaceBoot(input())).toContain('Resolved against the disk of WILLIAM-DESKTOP');
  });

  it('lists the Hands tools when it has them', () => {
    expect(composeFaceBoot(input())).toContain('`board_read` · `node_update`');
    expect(composeFaceBoot(input({ tools: [] }))).not.toContain('## 6.');
  });

  it('shows the standing orders in force, since the Face owns them and cannot otherwise see them', () => {
    const text = composeFaceBoot(input({ standing: '---\nwritten-at: 2026-09-11T08:00:00.000Z\n---\n\n## CURRENT OBJECTIVE\nShip it.' }));
    expect(text).toContain('## 5. Standing orders in force');
    expect(text).toContain('## CURRENT OBJECTIVE');
    // After the four sections the Face numbered, so its numbering still holds.
    expect(text.indexOf('## 4. State of the Hands')).toBeLessThan(text.indexOf('## 5. Standing orders'));
  });

  it('says when no standing orders have been written', () => {
    expect(composeFaceBoot(input())).toContain('None. `codex/face-brief.md` has not been written.');
  });
});

describe('handoffState', () => {
  const md = [
    '# handoff.md',
    '',
    'Rewritten at the end of every session. This is what the next agent reads first.',
    '',
    '**Last session:** built the face bake.',
    '**`npm run verify` is green.**',
    '',
    '---',
    '',
    '## Landmines',
    '',
    'Something long that must not be copied.',
    '',
    '## What is next',
    '',
    '1. **A board selector** — save and load variations.',
    '2. **Rooms within rooms.** `drive.room` already points at a board file.',
    '',
    '## Afterwards',
    '',
    '3. **Not this one.**'
  ].join('\n');

  it('keeps the lead block and drops the boilerplate line', () => {
    const state = handoffState(md);
    expect(state).toContain('**Last session:** built the face bake.');
    expect(state).not.toContain('Rewritten at the end');
  });

  it('compresses rather than duplicates: nothing past the first rule', () => {
    expect(handoffState(md)).not.toContain('Something long');
  });

  it('carries the titles of what is next, and only those', () => {
    const state = handoffState(md);
    expect(state).toContain('1. A board selector');
    expect(state).toContain('2. Rooms within rooms');
    expect(state).not.toContain('Not this one');
  });

  it('says so when there is no handoff at all', () => {
    expect(handoffState(null)).toContain('handoff.md is missing');
  });
});

describe('sameBake', () => {
  it('ignores the timestamp, so a commit that changes nothing does not churn the file', () => {
    expect(sameBake(composeFaceBoot(input()), composeFaceBoot(input({ bakedAt: '2027-01-01T00:00:00.000Z' })))).toBe(true);
  });

  it('notices a real change', () => {
    expect(sameBake(composeFaceBoot(input()), composeFaceBoot(input({ mail: [mail('a.md')] })))).toBe(false);
  });
});
