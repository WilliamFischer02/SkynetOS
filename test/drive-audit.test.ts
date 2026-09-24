import { describe, expect, it } from 'vitest';
import { AUDIT_FLOOR, auditDrives, auditSessionNode } from '../packages/shared/drive-audit.js';
import type { BoardNode } from '../packages/shared/types.js';

/**
 * The drive auditor. William: "it should be incredibly perceptive so as to avoid accidentally
 * deleting sentimental or important files."
 *
 * The rules themselves live in a persona file. What code can guarantee is that they always
 * arrive: inlined into the briefing, never left on a reading list the session might skip, with a
 * floor that survives the persona file going missing, and never on an elevated launch.
 */

const audit = (over: Partial<BoardNode> = {}): BoardNode => ({
  id: 'u9_audit', kind: 'agent.audit', name: 'DRIVE AUDIT', pos: { x: 0, y: 0 }, cwd: 'D:/', addDirs: ['E:/', 'd:/'], ...over
});

describe('the drives an audit covers', () => {
  it('starts at cwd and hops to the rest, without listing a drive twice', () => {
    expect(auditDrives(audit())).toEqual(['D:/', 'E:/']);
  });
});

describe('the launch an audit becomes', () => {
  const persona = '# Drive auditor\n\nYou never delete anything.';

  it('is an ordinary Claude Code launch, so the chip machinery runs it', () => {
    const node = auditSessionNode(audit(), persona);
    expect(node.kind).toBe('agent.code');
    expect(node.id).toBe('u9_audit');
    expect(node.cwd).toBe('D:/');
  });

  it('carries the persona IN the briefing, not on a reading list', () => {
    const node = auditSessionNode(audit(), persona);
    expect(node.initialPrompt).toContain('You never delete anything.');
    expect(node.readOnLaunch).toEqual([]);
    expect(node.persona).toBeUndefined();
    expect(node.initialPrompt).toContain('You start at D:/.');
    expect(node.initialPrompt).toContain('You may hop to: E:/.');
  });

  it('still carries the floor rules if the persona file is missing, and says so', () => {
    const node = auditSessionNode(audit(), null);
    expect(node.initialPrompt).toContain(AUDIT_FLOOR);
    expect(node.initialPrompt).toContain('could not be read');
  });

  it('adds William\'s notes under the rules, never instead of them', () => {
    const node = auditSessionNode(audit({ initialPrompt: 'Leave the Pictures folder alone.' }), persona);
    const brief = node.initialPrompt ?? '';
    expect(brief.indexOf('You never delete anything.')).toBeLessThan(brief.indexOf('Leave the Pictures folder alone.'));
  });

  it('never launches elevated, whatever the node says', () => {
    expect(auditSessionNode(audit({ launch: 'popout-elevated' }), persona).launch).toBe('popout');
    expect(auditSessionNode(audit(), persona).launch).toBe('popout');
  });

  it('re-briefs on every launch and gets the board tools by default', () => {
    const node = auditSessionNode(audit(), persona);
    expect(node.briefing).toBe('every');
    expect(node.mcpServers).toEqual(['skynet']);
  });
});
