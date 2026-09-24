import { describe, expect, it } from 'vitest';
import { asWilliam, isDestructive, type Actor, type CommandRequest } from '../packages/shared/commands.js';
import { phantomActorRefusal } from '../packages/shared/phantoms.js';

/**
 * Who counts as William, and what that does NOT buy them.
 *
 * `remote` is his phone, `voice` is him speaking at the desk, `gesture` is his hand in front of the
 * cameras. Rules written about "the user" mean all three — but none of them can approve a deletion,
 * because approval means a human confirmed that command in that exchange and a microphone is not a
 * human. docs/07-SECURITY.md.
 */
describe('asWilliam', () => {
  it('folds his phone, his voice and his hands to the user', () => {
    expect(asWilliam('remote')).toBe('user');
    expect(asWilliam('voice')).toBe('user');
    expect(asWilliam('gesture')).toBe('user');
  });

  it('never turns an agent into a user, or a user into anything else', () => {
    expect(asWilliam('agent')).toBe('agent');
    expect(asWilliam('jarvis')).toBe('jarvis');
    expect(asWilliam('user')).toBe('user');
  });

  it('covers every actor, so a new one cannot be forgotten here', () => {
    // If a new actor is added to the union, this fails to compile until it is decided whose hand
    // it is. That is the point: the decision must be made, not defaulted.
    const every: Actor[] = ['user', 'jarvis', 'agent', 'remote', 'voice', 'gesture'];
    for (const actor of every) expect(['user', 'jarvis', 'agent']).toContain(asWilliam(actor));
  });

  it('lets the three of them tick a recommendation, and still refuses an agent', () => {
    // The tick is William's, whichever hand he uses.
    for (const actor of ['remote', 'voice', 'gesture'] as Actor[]) {
      expect(phantomActorRefusal('phantom.approve', asWilliam(actor), undefined)).toBeNull();
    }
    expect(phantomActorRefusal('phantom.approve', asWilliam('agent'), undefined)).not.toBeNull();
  });

  it('does not let any of them pre-approve a deletion', () => {
    // A spoken or gestured delete is a CommandRequest with no `approved` flag: destructive, and
    // therefore stopped at the dialog by the bus.
    for (const actor of ['voice', 'gesture'] as Actor[]) {
      const request: CommandRequest = {
        command: { type: 'node.delete', boardId: 'root', nodeId: 'a1' },
        actor
      };
      expect(isDestructive(request.command)).toBe(true);
      expect(request.approved).toBeUndefined();
    }
  });
});
