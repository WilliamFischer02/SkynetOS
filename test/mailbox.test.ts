import { describe, expect, it } from 'vitest';
import { formatMessage, parseMessage, parseRun, type MailSide } from '../packages/shared/mailbox.js';

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
    expect(parsed.body).toContain('Just some prose');
  });
});
