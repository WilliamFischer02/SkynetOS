import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../packages/shared/types.js';
import { formatFaceBrief, pickHandsNode, standingOrdersBlock } from '../packages/shared/face-brief.js';

/**
 * The Face's standing orders: one file, rewritten whole, injected into every Hands briefing.
 * The failure worth guarding hardest is the wrong agent receiving orders meant for the Hands.
 */

const node = (over: Partial<BoardNode>): BoardNode => ({
  id: 'n',
  kind: 'agent.code',
  name: 'CC-SOMETHING',
  pos: { x: 0, y: 0 },
  ...over
});

describe('pickHandsNode', () => {
  it('prefers the hands tag over a name', () => {
    const nodes = [node({ id: 'named', name: 'JARVIS OTHER' }), node({ id: 'tagged', name: 'PRIME', tags: ['hands'] })];
    expect(pickHandsNode(nodes)?.id).toBe('tagged');
  });

  it('falls back on the name', () => {
    expect(pickHandsNode([node({ id: 'a' }), node({ id: 'b', name: 'JARVIS-PRIME' })])?.id).toBe('b');
  });

  it('never picks the Face', () => {
    // U1 is called JARVIS too, but it is a claude.ai conversation, not a terminal.
    const face = node({ id: 'u1_jarvis', kind: 'agent.jarvis', name: 'JARVIS', tags: ['hands'] });
    expect(pickHandsNode([face])).toBeNull();
  });

  it('returns null on a board with no Hands, so nobody gets the orders', () => {
    expect(pickHandsNode([node({ id: 'cc', name: 'CC-SKYNET' })])).toBeNull();
  });
});

describe('the standing orders in a briefing', () => {
  const message = {
    file: '2026-09-11T07-00-00-000--standing-orders.md',
    subject: 'Standing orders',
    sentAt: '2026-09-11T07:00:00.000Z',
    body: '1. Bake FACE-BOOT.md before ending a session.'
  };

  it('survives the round trip from message to file to briefing', () => {
    const block = standingOrdersBlock(formatFaceBrief(message)) ?? '';
    expect(block).toContain('1. Bake FACE-BOOT.md before ending a session.');
    expect(block).toContain('last rewritten 2026-09-11T07:00:00.000Z');
  });

  it('is labelled as standing, not new', () => {
    const block = standingOrdersBlock(formatFaceBrief(message)) ?? '';
    expect(block).toContain('STANDING ORDERS FROM THE FACE');
    expect(block).toContain('standing, not new');
    expect(block).toContain('Do not edit it');
  });

  it('does not repeat the file\'s own do-not-edit comment to the session', () => {
    expect(standingOrdersBlock(formatFaceBrief(message))).not.toContain('<!--');
  });

  it('records which archived message the orders came from', () => {
    expect(formatFaceBrief(message)).toContain(`source: codex/mailbox/archive/${message.file}`);
  });

  it('adds nothing when there are no orders', () => {
    expect(standingOrdersBlock('')).toBeNull();
    expect(standingOrdersBlock(formatFaceBrief({ ...message, body: '' }))).toBeNull();
  });
});
