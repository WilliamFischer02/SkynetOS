import { describe, expect, it } from 'vitest';
import {
  AWAY_ALWAYS_DENIED,
  AWAY_DEFAULT_MODEL,
  awayArgs,
  awayJournal,
  awayJournalName,
  awayPrompt,
  createAwayTracker,
  levelOf,
  logItemFor,
  parseStreamLine,
  poolCheck
} from '../packages/shared/away.js';

/* Realistic `claude -p --output-format stream-json --verbose` lines. */
const INIT = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-sonnet-5', tools: ['Read'] });
const TEXT_AND_EDIT = JSON.stringify({
  type: 'assistant',
  message: {
    id: 'msg_1',
    role: 'assistant',
    content: [
      { type: 'text', text: 'Updating the TimeServed roadmap next.' },
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'C:\\dev\\SkynetOS\\codex\\projects\\time-served.md', old_string: 'a', new_string: 'b' } }
    ],
    usage: { input_tokens: 1200, output_tokens: 80 }
  },
  session_id: 's1'
});
const PHANTOM = JSON.stringify({
  type: 'assistant',
  message: { id: 'msg_2', content: [{ type: 'tool_use', id: 'toolu_2', name: 'mcp__skynet__phantom_propose', input: { boardId: 'minecraftos', proposal: { name: 'STALKER CI' } } }], usage: { input_tokens: 300, output_tokens: 40 } }
});
const MAIL = JSON.stringify({
  type: 'assistant',
  message: { id: 'msg_3', content: [{ type: 'tool_use', id: 'toolu_3', name: 'mcp__skynet__mailbox_send', input: { to: 'to-face', subject: 'Away summary', body: 'x' } }] }
});
const DENIED = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', is_error: true, content: 'Permission to use Bash has been denied.' }] }
});
const DENIED_CALL = JSON.stringify({
  type: 'assistant',
  message: { id: 'msg_4', content: [{ type: 'tool_use', id: 'toolu_9', name: 'Bash', input: { command: 'git push' } }] }
});
const RESULT = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, duration_ms: 61000, num_turns: 9,
  result: 'Roadmaps updated for 3 projects.', total_cost_usd: 0.42, usage: { input_tokens: 9000, output_tokens: 700 }
});

describe('the command line', () => {
  const plan = awayArgs({ level: 'plan', model: AWAY_DEFAULT_MODEL, effort: 'medium', mcpConfig: 'C:\\m.json', name: 'JARVIS AWAY' });
  const work = awayArgs({ level: 'work', model: AWAY_DEFAULT_MODEL, effort: 'medium', mcpConfig: 'C:\\m.json', name: 'JARVIS AWAY' });
  const allowedOf = (args: string[]): string[] => args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  const deniedOf = (args: string[]): string[] => args.slice(args.indexOf('--disallowedTools') + 1);

  it('is headless, streamed, and denies anything no rule allows', () => {
    expect(plan[0]).toBe('-p');
    expect(plan.join(' ')).toContain('--output-format stream-json --verbose');
    expect(plan.join(' ')).toContain('--permission-mode dontAsk');
    expect(plan.join(' ')).toContain('--permission-prompts none');
    expect(plan).toContain('--strict-mcp-config');
    expect(plan[plan.indexOf('--model') + 1]).toBe('claude-sonnet-5');
  });

  it('never carries the prompt: flags only', () => {
    expect(plan.some((a) => a.includes('\n'))).toBe(false);
  });

  it('denies commit, push, delete and board destruction at every level', () => {
    for (const args of [plan, work]) {
      const denied = deniedOf(args);
      for (const tool of ['Bash(git push *)', 'Bash(git commit *)', 'Bash(rm *)', 'Bash(Remove-Item *)', 'mcp__skynet__node_delete', 'mcp__skynet__edge_delete', 'mcp__skynet__terminal_open']) {
        expect(denied).toContain(tool);
      }
      expect(allowedOf(args).some((t) => AWAY_ALWAYS_DENIED.includes(t))).toBe(false);
    }
  });

  it('writes only the codex and the roadmap', () => {
    const writes = allowedOf(plan).filter((t) => /^(Edit|Write)\(/.test(t));
    expect(writes.every((t) => t.includes('SkynetOS/codex/**') || t.includes('SkynetOS/docs/06-ROADMAP.md'))).toBe(true);
    expect(allowedOf(plan)).not.toContain('Edit');
    expect(allowedOf(plan)).not.toContain('Write');
  });

  it('lets only WORK start sessions', () => {
    expect(allowedOf(plan)).not.toContain('mcp__skynet__session_start');
    expect(deniedOf(plan)).toContain('mcp__skynet__session_start');
    expect(allowedOf(work)).toContain('mcp__skynet__session_start');
  });

  it('maps modes to levels', () => {
    expect(levelOf('plan')).toBe('plan');
    expect(levelOf('work')).toBe('work');
    expect(levelOf('visual')).toBeNull();
    expect(levelOf('off')).toBeNull();
  });
});

describe('the prompt', () => {
  it('states the bounds, the logging rule and the journal path', () => {
    const text = awayPrompt({ level: 'plan', awayMinutes: 30, startedAt: new Date(2026, 8, 11, 3, 5), capMinutes: 90 });
    expect(text).toContain('Never commit, push, delete');
    expect(text).toContain('ONE line');
    expect(text).toContain('SkynetOS/codex/journal/away-2026-09-11-0305.md');
    expect(text).toContain('You may not start sessions');
  });

  it('names the journal by local start time', () => {
    expect(awayJournalName(new Date(2026, 0, 2, 9, 7))).toBe('away-2026-01-02-0907.md');
  });
});

describe('the stream', () => {
  it('parses text, tool calls, usage, tool results and the final result', () => {
    expect(parseStreamLine(INIT)).toEqual([{ kind: 'system', text: 'session started on claude-sonnet-5' }]);
    const events = parseStreamLine(TEXT_AND_EDIT);
    expect(events.map((e) => e.kind)).toEqual(['text', 'tool', 'usage']);
    expect(parseStreamLine(DENIED)[0]).toMatchObject({ kind: 'tool-result', id: 'toolu_9', isError: true });
    expect(parseStreamLine(RESULT)[0]).toMatchObject({ kind: 'result', ok: true, costUsd: 0.42, input: 9000, output: 700 });
  });

  it('ignores junk and partial lines', () => {
    expect(parseStreamLine('')).toEqual([]);
    expect(parseStreamLine('Loading...')).toEqual([]);
    expect(parseStreamLine('{"type":"assistant","message":')).toEqual([]);
  });

  it('turns tool calls into William-readable entries', () => {
    expect(logItemFor('Edit', { file_path: 'C:/dev/SkynetOS/docs/06-ROADMAP.md' }, 1)?.kind).toBe('roadmap');
    expect(logItemFor('Write', { file_path: 'C:\\dev\\SkynetOS\\codex\\journal\\away-x.md' }, 1)?.kind).toBe('note');
    expect(logItemFor('Read', { file_path: 'C:/dev/x' }, 1)).toBeNull();
    expect(logItemFor('mcp__skynet__session_start', { boardId: 'root', nodeId: 'u2' }, 1)?.text).toBe('started a session on u2 (root)');
  });

  it('keeps a tally across a whole run', () => {
    const tracker = createAwayTracker();
    const all = [INIT, TEXT_AND_EDIT, PHANTOM, DENIED_CALL, DENIED, MAIL, RESULT].map((l) => tracker.ingest(l, 5));
    const items = all.flatMap((r) => r.items);
    expect(items.map((i) => i.kind)).toEqual(['roadmap', 'phantom', 'blocked', 'mail']);
    expect(items[2]!.text).toContain('Bash');
    const tally = tracker.tally();
    expect(tally.toolCalls).toBe(4);
    expect(tally.files).toEqual(['SkynetOS/codex/projects/time-served.md']);
    expect(tally.mailedFace).toBe(true);
    expect(tally.blocked).toBe(1);
    expect(tally.finished).toBe(true);
    expect(tally.summary).toBe('Roadmaps updated for 3 projects.');
    expect(tally.tokens).toEqual({ input: 9000, output: 700 });
  });

  it('sums per-message usage when the run is stopped before its result', () => {
    const tracker = createAwayTracker();
    tracker.ingest(TEXT_AND_EDIT, 1);
    tracker.ingest(TEXT_AND_EDIT, 2); // the same message repeated counts once
    tracker.ingest(PHANTOM, 3);
    expect(tracker.tally().tokens).toEqual({ input: 1500, output: 120 });
  });
});

describe('the pool and the journal', () => {
  it('refuses below a quarter of the pool, and allows an unknown budget with a note', () => {
    expect(poolCheck(80, 100).ok).toBe(false);
    expect(poolCheck(50, 100)).toMatchObject({ ok: true, left: 0.5 });
    expect(poolCheck(50, null)).toMatchObject({ ok: true, left: null });
  });

  it('writes a journal SkynetOS can leave when the run was stopped early', () => {
    const tracker = createAwayTracker();
    const { items } = tracker.ingest(TEXT_AND_EDIT, 1);
    const md = awayJournal({ since: 0, ended: 20 * 60_000, level: 'plan', model: 'claude-sonnet-5', endReason: 'William came back', items, tally: tracker.tally() });
    expect(md).toContain('type: away-session');
    expect(md).toContain('# Away session: 20 min, 1 item');
    expect(md).toContain('roadmap updated: SkynetOS/codex/projects/time-served.md');
    expect(md).toContain('Updating the TimeServed roadmap next.');
  });
});
