import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardNode } from '@shared/types.js';
import { AUDIT_PERSONA_REL, auditSessionNode } from '@shared/drive-audit.js';
import { skynetRoot } from './target-resolver.js';

/**
 * The drive auditor's launch: read its persona from the repo, then hand the chip launcher an
 * ordinary `agent.code` node. What the auditor is and why is in packages/shared/drive-audit.ts.
 */
export function auditLaunchNode(node: BoardNode): BoardNode {
  let persona: string | null = null;
  try {
    persona = readFileSync(join(skynetRoot(), AUDIT_PERSONA_REL), 'utf8');
  } catch {
    // Missing persona: auditSessionNode carries the floor rules and says the full ones were missing.
  }
  return auditSessionNode(node, persona);
}
