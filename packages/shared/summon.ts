import type { BoardNode } from './types.js';

/**
 * "Summon JARVIS" from a node's right-click menu.
 *
 * William: "right click a node of any kind and click 'Summon JARVIS'. When clicked it opens an
 * infused conversation with JARVIS PRIME that provides that file or folder or whatever node as
 * context and prompts for what the user's comment or directive is, then gets to work specifically
 * knowing that right-click-selected file is the target."
 *
 * This builds the task text a fresh JARVIS Prime session opens holding. It goes through
 * `startSession`'s `prompt`, which stages it to a file and never onto a command line, so a
 * directive with quotes, newlines and paths in it arrives exactly as typed.
 */

export interface SummonTarget {
  node: BoardNode;
  boardId: string;
  boardName: string;
  /** What the node resolves to on disk or on the web, if anything. */
  resolved: string | null;
  /** The resolver's verdict: ok, missing, outside-dev-root and so on. */
  state: string;
  /** Names of the nodes wired to it, for the neighbourhood it sits in. */
  neighbours: string[];
}

/** The binding fields worth quoting. Presentation fields (colours, frames, effects) are not context. */
const CONTEXT_FIELDS = ['path', 'url', 'cwd', 'restPath', 'glob', 'command', 'text', 'part', 'notes'] as const;

function quoteField(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length) return value.map(String).join(', ');
  return null;
}

export function summonPrompt(target: SummonTarget, directive: string): string {
  const { node } = target;
  const label = `${node.designator ? node.designator + ' ' : ''}${node.name}`;
  const lines: string[] = [];

  lines.push('SUMMONED FROM THE BOARD. William right-clicked a node and called you to it.');
  lines.push('');
  lines.push('TARGET');
  lines.push(`  node:     ${label} (${node.kind}), id ${node.id}`);
  lines.push(`  board:    ${target.boardName} (${target.boardId})`);
  lines.push(`  resolves: ${target.resolved ?? 'nothing on disk or the web'} [${target.state}]`);
  for (const key of CONTEXT_FIELDS) {
    const value = quoteField((node as unknown as Record<string, unknown>)[key]);
    if (value) lines.push(`  ${`${key}:`.padEnd(9)} ${value.replace(/\r?\n/g, ' / ')}`);
  }
  if (target.neighbours.length) lines.push(`  wired to: ${target.neighbours.join(', ')}`);
  lines.push('');

  const said = directive.trim();
  lines.push("WILLIAM'S DIRECTIVE");
  if (said) {
    for (const line of said.split(/\r?\n/)) lines.push(`  ${line}`);
    lines.push('');
    lines.push('Work on this target specifically. Read it first, then carry out the directive.');
  } else {
    lines.push('  (none given)');
    lines.push('');
    lines.push('Read the target first. Give William a short account of what it is and what state it is');
    lines.push('in, then ask him, in one question, what he wants done with it.');
  }
  lines.push('');
  lines.push('docs/07-SECURITY.md is still the hard boundary: never delete files, force-push or remove a');
  lines.push('board node without his explicit approval in this exchange. End with CODEX PATCH and HANDOFF.');

  return lines.join('\n');
}
