import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_METHODS, CHANNELS } from '../packages/shared/ipc.js';

/**
 * The MCP proxy, end to end.
 *
 * This spawns the real `tools/skynet-mcp.mjs` as a child process, speaks real MCP over its stdio,
 * and answers it over a real named pipe. Nothing here is a stand-in for the transport: the whole
 * point of the proxy is that it is a pipe client and a stdio server at the same time, and mocking
 * either half would test the half that was never in doubt.
 *
 * What stands in for SkynetOS is the pipe server below, which records what it was asked for. That
 * is the correct seam — the app's own authority is tested separately, against AGENT_METHODS.
 */

const ROOT = process.cwd();
let dir = '';
let pipeServer: Server | null = null;
let child: ChildProcessWithoutNullStreams | null = null;

/** Every method the proxy asked for, in order, with the token it presented. */
const asked: { method: string; params: unknown[]; token: string }[] = [];

/** What the fake app answers, by method. Anything unset comes back as a plain ok. */
const answers = new Map<string, unknown>();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'skynet-mcp-'));
  const token = randomBytes(8).toString('hex');
  const pipePath = process.platform === 'win32'
    ? `\\\\.\\pipe\\skynet-test-${randomBytes(6).toString('hex')}`
    : join(dir, 'control.sock');

  pipeServer = createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line.trim()) continue;
        const request = JSON.parse(line) as { id: number; method: string; params: unknown[]; token: string };
        asked.push({ method: request.method, params: request.params, token: request.token });
        // Same shape src/main/services/control-server.ts replies with.
        if (request.token !== token) {
          socket.write(`${JSON.stringify({ id: request.id, ok: false, error: 'REFUSED' })}\n`);
        } else {
          const result = answers.get(request.method) ?? { ok: true };
          socket.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
        }
      }
    });
  });

  await new Promise<void>((resolve) => pipeServer!.listen(pipePath, resolve));

  const controlFile = join(dir, 'control.json');
  writeFileSync(controlFile, JSON.stringify({ pipePath, token, pid: process.pid }), 'utf8');

  child = spawn(process.execPath, [join(ROOT, 'tools', 'skynet-mcp.mjs')], {
    env: { ...process.env, SKYNET_CONTROL_FILE: controlFile },
    stdio: ['pipe', 'pipe', 'pipe']
  });
}, 20_000);

afterAll(() => {
  child?.kill();
  pipeServer?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** One JSON-RPC round trip with the spawned server, over its stdio. */
let rpcId = 0;
function rpc(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 10_000);
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown>; error?: unknown };
        if (message.id !== id) continue;
        clearTimeout(timer);
        child!.stdout.off('data', onData);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result ?? {});
        return;
      }
    };
    child!.stdout.on('data', onData);
    child!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

describe('the MCP server speaks MCP', () => {
  it('initialises', async () => {
    const result = await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0' }
    });
    expect((result['serverInfo'] as { name: string }).name).toBe('skynet');
  }, 20_000);

  it('lists the tools JARVIS Prime needs', async () => {
    const result = await rpc('tools/list');
    const names = (result['tools'] as { name: string }[]).map((t) => t.name);

    /*
     * The two the whole feature exists for. William: "I could ask jarvis prime to fix a mod I'm
     * working on, and it initiates the claude code window in the correct repo and feeds it a
     * tailored prompt" — session_start — and "full access and editability over every aspect of the
     * board itself" — the node_ tools.
     */
    for (const required of [
      'session_start', 'terminal_open',
      'board_read', 'board_list', 'node_create', 'node_update', 'node_move', 'node_delete',
      'edge_create', 'edge_delete', 'node_fields',
      'mailbox_read', 'mailbox_send'
    ]) {
      expect(names, `the tool surface is missing ${required}`).toContain(required);
    }
  });

  it('describes every node field an agent would need to match an existing node', async () => {
    const result = await rpc('tools/call', { name: 'node_fields', arguments: {} });
    const described = JSON.parse((result['content'] as { text: string }[])[0]!.text) as Record<string, unknown>;

    /*
     * The appearance fields matter as much as the binding ones. "Integrate it into the space within
     * that room" and "formatted similarly to the pre-existing nodes" are not satisfiable by an
     * agent that can set a name and a position but cannot see that its neighbours all have
     * `frame: 'dip'` and `priority: 2`.
     */
    for (const field of [
      'path', 'url', 'cwd', 'glob', 'boardFile',
      'launch', 'prelaunch', 'addDirs', 'briefing',
      'frame', 'priority', 'logo', 'showLogo', 'textColor', 'textGlow', 'pulseGlow',
      'footprint', 'designator', 'provisional'
    ]) {
      expect(Object.keys(described), `node_fields does not mention "${field}"`).toContain(field);
    }
  });
});

describe('the proxy forwards to the app rather than deciding anything', () => {
  it('presents the token from the control file on every call', async () => {
    asked.length = 0;
    await rpc('tools/call', { name: 'board_list', arguments: {} });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.method).toBe('board:list');
    expect(asked[0]!.token, 'the proxy called without the control token').toBeTruthy();
  });

  it('sends a session task as a parameter, never on a command line', async () => {
    asked.length = 0;
    await rpc('tools/call', {
      name: 'session_start',
      arguments: { boardId: 'root', nodeId: 'u2_agent_skynet', prompt: 'Fix the "lighting" bug\nin src/render.ts' }
    });
    expect(asked[0]!.method).toBe('session:start');
    const [boardId, nodeId, options] = asked[0]!.params as [string, string, { prompt: string }];
    expect(boardId).toBe('root');
    expect(nodeId).toBe('u2_agent_skynet');
    // Quotes and newlines survive intact because they never go near a shell.
    expect(options.prompt).toContain('"lighting"');
    expect(options.prompt).toContain('\n');
  });

  it('routes a delete through the command bus, where approval is enforced', async () => {
    asked.length = 0;
    await rpc('tools/call', { name: 'node_delete', arguments: { boardId: 'root', nodeId: 's9_thing' } });
    expect(asked[0]!.method).toBe('command:apply');
    const [request] = asked[0]!.params as [{ command: { type: string }; approved?: boolean }];
    expect(request.command.type).toBe('node.delete');
    // The proxy must never assert approval on its own behalf. docs/07: no auto policy for deletion.
    expect(request.approved, 'the proxy pre-approved its own delete').toBeUndefined();
  });

  it('reports a refusal as text the agent can act on, not a protocol error', async () => {
    const result = await rpc('tools/call', { name: 'not_a_tool', arguments: {} });
    expect(result['isError']).toBe(true);
    expect((result['content'] as { text: string }[])[0]!.text).toContain('NO SUCH TOOL');
  });
});

/**
 * ── The authority itself ─────────────────────────────────────────────────────────────────────
 *
 * The proxy cannot grant itself anything; `callAsAgent` is the gate. These are about what that
 * gate lets through, and they are the tests worth breaking the build over.
 */
describe('what an agent may reach', () => {
  it('grants only channels that exist', () => {
    for (const method of AGENT_METHODS) {
      expect(CHANNELS as readonly string[], `${method} is not a real channel`).toContain(method);
    }
  });

  it('withholds the channels docs/07 reserves for the user', () => {
    const granted: readonly string[] = AGENT_METHODS;
    for (const forbidden of [
      // "Settings, allowlists and elevation are user-only."
      'settings:setPlan',
      // The approval dialog. An agent that can call it is an agent that approves its own deletes.
      'command:confirmDestructive',
      // Summons a native modal in front of the user.
      'pick:target',
      // The undo stack is shared and not per-actor: an agent's undo reverts whatever happened last.
      'command:undo',
      'command:redo',
      // Hands a real file to whatever the OS drops it on.
      'drag:startFile'
    ]) {
      expect(granted, `${forbidden} must not be reachable by an agent`).not.toContain(forbidden);
    }
  });

  it('grants what the feature actually requires', () => {
    const granted: readonly string[] = AGENT_METHODS;
    for (const needed of ['session:start', 'terminal:open', 'board:load', 'command:apply', 'node:add', 'mailbox:send']) {
      expect(granted, `JARVIS Prime cannot work without ${needed}`).toContain(needed);
    }
  });
});
