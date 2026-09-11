/**
 * npm run face:bake — writes FACE-BOOT.md at the repo root, for the Face.
 *
 * What goes in it, and why it has to be at the root, is in src/main/services/face-boot.ts.
 *
 * TypeScript run through vite-node rather than a plain .mjs like the other tools, because section
 * 3 resolves every node through src/main/services/target-resolver.ts. A second resolver written
 * in .mjs would drift from the one the board uses to draw broken hardware, and then "broken
 * according to FACE-BOOT" and "broken on the board" would stop meaning the same thing.
 *
 * Read-only except for FACE-BOOT.md, and that is left untouched when nothing but the timestamp
 * would change, so a commit that alters nothing the Face cares about does not churn the file.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, relative } from 'node:path';
import type { Board } from '../packages/shared/types.js';
import { parseMessage } from '../packages/shared/mailbox.js';
import { resolveNodeTarget } from '../src/main/services/target-resolver.js';
import {
  FAULT_STATES,
  composeFaceBoot,
  nodeLabel,
  sameBake,
  type BootBoard,
  type BootMail
} from '../src/main/services/face-boot.js';

const ROOT = process.cwd();
const OUT = join(ROOT, 'FACE-BOOT.md');

function read(rel: string): string | null {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

/** Every `*.board.json` under board/, recursively, root board first. */
function boardFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '.snapshots') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) boardFiles(path, out);
    else if (path.endsWith('.board.json')) out.push(path);
  }
  return out.sort((a, b) => Number(b.endsWith('root.board.json')) - Number(a.endsWith('root.board.json')) || a.localeCompare(b));
}

function faceMail(): BootMail[] {
  const dir = join(ROOT, 'codex', 'mailbox', 'to-face');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const parsed = parseMessage(readFileSync(join(dir, file), 'utf8'), file);
      return { file, subject: parsed.subject, from: parsed.from, sentAt: parsed.sentAt, body: parsed.body };
    });
}

function boardTruth(file: string): BootBoard {
  const board = JSON.parse(readFileSync(file, 'utf8')) as Board;
  const faults: BootBoard['faults'] = [];
  const provisional: BootBoard['provisional'] = [];
  for (const node of board.nodes) {
    const target = resolveNodeTarget(node);
    if (FAULT_STATES.includes(target.state)) {
      faults.push({
        nodeId: node.id,
        label: nodeLabel(node),
        kind: node.kind,
        state: target.state,
        target: target.resolved ?? target.raw ?? target.detail ?? '(no target set)'
      });
    }
    if (node.provisional) provisional.push({ nodeId: node.id, label: nodeLabel(node), kind: node.kind });
  }
  return {
    id: board.id,
    name: board.name,
    file: relative(ROOT, file).replace(/\\/g, '/'),
    nodeCount: board.nodes.length,
    edgeCount: board.edges?.length ?? 0,
    faults,
    provisional
  };
}

/** The skynet MCP tool names, read from the server itself so the list cannot go stale. */
function mcpTools(): string[] {
  const source = read('tools/skynet-mcp.mjs') ?? '';
  // A tool is a `name:` followed by a `description:`, which is what separates the 22 tools from the
  // server's own name in its handshake. `history` has no underscore, so the name alone is no guide.
  return [...source.matchAll(/^\s*name:\s*'([a-z_]+)',\s*\r?\n\s*description:/gm)]
    .map((m) => m[1] ?? '')
    .filter(Boolean)
    .sort();
}

const boards = boardFiles(join(ROOT, 'board')).map(boardTruth);
const next = composeFaceBoot({
  bakedAt: new Date().toISOString(),
  machine: process.env['COMPUTERNAME'] ?? hostname(),
  index: read('codex/index.md'),
  mail: faceMail(),
  boards,
  handoff: read('handoff.md'),
  tools: mcpTools()
});

const faults = boards.reduce((sum, b) => sum + b.faults.length, 0);
const summary = `${boards.length} boards, ${faults} unresolved target(s)`;
const previous = read('FACE-BOOT.md');
if (previous !== null && sameBake(previous, next)) {
  console.log(`FACE-BOOT.md is current (${summary}).`);
} else {
  writeFileSync(OUT, next, 'utf8');
  console.log(`Wrote FACE-BOOT.md (${summary}).`);
}
