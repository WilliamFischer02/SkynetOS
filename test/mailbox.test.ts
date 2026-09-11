import { describe, expect, it } from 'vitest';
import {
  formatMessage,
  liftPastedHeader,
  normaliseSide,
  parseMessage,
  parseRun,
  type MailSide
} from '../packages/shared/mailbox.js';

/**
 * The `run:` field, which is the difference between a note and an instruction.
 *
 * William: "Jarvis (head) should be able to write to Jarvis Prime and trigger it to do things as
 * if I'm speaking to it." A message carrying `run:` opens a real terminal on his machine with a
 * task in it. So the parsing of that one field decides whether a piece of correspondence becomes a
 * running process, and the thing worth testing hardest is everything that must NOT.
 */

describe('run: decides whether a message starts a session', () => {
  it('treats an absent field as ordinary post', () => {
    // Every message written before this field existed. They must keep meaning what they meant.
    expect(parseRun('')).toBeNull();
    expect(parseRun('   ')).toBeNull();
  });

  it.each(['false', 'no', '0', 'FALSE', 'No'])('treats %s as ordinary post', (value) => {
    expect(parseRun(value)).toBeNull();
  });

  it.each(['true', 'yes', '1', 'TRUE'])('treats %s as "run on the default hands node"', (value) => {
    expect(parseRun(value)).toBe('');
  });

  it('treats anything else as a node id', () => {
    expect(parseRun('u3_jarvis_hands')).toBe('u3_jarvis_hands');
    expect(parseRun('  u3_jarvis_hands  ')).toBe('u3_jarvis_hands');
  });
});

describe('a message survives a round trip', () => {
  const base = {
    from: 'face',
    to: 'hands' as MailSide,
    subject: 'Add a bracket for the performance mods',
    sentAt: '2026-09-10T15:40:00.000Z',
    body: 'Group the four performance mods under one bracket.\n\nCall it PERFORMANCE.'
  };

  it('carries the run flag when it is set', () => {
    const parsed = parseMessage(formatMessage({ ...base, run: 'u3_jarvis_hands' }), 'x.md');
    expect(parsed.run).toBe('u3_jarvis_hands');
    expect(parsed.subject).toBe(base.subject);
    expect(parsed.body).toContain('PERFORMANCE');
  });

  it('writes no run line at all for ordinary post', () => {
    const written = formatMessage(base);
    expect(written).not.toContain('run:');
    expect(parseMessage(written, 'x.md').run).toBeNull();
  });

  it('does not read a "run" mentioned in the body as a flag', () => {
    /*
     * The body is prose written by a language model and will contain the word "run" constantly —
     * "run the tests", "the build run failed". Only the frontmatter is a field. If the body could
     * arm this, asking the Hands to run something in conversation would launch a terminal.
     */
    const written = formatMessage({ ...base, body: 'run: true\n\nPlease run the build and tell me what breaks.' });
    expect(parseMessage(written, 'x.md').run).toBeNull();
  });

  it('reads a message with no frontmatter as unflagged post', () => {
    // A malformed message must never be more powerful than a well-formed one.
    const parsed = parseMessage('Just some prose with no frontmatter at all.', '2026-01-01--note.md');
    expect(parsed.run).toBeNull();
    expect(parsed.standing).toBe(false);
    expect(parsed.body).toContain('Just some prose');
  });

  it('carries the standing flag, and writes none for ordinary post', () => {
    expect(parseMessage(formatMessage({ ...base, standing: true }), 'x.md').standing).toBe(true);
    expect(formatMessage(base)).not.toContain('standing:');
  });

  it('does not read a "standing" mentioned in the body as a flag', () => {
    const written = formatMessage({ ...base, body: 'standing: true\n\nThese are my standing orders.' });
    expect(parseMessage(written, 'x.md').standing).toBe(false);
  });
});

describe('normaliseSide', () => {
  it.each([
    ['hands', 'hands'], ['to-hands', 'hands'], ['TO-HANDS', 'hands'],
    ['face', 'face'], ['to-face', 'face'], ['to-head', 'face'], ['head', 'face']
  ])('reads %s as %s', (raw, side) => {
    // `to-head` is what the MCP tools say. It used to reach the Face's directory only by
    // falling through, with `to: to-head` written into the header.
    expect(normaliseSide(raw)).toBe(side);
  });

  it.each(['', 'hand', 'to-everyone', '../to-hands'])('refuses %j rather than guessing', (raw) => {
    expect(normaliseSide(raw)).toBeNull();
  });
});

describe('a message pasted with its header', () => {
  const pasted = [
    '---',
    'from: face',
    'to: hands',
    'subject: Fix the lighting regression',
    'run: true',
    '---',
    '',
    'Shadow acne on sloped surfaces.'
  ].join('\n');

  it('keeps the header\'s subject and run flag instead of burying them in the body', () => {
    const lifted = liftPastedHeader(pasted);
    expect(lifted?.subject).toBe('Fix the lighting regression');
    expect(lifted?.run).toBe('');
    expect(lifted?.body).toBe('Shadow acne on sloped surfaces.');
  });

  it('carries standing: across', () => {
    expect(liftPastedHeader(pasted.replace('run: true', 'standing: true'))?.standing).toBe(true);
  });

  it('tolerates leading whitespace from a clipboard', () => {
    expect(liftPastedHeader(`\n\n  ${pasted}`)?.subject).toBe('Fix the lighting regression');
  });

  it('leaves prose alone, including a rule further down', () => {
    expect(liftPastedHeader('Just a note.')).toBeNull();
    expect(liftPastedHeader('A note.\n\n---\nrun: true\n---\n')).toBeNull();
  });
});
