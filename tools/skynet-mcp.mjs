#!/usr/bin/env node
/**
 * skynet-mcp — the board, as a set of tools.
 *
 * ── What this is ─────────────────────────────────────────────────────────────────────────────
 *
 * Claude Code spawns this as a stdio MCP server (see the `mcpServers` field on an agent node, and
 * docs/04-JARVIS.md §MCP tool surface). It is a THIN PROXY and deliberately holds no state and no
 * logic: it connects to the named pipe the running SkynetOS publishes and forwards every call.
 *
 * It has to be a proxy rather than the real thing. The board is not a file you can safely edit
 * from the side — mutations go through a command bus that validates against the schema, writes a
 * snapshot, records an inverse for undo, and tells the renderer to redraw. All of that lives in
 * the Electron main process, which is already running. A second process writing board JSON behind
 * its back would break undo, skip validation, and leave the open window showing a board that no
 * longer exists on disk.
 *
 * ── What it cannot do ────────────────────────────────────────────────────────────────────────
 *
 * Nothing here decides what is allowed. Every call is dispatched by `callAsAgent` in
 * src/main/ipc.ts against AGENT_METHODS, so the authority is defined once, in the app, where it
 * can be tested — not in a script that Claude Code launches with the user's own privileges. If
 * this file were edited to ask for `settings:setPlan`, the answer would still be no.
 *
 * Deleting a node is the case worth stating plainly: `board_delete` exists, it is honest about
 * what it does, and it comes back asking for approval. docs/07-SECURITY.md allows no auto policy
 * for deletion, so the tool's job is to tell the agent to ask William, not to find a way around
 * it.
 */

import { createConnection } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { createInterface } from 'node:readline';

/*
 * ── No SDK ───────────────────────────────────────────────────────────────────────────────────
 *
 * This deliberately does not import @modelcontextprotocol/sdk. Claude Code spawns this file as a
 * bare `node tools/skynet-mcp.mjs`, which means its imports must resolve from disk at that path —
 * not from inside app.asar, where a packaged build puts node_modules. Shipping the SDK alongside
 * meant shipping seventeen transitive dependencies unpacked, and a resolution failure in any one
 * of them would present as "JARVIS Prime has no tools" with nothing in any log to say why.
 *
 * What is actually used of MCP here is three methods over newline-delimited JSON-RPC 2.0:
 * `initialize`, `tools/list`, `tools/call`. That is small, stable, and testable — and
 * test/skynet-mcp.test.ts drives it as a real client over real stdio, so "it still speaks the
 * protocol" is a thing the build checks rather than a thing a dependency promises.
 */

/* ─────────────────────────────── finding the running board ─────────────────────────────── */

/**
 * Where SkynetOS writes its control details. Must match app.getPath('userData'), which on Windows
 * is %APPDATA%/<productName> and elsewhere follows the platform convention.
 */
function controlFilePath() {
  // The same override the app honours, so a test can point both halves at a fixture.
  if (process.env['SKYNET_CONTROL_FILE']) return process.env['SKYNET_CONTROL_FILE'];
  const name = 'SkynetOS';
  if (platform() === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, name, 'control.json');
  }
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', name, 'control.json');
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), name, 'control.json');
}

/**
 * One connection, opened lazily and reused.
 *
 * Reconnecting per call would be simpler, but a board read is the most common operation by a wide
 * margin and a named pipe handshake per read is a waste. The connection is dropped on error so the
 * next call reconnects — which is also what happens when SkynetOS is restarted underneath us.
 */
let socket = null;
let pending = new Map();
let nextId = 1;
let buffer = '';

function disconnect() {
  const dead = socket;
  socket = null;
  buffer = '';
  for (const [, { reject }] of pending) reject(new Error('SKYNETOS CLOSED THE CONNECTION'));
  pending = new Map();
  dead?.destroy();
}

async function connect() {
  if (socket) return socket;

  let details;
  try {
    details = JSON.parse(readFileSync(controlFilePath(), 'utf8'));
  } catch {
    throw new Error(
      'SKYNETOS IS NOT RUNNING — no control file at ' + controlFilePath() +
      '. Start SkynetOS and try again; the board can only be read and changed while it is open.'
    );
  }

  return await new Promise((resolve, reject) => {
    const next = createConnection(details.pipePath);
    next.setEncoding('utf8');

    next.on('connect', () => {
      socket = next;
      socket.token = details.token;
      resolve(socket);
    });

    next.on('data', (chunk) => {
      buffer += chunk;
      // Newline-delimited JSON. A board read is tens of kilobytes and arrives in several chunks.
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const waiting = pending.get(message.id);
        if (!waiting) continue;
        pending.delete(message.id);
        if (message.ok) waiting.resolve(message.result);
        else waiting.reject(new Error(message.error ?? 'REFUSED'));
      }
    });

    next.on('error', (err) => {
      disconnect();
      reject(new Error(
        `COULD NOT REACH SKYNETOS (${err.message}). It writes a fresh pipe name every run, so a ` +
        'stale control file means the app was closed. Start SkynetOS and try again.'
      ));
    });

    next.on('close', () => disconnect());
  });
}

/** One request over the pipe. Rejects with whatever the app said, verbatim. */
async function call(method, params = []) {
  const connection = await connect();
  const id = nextId++;
  return await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    connection.write(JSON.stringify({ id, token: connection.token, method, params }) + '\n');
    // A call that never comes back would hang the agent's whole turn with no explanation.
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`SKYNETOS DID NOT ANSWER "${method}" WITHIN 30s`));
    }, 30_000).unref?.();
  });
}

/* ─────────────────────────────────────── the tools ─────────────────────────────────────── */

const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
});

/**
 * Every field a node may carry, described for an agent that has to fill them in.
 *
 * This is deliberately the FULL list rather than the handful the original tool surface covered.
 * William: "I want Jarvis Prime to have full access and editability over every aspect of the board
 * itself; updated access to account for elements and features we've added recently." An agent that
 * can set `name` and `pos` but not `frame`, `priority` or `logo` cannot make a node that matches
 * the ones beside it, and "formatted similarly to the pre-existing nodes" was the actual request.
 *
 * The schema is the authority — this is a description of it, and a wrong value here is rejected by
 * the same validator that rejects a wrong value typed into the editor.
 */
const NODE_FIELDS = {
  name: { type: 'string', description: 'Silkscreen label. Uppercase reads best on the board.' },
  kind: { type: 'string', description: 'One of the node kinds. Use board_kinds to list them.' },
  designator: { type: 'string', description: 'Reference designator, e.g. U4, S2, D1. Board convention: U is a chip, S storage, D a drive, J a connector, A an artifact.' },
  pos: { type: 'object', description: 'Tile position, { x, y }. Integers.', properties: { x: { type: 'integer' }, y: { type: 'integer' } } },
  footprint: { type: 'object', description: 'Size in tiles, { w, h }. Omit for the default for this kind.', properties: { w: { type: 'integer' }, h: { type: 'integer' } } },
  provisional: { type: 'boolean', description: 'This node does not point at anything yet: renders as an unpopulated footprint, a TODO on the board. A node without its target field MUST set this.' },

  // What it binds to.
  path: { type: 'string', description: 'Absolute path. For store.repo, store.folder, file.document, file.exe.' },
  url: { type: 'string', description: 'For link.url, store.cloud, agent.chat, agent.jarvis.' },
  glob: { type: 'string', description: 'For file.artifact: the build output pattern, e.g. C:/dev/Thing/build/libs/*.jar' },
  cwd: { type: 'string', description: 'Working directory. Required for agent.code and service.process.' },
  boardFile: { type: 'string', description: 'For drive.room: the room board this descends into, e.g. minecraftos/room.board.json' },
  engraving: { type: 'string', description: 'For drive.room: the line engraved under the room name.' },
  startCommand: { type: 'string', description: 'For service.process.' },
  schedule: { type: 'string', description: 'For task.scheduled.' },
  action: { type: 'string', description: 'For task.scheduled.' },
  text: { type: 'string', description: 'For note.silk: the printed text.' },
  size: { type: 'integer', description: 'For note.silk: 11 or 22. The font has no other legal sizes.' },
  image: { type: 'string', description: 'For decor.image: path to the picture.' },
  part: { type: 'string', description: 'For decor.part: which baked part, e.g. via, led, cap.' },
  members: { type: 'array', items: { type: 'string' }, description: 'For group.zone: node ids the bracket is drawn around.' },

  // How it launches.
  launch: { type: 'string', description: "agent.code only: 'popout' (a real terminal window), 'popout-elevated' (UAC every time; opt in per node), 'embedded', 'headless'." },
  prelaunch: { type: 'array', items: { type: 'string' }, description: 'Allowlisted prime steps to run before the agent starts, e.g. claude, git-fetch, npm-install. See packages/shared/prime-steps.ts.' },
  addDirs: { type: 'array', items: { type: 'string' }, description: 'Extra directories the session may read and write, as --add-dir. Each one is a second working directory with the same powers; outside a dev root the user is asked.' },
  readOnLaunch: { type: 'array', items: { type: 'string' }, description: 'Files the session is told to read before doing anything else.' },
  briefing: { type: 'string', description: "How much context a new session is handed: 'full', 'brief', or 'none'." },
  resume: { type: 'boolean', description: 'Reattach to this node\'s previous conversation. Default true.' },
  mcpServers: { type: 'object', description: 'MCP servers this agent gets, by name.' },
  openWith: { type: 'string', description: 'What a click does when this is not an agent node.' },

  // How it looks. All optional, all cosmetic, all undoable.
  logo: { type: 'string', description: 'Path to a small centred logo image, drawn over the face.' },
  showName: { type: 'boolean', description: 'Print the nameplate. Default true.' },
  showDesignator: { type: 'boolean', description: 'Print the designator. Default true.' },
  showThumbnail: { type: 'boolean', description: 'Draw the dithered face image. Default true.' },
  showLogo: { type: 'boolean', description: 'Draw the logo. Default true when one is set.' },
  frame: { type: 'string', description: "Copper that hangs off the edge: none, dip, quad, bga, fingers, tabs, rails, socket, castellated. Match the neighbours." },
  priority: { type: 'integer', description: 'Physical height, 0-5. Each level is two pixels of long shadow. 0 is flat.' },
  textColor: { type: 'string', description: 'Palette token or hex for the nameplate text.' },
  textStroke: { type: 'string', description: 'Palette token or hex for the outline around it.' },
  textPlate: { type: 'boolean', description: 'Draw a rounded pixel plate behind the text.' },
  plateColor: { type: 'string', description: 'Fill of that plate.' },
  plateBorder: { type: 'string', description: 'Border of that plate.' },
  textGlow: { type: 'boolean', description: 'Animate the title with a palette-shift glow.' },
  pulseGlow: { type: 'boolean', description: 'Animate the face with energy pulsing from the centre outwards. For decor.image backdrops.' },

  tags: { type: 'array', items: { type: 'string' }, description: 'Searchable from Ctrl+K.' },
  notes: { type: 'string', description: 'Free text shown in the inspector.' },
  codexRef: { type: 'string', description: 'Path within codex/ describing this thing.' }
};

const TOOLS = [
  {
    name: 'board_read',
    description:
      'Read a board in full: every node with every field, every trace, the grid size and the theme. ' +
      'Start here. To place a node so it matches the ones beside it, read them first and copy their ' +
      'frame, priority, footprint and display toggles. Board ids: "root" for the motherboard, or a ' +
      'room id such as "minecraftos". Use board_list to see them all.',
    inputSchema: {
      type: 'object',
      properties: { boardId: { type: 'string', description: 'Board id. "root" is the motherboard.' } },
      required: ['boardId']
    },
    run: ({ boardId }) => call('board:load', [boardId])
  },
  {
    name: 'board_list',
    description: 'List every board id: the root motherboard and every room.',
    inputSchema: { type: 'object', properties: {} },
    run: () => call('board:list', [])
  },
  {
    name: 'board_resolve',
    description:
      'Resolve every node on a board against the real filesystem: which paths exist, which are ' +
      'broken, which are outside the configured dev roots. Use this before reporting that something ' +
      'is wrong — a node can look fine on the board and point at nothing.',
    inputSchema: {
      type: 'object',
      properties: { boardId: { type: 'string' } },
      required: ['boardId']
    },
    run: ({ boardId }) => call('target:resolveBoard', [boardId])
  },
  {
    name: 'node_create',
    description:
      'Add a node to a board. It arrives unbound and provisional; set its fields with node_update, ' +
      'or pass them here as `fields`. Position is in tiles and is nudged to the nearest free space if ' +
      'the requested spot is taken. To integrate a node into an existing cluster, read the board ' +
      'first and copy the surrounding nodes\' frame, priority and footprint — a node that does not ' +
      'match its neighbours looks like a mistake.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        kind: { type: 'string', description: 'Node kind, e.g. store.repo, agent.code, drive.room, note.silk, group.zone, decor.part.' },
        pos: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
        fields: { type: 'object', description: 'Fields to set on the new node, same shape as node_update. See node_fields for the full list.', properties: NODE_FIELDS }
      },
      required: ['boardId', 'kind', 'pos']
    },
    run: async ({ boardId, kind, pos, fields }) => {
      const created = await call('node:add', [boardId, kind, pos, undefined]);
      if (!created?.ok || !created.nodeId) return created;
      if (!fields || !Object.keys(fields).length) return created;
      const updated = await call('command:apply', [{
        command: { type: 'node.update', boardId, nodeId: created.nodeId, patch: fields },
        label: `set ${Object.keys(fields).length} field(s) on ${created.nodeId}`
      }]);
      return { ...created, update: updated };
    }
  },
  {
    name: 'node_update',
    description:
      'Change fields on an existing node. Only the fields you pass are touched; pass null to clear ' +
      'one. Goes through the same validation, snapshot and undo history as a human edit, so Ctrl+Z ' +
      'reverses it. Use node_fields to see everything that can be set.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        nodeId: { type: 'string' },
        fields: { type: 'object', description: 'Fields to set. See node_fields.', properties: NODE_FIELDS },
        label: { type: 'string', description: 'What to call this in the undo history, e.g. "point PaceKeeper at its new repo".' }
      },
      required: ['boardId', 'nodeId', 'fields']
    },
    run: ({ boardId, nodeId, fields, label }) => call('command:apply', [{
      command: { type: 'node.update', boardId, nodeId, patch: fields },
      label: label ?? `update ${nodeId}`
    }])
  },
  {
    name: 'node_move',
    description: 'Move a node to a tile position. Refused if it would overlap another component or leave the board.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        nodeId: { type: 'string' },
        pos: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] }
      },
      required: ['boardId', 'nodeId', 'pos']
    },
    run: ({ boardId, nodeId, pos }) => call('command:apply', [{
      command: { type: 'node.move', boardId, nodeId, pos },
      label: `move ${nodeId}`
    }])
  },
  {
    name: 'node_delete',
    description:
      'Delete a node. This ALWAYS comes back asking for approval — SkynetOS allows no policy that ' +
      'lets an agent delete something unattended. Tell William what you want to remove and why, and ' +
      'let him confirm it in the window. Do not try to work around this.',
    inputSchema: {
      type: 'object',
      properties: { boardId: { type: 'string' }, nodeId: { type: 'string' } },
      required: ['boardId', 'nodeId']
    },
    run: ({ boardId, nodeId }) => call('command:apply', [{
      command: { type: 'node.delete', boardId, nodeId },
      label: `delete ${nodeId}`
    }])
  },
  {
    name: 'edge_create',
    description:
      'Draw a trace between two nodes. Kinds describe the relationship: supervises, reads, writes, ' +
      'builds, depends, deploys. The router works out the copper path; you choose the endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        id: { type: 'string', description: 'Trace id, lowercase, e.g. e12.' },
        from: { type: 'string', description: 'Node id.' },
        to: { type: 'string', description: 'Node id.' },
        kind: { type: 'string' },
        width: { type: 'integer', description: '1-4. Heavier traces read as more important.' },
        label: { type: 'string' }
      },
      required: ['boardId', 'id', 'from', 'to', 'kind']
    },
    run: ({ boardId, id, from, to, kind, width, label }) => call('command:apply', [{
      command: {
        type: 'edge.create',
        boardId,
        edge: { id, from, to, kind, ...(width ? { width } : {}), ...(label ? { label } : {}) }
      },
      label: `trace ${from} -> ${to}`
    }])
  },
  {
    name: 'edge_delete',
    description: 'Remove a trace. Like node_delete, this requires the user to approve it in the window.',
    inputSchema: {
      type: 'object',
      properties: { boardId: { type: 'string' }, edgeId: { type: 'string' } },
      required: ['boardId', 'edgeId']
    },
    run: ({ boardId, edgeId }) => call('command:apply', [{
      command: { type: 'edge.delete', boardId, edgeId },
      label: `delete trace ${edgeId}`
    }])
  },
  {
    name: 'node_fields',
    description:
      'Every field a node can carry, with what each one means. Read this before building a node — it ' +
      'covers binding (path, url, cwd, glob), launching (launch, prelaunch, addDirs, briefing) and ' +
      'appearance (frame, priority, logo, the text and glow options).',
    inputSchema: { type: 'object', properties: {} },
    run: () => NODE_FIELDS
  },
  {
    name: 'session_start',
    description:
      'Open a real Claude Code terminal on an agent node, on William\'s desktop, in that node\'s ' +
      'working directory — optionally already holding a task.\n\n' +
      'This is the main thing you are for. If William asks you to fix something in a repo that has a ' +
      'node on the board, do not try to fix it yourself from here: start a session on that node with ' +
      'a `prompt` describing the job, and a window opens in the right place with the work in front of ' +
      'it.\n\n' +
      'Write the prompt as you would brief a capable colleague who is about to open that repo for the ' +
      'first time: what to change, where, and how to tell it worked. The session already knows where ' +
      'it is and what the node is for.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        nodeId: { type: 'string', description: 'An agent.code node. Use board_read to find one.' },
        prompt: { type: 'string', description: 'The task the session opens holding. Appended to its briefing.' },
        fresh: { type: 'boolean', description: 'Start a new conversation instead of resuming the last one.' }
      },
      required: ['boardId', 'nodeId']
    },
    run: ({ boardId, nodeId, prompt, fresh }) =>
      call('session:start', [boardId, nodeId, { fresh: fresh === true, ...(prompt ? { prompt } : {}) }])
  },
  {
    name: 'session_list',
    description: 'Every Claude Code session running right now, with which node it belongs to and how long it has been up.',
    inputSchema: { type: 'object', properties: {} },
    run: () => call('session:list', [])
  },
  {
    name: 'session_stop',
    description: 'Stop a running session by its id (from session_list).',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId']
    },
    run: ({ sessionId }) => call('session:stop', [sessionId])
  },
  {
    name: 'terminal_open',
    description:
      'Open a plain terminal in a node\'s directory — no agent, just a shell. For when William wants ' +
      'a console somewhere rather than a session doing work.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        nodeId: { type: 'string' },
        elevated: { type: 'boolean', description: 'Administrator. Prompts UAC every time. Only when asked for.' }
      },
      required: ['boardId', 'nodeId']
    },
    run: ({ boardId, nodeId, elevated }) => call('terminal:open', [boardId, nodeId, { elevated: elevated === true }])
  },
  {
    name: 'open_target',
    description: 'Open a node\'s real target the way a double click would — the folder, the file, the URL.',
    inputSchema: {
      type: 'object',
      properties: { boardId: { type: 'string' }, nodeId: { type: 'string' } },
      required: ['boardId', 'nodeId']
    },
    run: ({ boardId, nodeId }) => call('node:open', [boardId, nodeId])
  },
  {
    name: 'classify_path',
    description:
      'Ask what a real path on disk is — a git repo, a plain folder, a build artifact, an executable — ' +
      'and what node kind and fields would represent it. Use this when importing something from the ' +
      'dev root onto the board: classify first, then node_create with what it tells you.',
    inputSchema: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths.' } },
      required: ['paths']
    },
    run: ({ paths }) => call('ingest:classify', [paths])
  },
  {
    name: 'usage_summary',
    description: 'Token usage: the rate, the pool left, and how long the current window has to run.',
    inputSchema: { type: 'object', properties: {} },
    run: () => call('usage:summary', [])
  },
  {
    name: 'usage_routes',
    description: 'How the token spend divides across the projects on a board. This is what the couriers walking the traces are in proportion to.',
    inputSchema: {
      type: 'object',
      properties: { boardId: { type: 'string' } },
      required: ['boardId']
    },
    run: ({ boardId }) => call('usage:routes', [boardId])
  },
  {
    name: 'mailbox_read',
    description:
      'Read post. "to-hands" is what JARVIS Head has sent you; "to-head" is what you have sent back. ' +
      'Anything unread here was written for you and is worth acting on.',
    inputSchema: {
      type: 'object',
      properties: { side: { type: 'string', description: '"to-hands" or "to-head".' } },
      required: ['side']
    },
    run: ({ side }) => call('mailbox:list', [side])
  },
  {
    name: 'mailbox_send',
    description: 'Write to the other half of JARVIS. Use "to-head" to report back what you did.',
    inputSchema: {
      type: 'object',
      properties: {
        side: { type: 'string', description: '"to-head" or "to-hands".' },
        subject: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['side', 'subject', 'body']
    },
    // `from` was never sent, so every message an agent wrote was signed "undefined".
    run: ({ side, subject, body }) => call('mailbox:send', [side, { from: 'hands', subject, body }])
  },
  {
    name: 'mailbox_archive',
    description: 'Mark a message handled so it stops arriving in future briefings.',
    inputSchema: {
      type: 'object',
      properties: { side: { type: 'string' }, file: { type: 'string' } },
      required: ['side', 'file']
    },
    run: ({ side, file }) => call('mailbox:archive', [side, file])
  },
  {
    name: 'history',
    description: 'What has been changed on the board recently, by whom, and what Ctrl+Z would undo.',
    inputSchema: { type: 'object', properties: {} },
    run: () => call('command:history', [])
  }
];

/* ──────────────────────────────────────── the server ───────────────────────────────────── */

/**
 * The protocol version we answer with.
 *
 * MCP's handshake is "the client names a version, the server names the version it will use". We
 * echo a version we know we satisfy rather than parroting whatever the client asked for, because
 * claiming to speak a future revision we have never seen is how a client ends up calling a method
 * that does not exist here.
 */
const PROTOCOL_VERSION = '2024-11-05';

const RESULTS = {
  initialize: {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: 'skynet', version: '0.1.0' }
  },
  tools: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}
`);
}

async function handle(request) {
  switch (request.method) {
    case 'initialize':
      return RESULTS.initialize;

    case 'tools/list':
      return RESULTS.tools;

    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === request.params?.name);
      if (!tool) return { ...text(`NO SUCH TOOL — "${request.params?.name}"`), isError: true };
      try {
        return text(await tool.run(request.params?.arguments ?? {}));
      } catch (err) {
        /*
         * Errors come back as tool RESULTS, not as JSON-RPC errors. An agent handed a protocol
         * error is told the call failed and nothing else; an agent handed the text can read
         * "SKYNETOS IS NOT RUNNING" or "node.delete REQUIRES EXPLICIT APPROVAL" and do something
         * sensible about it.
         */
        return { ...text(String(err instanceof Error ? err.message : err)), isError: true };
      }
    }

    case 'ping':
      return {};

    default:
      return null; // Signals "method not found" to the caller below.
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;

  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  // A notification has no id and takes no reply. `notifications/initialized` is the common one.
  if (request.id === undefined || request.id === null) return;

  void handle(request).then(
    (result) => {
      if (result === null) {
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } });
        return;
      }
      send({ jsonrpc: '2.0', id: request.id, result });
    },
    (err) => {
      send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(err?.message ?? err) } });
    }
  );
});

// stdin closing is the client going away. Nothing to flush; the pipe connection dies with us.
process.stdin.on('end', () => process.exit(0));
