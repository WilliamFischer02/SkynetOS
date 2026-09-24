import type { BoardNode } from './types.js';
import { footprintOf } from './types.js';

/**
 * The PROMPT → NODE box's brief to JARVIS Prime.
 *
 * William: "a type of node … that presents a jarvis hand / prime prompt text box like the others,
 * but this one prompt-injects Claude Code so it knows to build a node based on what the user wrote in
 * the prompt box before hitting send."
 *
 * So what he types is not sent as chat. It is wrapped in the instructions below and handed to a
 * FRESH JARVIS Prime session as its opening task (src/main/services/node-builder.ts), which builds
 * the node with the skynet MCP tools. Pure, so what the session is told can be tested.
 */

export interface NodeBuildBrief {
  boardId: string;
  boardName: string;
  /** The PROMPT → NODE box the request was typed into. */
  box: BoardNode;
  /** What William typed, verbatim. */
  text: string;
  /** Absolute paths he attached. Claude Code reads them itself; no bytes cross here. */
  files: string[];
}

/** Where to start looking for room: just right of the box, level with its top. */
export function suggestedBuildTile(box: BoardNode): { x: number; y: number } {
  const fp = footprintOf(box);
  return { x: box.pos.x + fp.w + 2, y: box.pos.y };
}

export function buildNodePrompt(brief: NodeBuildBrief): string {
  const { box, boardId } = brief;
  const fp = footprintOf(box);
  const start = suggestedBuildTile(box);
  const label = `${box.designator ? box.designator + ' ' : ''}${box.name}`;
  const lines: string[] = [];

  lines.push('BUILD A NODE. William typed this into a PROMPT → NODE box on the board and pressed send.');
  lines.push('He wants a node built from it. This is the task; it is not conversation.');
  lines.push('');
  lines.push('WHERE');
  lines.push(`  board:      ${brief.boardName} (id "${boardId}"). Pass boardId "${boardId}" to every skynet tool.`);
  lines.push(`  prompt box: ${label} at tile ${box.pos.x},${box.pos.y}, footprint ${fp.w}x${fp.h}.`);
  lines.push(`  placement:  free space near the box. Start at tile ${start.x},${start.y} (just right of it), or`);
  lines.push('              below it. node_create moves a node to the nearest free tile if the spot is taken.');
  lines.push('');
  lines.push('WILLIAM WROTE');
  for (const line of brief.text.trim().split(/\r?\n/)) lines.push(`  ${line}`);
  lines.push('');
  if (brief.files.length) {
    lines.push('ATTACHED FILES (part of the request: read them first)');
    for (const file of brief.files) lines.push(`  - ${file}`);
    lines.push('');
  }
  lines.push('HOW');
  lines.push('  1. Decide the kind, then call node_fields to see what that kind takes.');
  lines.push('  2. Bind it only to real, verified paths or URLs: check each one exists before writing it');
  lines.push('     (prime directive 1). If what he describes does not exist yet (a folder, a repo, a file),');
  lines.push('     ask before creating anything on disk.');
  lines.push('  3. node_create with the kind, the position and its fields, then node_update for anything');
  lines.push('     left, then edge_create to wire it to the nodes it relates to. Do NOT wire it to the');
  lines.push(`     prompt box (${box.id}): the box asked for the node, it is not part of it.`);
  lines.push('  4. If you are not sure it is what he meant, call phantom_propose instead, so William can');
  lines.push('     tick it on the board himself.');
  lines.push('  5. Report in two lines: what you placed, where, and what it points at. Ctrl+Z on the board');
  lines.push('     undoes it.');
  lines.push('');
  lines.push('If the request is ambiguous, ask one question before building. docs/07-SECURITY.md is the hard');
  lines.push('boundary: never delete files, force-push or remove a board node without his explicit approval in');
  lines.push('this exchange. End with CODEX PATCH and HANDOFF.');

  return lines.join('\n');
}
