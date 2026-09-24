import type { BoardNode } from './types.js';

/**
 * The drive auditor: a Claude Code chip rooted at a drive instead of a repo.
 *
 * William: "a drive analyzer and organizer that I can give access to a drive, we discuss the
 * contents of the drive and the ai determines what should stay on the drive, what can be cleaned,
 * and how to reorganize without breaking my dependencies - it should be incredibly perceptive so
 * as to avoid accidentally deleting sentimental or important files … Opening it opens claude code
 * and the computer root with the ability to 'hop' to other drives."
 *
 * ── How it is built ───────────────────────────────────────────────────────────────────────────
 *
 * Not new launch machinery: an `agent.audit` node is turned into an `agent.code` launch at the
 * moment it starts, and everything else (the confirmation dialogs, the conversation id, the
 * resume, the model choice) is the chip code that already works. What differs:
 *
 *   - `cwd` is a drive, and `addDirs` are the other drives it may hop to, each confirmed on every
 *     launch because a drive is outside every dev root (docs/07).
 *   - The persona, codex/personas/drive-auditor.md, is INLINED into the briefing rather than put
 *     on the reading list. The reading list is resolved inside the working directory, and the
 *     auditor's working directory is a drive with no codex on it. More importantly, rules the
 *     session has to go and fetch are rules it can skip.
 *   - It never runs elevated. A node set to `popout-elevated` launches `popout`. The persona
 *     forbids anything that would need elevation, and a drive audit is exactly where a UAC-granted
 *     mistake would do the most damage.
 *
 * Pure: test/drive-audit.test.ts holds it.
 */

export const AUDIT_PERSONA_REL = 'codex/personas/drive-auditor.md';

/**
 * The rules the auditor carries even if the persona file is missing. The persona file is the full
 * version; this is the floor, so a deleted or moved persona cannot produce an auditor without them.
 */
export const AUDIT_FLOOR = [
  'You are the drive auditor. You survey, classify and PROPOSE; William approves each change.',
  'You never delete anything. "Clean" means move into <drive>:\\_skynet-quarantine\\<date>\\ with a MANIFEST.md of original paths.',
  'Treat photos, video, documents, anything personal, anything with a .git folder, credentials, and anything modified in the last 30 days as KEEP until William says otherwise.',
  'Before moving anything, find what depends on it: shortcuts, PATH, registry, services, scheduled tasks, symlinks, IDE workspaces, SkynetOS board targets.',
  'Never run elevated, never change permissions, never touch Windows or Program Files except to read sizes.',
  '"I don\'t know what this is" is a correct answer. It puts the item in ASK.'
].join('\n');

/** Every drive this node covers: where it starts, then the ones it may hop to. */
export function auditDrives(node: Pick<BoardNode, 'cwd' | 'addDirs'>): string[] {
  const out: string[] = [];
  for (const d of [node.cwd, ...(node.addDirs ?? [])]) {
    const trimmed = d?.trim();
    if (trimmed && !out.some((x) => x.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed);
  }
  return out;
}

/**
 * The `agent.code` launch an `agent.audit` node stands for.
 *
 * `persona` is the text of codex/personas/drive-auditor.md, or null if it could not be read, in
 * which case `AUDIT_FLOOR` stands in and the briefing says the full rules were missing.
 */
export function auditSessionNode(node: BoardNode, persona: string | null): BoardNode {
  const drives = auditDrives(node);
  const [home, ...others] = drives;
  const notes = node.initialPrompt?.trim();
  const brief = [
    persona?.trim()
      ? persona.trim()
      : `${AUDIT_FLOOR}\n\n(${AUDIT_PERSONA_REL} could not be read, so these are the floor rules only. Tell William.)`,
    '',
    `You start at ${home ?? 'no drive (the node has no starting drive set)'}.`,
    others.length ? `You may hop to: ${others.join(', ')}.` : 'You have not been granted any other drive.',
    ...(notes ? ['', "William's notes for this audit:", notes] : [])
  ].join('\n');

  return {
    ...node,
    kind: 'agent.code',
    initialPrompt: brief,
    // The persona is in the briefing; there is nothing on a drive root to read first.
    readOnLaunch: [],
    persona: undefined,
    briefing: node.briefing ?? 'every',
    prelaunch: node.prelaunch ?? ['claude'],
    mcpServers: node.mcpServers ?? ['skynet'],
    launch: node.launch === 'popout-elevated' || !node.launch ? 'popout' : node.launch
  };
}
