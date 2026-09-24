import { describe, expect, it } from 'vitest';
import { AGENT_METHODS, CHANNELS, REMOTE_METHODS, isRemoteMethod } from '../packages/shared/ipc.js';
import {
  FailureWindow,
  PAIR_ALPHABET,
  PAIR_CODE_LENGTH,
  formatPairCode,
  hostAllowed,
  makePairCode,
  normalisePairCode,
  originMatchesHost,
  parseClientMessage,
  prepareRemoteCall,
  remoteCsp,
  rewriteIndexHtml
} from '../packages/shared/remote.js';
import { randomBytes } from 'node:crypto';

describe('REMOTE_METHODS', () => {
  it('is a subset of CHANNELS with no repeats', () => {
    for (const m of REMOTE_METHODS) expect(CHANNELS as readonly string[]).toContain(m);
    expect(new Set(REMOTE_METHODS).size).toBe(REMOTE_METHODS.length);
  });

  it('never includes a dialog, a grant, the PC’s own files, or remote itself', () => {
    const never = [
      'pick:target', 'prompt:pickFiles', 'prompt:describeFiles', 'command:confirmDestructive',
      'node:open', 'terminal:open', 'explorer:open', 'explorer:drag', 'drag:startFile', 'ingest:classify', 'ingest:create',
      'settings:setPlan', 'models:setFableReset', 'away:setMode', 'app:autostart', 'app:setAutostart',
      'avatar:setEnabled', 'avatar:preview', 'display:info',
      'remote:status', 'remote:setEnabled', 'remote:pairCode', 'remote:revoke', 'remote:tailscaleServe'
    ];
    for (const m of never) expect(isRemoteMethod(m), m).toBe(false);
  });

  it('keeps every remote:* channel out of the agent surface too', () => {
    for (const m of AGENT_METHODS) expect(m.startsWith('remote:'), m).toBe(false);
  });
});

describe('the wire', () => {
  it('accepts auth, call and ping, and nothing malformed', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'auth', token: 'x'.repeat(43) }))).toEqual({ t: 'auth', token: 'x'.repeat(43) });
    expect(parseClientMessage(JSON.stringify({ t: 'call', id: 3, ch: 'board:load', args: ['root'] })))
      .toEqual({ t: 'call', id: 3, ch: 'board:load', args: ['root'] });
    expect(parseClientMessage('{"t":"ping"}')).toEqual({ t: 'ping' });
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'call', id: -1, ch: 'board:load', args: [] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'call', id: 1, ch: '../../etc', args: [] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'call', id: 1, ch: 'board:load', args: 'root' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'auth', token: 'short' }))).toBeNull();
  });
});

describe('pairing codes', () => {
  it('are 8 unambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = makePairCode((n) => randomBytes(n));
      expect(code).toHaveLength(PAIR_CODE_LENGTH);
      for (const ch of code) expect(PAIR_ALPHABET).toContain(ch);
    }
    expect(PAIR_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('ignore case, spaces and dashes when typed', () => {
    expect(normalisePairCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(formatPairCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });
});

describe('hosts and origins', () => {
  it('serves localhost on its own port, and tailnet names', () => {
    expect(hostAllowed('127.0.0.1:47821', 47821)).toBe(true);
    expect(hostAllowed('localhost:47821', 47821)).toBe(true);
    expect(hostAllowed('localhost:9999', 47821)).toBe(false);
    expect(hostAllowed('william-desktop.tail1234.ts.net', 47821)).toBe(true);
  });

  it('refuses a rebinding hostname and a missing Host', () => {
    expect(hostAllowed('evil.example.com', 47821)).toBe(false);
    expect(hostAllowed('ts.net.evil.com', 47821)).toBe(false);
    expect(hostAllowed(undefined, 47821)).toBe(false);
    expect(hostAllowed('my.box.lan', 47821, ['my.box.lan'])).toBe(true);
  });

  it('matches an Origin to its Host exactly', () => {
    expect(originMatchesHost('https://w.tail1.ts.net', 'w.tail1.ts.net')).toBe(true);
    expect(originMatchesHost('https://evil.com', 'w.tail1.ts.net')).toBe(false);
    expect(originMatchesHost(undefined, 'x')).toBe(false);
  });
});

describe('the served page', () => {
  const html = '<head><meta\n http-equiv="Content-Security-Policy"\n content="connect-src \'self\' ws://localhost:*"\n />\n<meta name="viewport" content="width=device-width" /></head>';

  it('swaps in a CSP for its own origin and marks itself remote', () => {
    const out = rewriteIndexHtml(html, 'w.tail1.ts.net');
    expect(out).toContain(`connect-src 'self' wss://w.tail1.ts.net ws://w.tail1.ts.net`);
    expect(out).not.toContain('ws://localhost:*');
    expect(out).toContain('name="skynet-remote"');
    expect(remoteCsp('h')).toContain("script-src 'self'");
  });

  it('cannot be broken out of by a hostile Host header', () => {
    expect(remoteCsp('a"; script-src *')).not.toContain('"');
    expect(remoteCsp('a"; script-src *')).not.toContain(' *');
  });
});

describe('failures', () => {
  it('counts within the window and forgets outside it', () => {
    const w = new FailureWindow(3, 1000);
    w.record(0); w.record(100);
    expect(w.exceeded(200)).toBe(false);
    w.record(300);
    expect(w.exceeded(300)).toBe(true);
    expect(w.exceeded(1250)).toBe(false);
  });
});

describe('prepareRemoteCall', () => {
  it('attributes command:apply to remote and strips a claimed approval', () => {
    const prepared = prepareRemoteCall('command:apply', [{
      command: { type: 'node.move', boardId: 'root', nodeId: 'a', pos: { x: 1, y: 1 } }, actor: 'user', approved: true
    }]);
    expect('args' in prepared).toBe(true);
    if ('args' in prepared) expect(prepared.args[0]).toEqual({ command: { type: 'node.move', boardId: 'root', nodeId: 'a', pos: { x: 1, y: 1 } }, actor: 'remote' });
  });

  it('refuses a destructive command outright', () => {
    const prepared = prepareRemoteCall('command:apply', [{ command: { type: 'node.delete', boardId: 'root', nodeId: 'a' }, actor: 'user', approved: true }]);
    expect('refuse' in prepared).toBe(true);
  });

  it('sends prompts as text only: a phone cannot name files on the PC', () => {
    const prepared = prepareRemoteCall('prompt:send', [{ boardId: 'root', text: 'hi', files: ['C:/secret.txt'] }]);
    if ('args' in prepared) expect((prepared.args[0] as { files: string[] }).files).toEqual([]);
    else throw new Error('refused');
  });
});
