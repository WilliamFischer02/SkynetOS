#!/usr/bin/env node
/**
 * Validates every board/**\/*.board.json against schema/board.schema.json,
 * then runs graph-level checks the schema can't express.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = process.cwd();
const BOARD_DIR = join(ROOT, 'board');
const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'board.schema.json'), 'utf8'));
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const validate = ajv.compile(schema);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === '.snapshots') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.board.json')) out.push(p);
  }
  return out;
}

let failures = 0;
const files = walk(BOARD_DIR);
const byId = new Map();

for (const file of files) {
  const rel = relative(ROOT, file);
  const board = JSON.parse(readFileSync(file, 'utf8'));
  const problems = [];

  if (!validate(board)) {
    for (const e of validate.errors) problems.push(`schema ${e.instancePath || '/'} ${e.message}`);
  }

  /*
   * Canonical form: 2-space JSON, LF, trailing newline — exactly what the app's writer emits
   * (canonicalBoardJson in src/main/services/board-store.ts). Enforced so that an edit made in
   * the app produces a ONE LINE diff instead of reformatting the whole file and burying the
   * change. If this fails, the fix is to run the file through the same serialisation, not to
   * relax the check.
   */
  const raw = readFileSync(file, 'utf8');
  const canonical = JSON.stringify(board, null, 2).replace(/\r\n/g, '\n') + '\n';
  if (raw !== canonical) {
    const reason = raw.includes('\r\n')
      ? 'it has CRLF line endings'
      : raw.length === canonical.length
        ? 'whitespace differs'
        : `it is ${raw.length} bytes, canonical is ${canonical.length}`;
    problems.push(
      `not in canonical form (${reason}) — the app would reformat the whole file on the first edit. ` +
      `Fix: node -e "const f='${rel.replace(/\\/g, '/')}',fs=require('fs');fs.writeFileSync(f,JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')),null,2)+'\\n')"`
    );
  }

  if (byId.has(board.id)) problems.push(`duplicate board id "${board.id}" (also in ${byId.get(board.id)})`);
  byId.set(board.id, rel);

  const ids = new Set();
  const occupied = new Map();
  const DEFAULT_FOOTPRINT = { 'agent.jarvis': [8, 6], 'agent.code': [3, 3], 'agent.chat': [4, 4], 'drive.room': [6, 4], 'store.repo': [4, 3], 'store.folder': [4, 3], 'store.cloud': [4, 3], 'file.document': [2, 2], 'file.exe': [2, 2], 'file.artifact': [3, 2], 'link.url': [2, 2], 'service.process': [3, 2], 'task.scheduled': [2, 1], 'monitor.system': [4, 4], 'note.silk': [0, 0], 'group.zone': [0, 0], 'decor.image': [12, 8] };

  for (const n of board.nodes ?? []) {
    if (ids.has(n.id)) problems.push(`duplicate node id "${n.id}"`);
    ids.add(n.id);

    const [dw, dh] = DEFAULT_FOOTPRINT[n.kind] ?? [2, 2];
    const w = n.footprint?.w ?? dw, h = n.footprint?.h ?? dh;
    // decor.image joins the printed kinds: a backdrop is meant to sit UNDER the components,
    // so counting it as an obstacle would make every board it is on fail the overlap check.
    if (n.kind !== 'note.silk' && n.kind !== 'group.zone' && n.kind !== 'decor.image') {
      if (n.pos.x + w > board.grid.width || n.pos.y + h > board.grid.height) {
        problems.push(`node "${n.id}" extends past the board edge`);
      }
      for (let y = n.pos.y; y < n.pos.y + h; y++) {
        for (let x = n.pos.x; x < n.pos.x + w; x++) {
          const key = `${x},${y}`;
          if (occupied.has(key)) problems.push(`node "${n.id}" overlaps "${occupied.get(key)}" at ${key}`);
          else occupied.set(key, n.id);
        }
      }
    }

    if (n.kind === 'drive.room') {
      const child = resolve(BOARD_DIR, n.boardFile);
      if (!existsSync(child) && !n.provisional) {
        problems.push(`room node "${n.id}" points at missing board file ${n.boardFile} (mark it provisional if intentional)`);
      }
    }

    for (const field of ['path', 'cwd']) {
      const v = n[field];
      if (typeof v === 'string' && v.includes('..')) problems.push(`node "${n.id}" ${field} contains ".." — path traversal is not allowed`);
    }
  }

  for (const e of board.edges ?? []) {
    if (!ids.has(e.from)) problems.push(`edge "${e.id}" from unknown node "${e.from}"`);
    if (!ids.has(e.to)) problems.push(`edge "${e.id}" to unknown node "${e.to}"`);
  }

  if (problems.length) {
    failures++;
    console.error(`\nFAIL  ${rel}`);
    for (const p of [...new Set(problems)]) console.error(`      - ${p}`);
  } else {
    console.log(`ok    ${rel}  (${board.nodes.length} nodes, ${board.edges.length} traces)`);
  }
}

if (failures) { console.error(`\n${failures} board file(s) invalid. Build blocked.\n`); process.exit(1); }
console.log('\nBoard data OK.');
