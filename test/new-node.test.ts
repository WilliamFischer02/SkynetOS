import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { NODE_KINDS, type Board, type NodeKind } from '../packages/shared/types.js';
import { makeNode } from '../src/main/services/node-factory.js';

/**
 * Everything the "+" palette can add must survive validation.
 *
 * ── Why this test exists ─────────────────────────────────────────────────────────────────────
 *
 * Reported: adding a link node was refused with "edit rejected: nodes must have..." — and it was
 * not only link nodes. Eight of the eleven kinds the palette offers could not be added at all.
 *
 * Two rules, each defensible alone, contradicted each other. services/node-factory.ts creates a
 * new node UNBOUND and `provisional: true` on purpose (prime directive 1: never fabricate a
 * target — a new repo node points at nothing and says so). schema/board.schema.json required
 * every kind to declare its target: a link has a url, a repo has a path, an agent has a cwd. So
 * the factory produced a node the schema would never accept, and the command bus rejected the
 * edit before it reached the board.
 *
 * Neither rule was wrong; the requirement just needed to be conditional on the claim. This test
 * runs the REAL factory against the REAL schema, so the two cannot drift apart again — a new kind
 * with a new required field is caught here rather than by a user clicking "+".
 */

const ROOT = process.cwd();
const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'board.schema.json'), 'utf8'));
const board = JSON.parse(readFileSync(join(ROOT, 'board', 'root.board.json'), 'utf8')) as Board;

// The same Ajv configuration main uses, so a pass here means a pass there.
const validate = addFormats(new Ajv2020({ allErrors: true, strict: false })).compile(schema);

/** Validate a board with `node` appended, returning Ajv's complaints. */
function reasonsToReject(node: unknown): string[] {
  if (validate({ ...board, nodes: [...board.nodes, node] })) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

describe('a node from the palette is a node the board accepts', () => {
  it.each([...NODE_KINDS])('%s', (kind) => {
    const node = makeNode(board, kind as NodeKind, { x: 4, y: 4 });
    expect(reasonsToReject(node), `a new ${kind} cannot be added to a board`).toEqual([]);
  });

  it('gives every new node a free id', () => {
    const taken = new Set(board.nodes.map((n) => n.id));
    for (const kind of NODE_KINDS) expect(taken.has(makeNode(board, kind, { x: 4, y: 4 }).id)).toBe(false);
  });
});

/**
 * The exemption above is narrow by design, and this is the half that matters more: `provisional`
 * excuses a node from naming its target and NOTHING else. If it ever starts excusing a node from
 * the rest of the schema, the schema has stopped being a schema.
 */
describe('provisional excuses a node from its target and nothing else', () => {
  const link = { id: 'j_test_link', kind: 'link.url', name: 'X', pos: { x: 4, y: 4 } };

  it('lets an unbound node exist while it is marked a TODO', () => {
    expect(reasonsToReject({ ...link, provisional: true })).toEqual([]);
  });

  it('still demands a target from a node that has not made that claim', () => {
    expect(reasonsToReject(link).join()).toContain("must have required property 'url'");
    expect(reasonsToReject({ ...link, provisional: false }).join()).toContain("must have required property 'url'");
  });

  it('still refuses an unknown property', () => {
    // `cdw` for `cwd` is the typo the closed schema exists to catch.
    expect(reasonsToReject({ ...link, provisional: true, cdw: 'C:/dev' }).join())
      .toContain('must NOT have additional properties');
  });

  it('still refuses a kind that does not exist', () => {
    expect(reasonsToReject({ ...link, provisional: true, kind: 'link.nope' }).join())
      .toContain('must be equal to one of the allowed values');
  });

  it('still refuses a malformed id', () => {
    expect(reasonsToReject({ ...link, provisional: true, id: 'Not An Id' })).not.toEqual([]);
  });
});
