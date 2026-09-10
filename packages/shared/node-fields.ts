/**
 * What each node kind can be edited to, field by field.
 *
 * This is the single description of the node edit interface. The inspector builds its form from
 * it, the target picker knows which button to offer from `control`, and `test/node-fields.test.ts`
 * checks it against `schema/board.schema.json` so the form can never drift from what the schema
 * will actually accept. Add a field to the schema without adding it here and the test fails.
 *
 * Prime directive 1 is why `control` exists at all: a node that "binds to reality" needs a way to
 * pick the real thing. A free-text path box invites typos that the board then renders as broken
 * hardware; a Browse button and a Verify check make the real target the easy option.
 */

import type { BoardNode, NodeKind } from './types.js';

/**
 * How a field is edited.
 *  text        one line
 *  textarea    prose — notes, prompts
 *  number      integer
 *  boolean     checkbox
 *  select      one of `options`
 *  tags        comma-separated list -> string[]
 *  path-file   a file on disk. Offers Browse (native open dialog) + existence check.
 *  path-dir    a directory on disk. Offers Browse (native folder dialog) + existence check.
 *  glob        a path with a `*` in it. Resolves to the newest match and shows which file won.
 *  url         http/https. Shape-validated. Reachability is NOT checked — see targets.ts.
 *  board-file  a path to another board JSON, relative to board/.
 *  json        a raw JSON object (task.scheduled action)
 */
export type FieldControl =
  | 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'tags'
  | 'path-file' | 'path-dir' | 'glob' | 'url' | 'board-file' | 'json';

/** Controls that name something outside the board and therefore need verifying. */
export const TARGET_CONTROLS = ['path-file', 'path-dir', 'glob', 'url', 'board-file'] as const;
export type TargetControl = (typeof TARGET_CONTROLS)[number];

export function isTargetControl(control: FieldControl): control is TargetControl {
  return (TARGET_CONTROLS as readonly string[]).includes(control);
}

export interface FieldSpec {
  key: keyof BoardNode;
  label: string;
  control: FieldControl;
  /** Required by the JSON Schema for this kind. The form refuses to save without it. */
  required?: boolean;
  options?: readonly string[];
  placeholder?: string;
  help?: string;
  /** For path-file: the native dialog's file filters. */
  filters?: readonly { name: string; extensions: string[] }[];
}

/** On every kind. */
const COMMON: FieldSpec[] = [
  { key: 'name', label: 'Name', control: 'text', required: true, placeholder: 'CC-STALKER', help: 'Max 40 chars. Shown in the inspector and the command bar.' },
  { key: 'designator', label: 'Designator', control: 'text', placeholder: 'U4', help: 'Reference designator, like a real board. U4, J2, D7. How you refer to this node when talking to an agent.' }
];

/** On every kind, shown last. */
const TRAILING: FieldSpec[] = [
  {
    key: 'image', label: 'Face image', control: 'path-file',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico'] }],
    help: "Any image. It is downsampled to this node's footprint and dithered onto the room's six palette colours, so it reads as part of the board rather than a pasted photo. The file is never copied or modified."
  },
  { key: 'tags', label: 'Tags', control: 'tags', placeholder: 'minecraft, mods', help: 'Comma separated. Searchable from Ctrl+K.' },
  { key: 'notes', label: 'Notes', control: 'textarea', help: 'Free text. Never rendered on the board.' },
  { key: 'codexRef', label: 'Codex ref', control: 'text', placeholder: 'codex/projects/the-stalker.md', help: 'The markdown file in codex/ that describes this thing.' },
  { key: 'provisional', label: 'Provisional', control: 'boolean', help: 'Renders as an unpopulated footprint — a TODO printed on the board. A real PCB convention and a good way to place a node before its target exists.' }
];

const OPEN_WITH: FieldSpec = {
  key: 'openWith', label: 'Open with', control: 'select',
  options: ['explorer', 'default', 'browser', 'terminal', 'vscode'],
  help: 'What a click does. explorer reveals it in File Explorer; default hands it to Windows; vscode runs `code <path>`.'
};

const BY_KIND: Record<NodeKind, FieldSpec[]> = {
  'agent.code': [
    { key: 'cwd', label: 'Working directory', control: 'path-dir', required: true, placeholder: 'C:/dev/TheStalker', help: 'The repo the Claude Code session opens in. This is the session\'s whole world.' },
    { key: 'launch', label: 'Launch mode', control: 'select', required: true, options: ['popout', 'popout-elevated', 'embedded', 'headless'], help: 'popout opens Windows Terminal. popout-elevated triggers a UAC prompt every launch and is badged on the sprite — opt in per node only.' },
    { key: 'model', label: 'Model', control: 'text', placeholder: 'claude-opus-5', help: 'Optional. Omit to use the CLI default.' },
    { key: 'resume', label: 'Resume prior session', control: 'boolean', help: 'On: reattaches to this node\'s own conversation with `claude --resume`. Off: a fresh context every launch.' },
    { key: 'initialPrompt', label: 'Initial prompt', control: 'textarea', help: 'Sent on first launch only, not on resume.' },
    { key: 'mcpServers', label: 'MCP servers', control: 'tags', placeholder: 'skynet-mcp' }
  ],
  'agent.chat': [
    { key: 'url', label: 'Conversation URL', control: 'url', required: true, placeholder: 'https://claude.ai/project/…', help: 'A specific claude.ai conversation or Project. Not a fresh Claude — that exact conversation.' },
    { key: 'partition', label: 'Session partition', control: 'text', placeholder: 'persist:jarvis', help: 'Keeps this webview logged in and separate from the others.' },
    { key: 'persona', label: 'Persona brief', control: 'path-file', placeholder: 'codex/personas/observer.md', filters: [{ name: 'Markdown', extensions: ['md'] }] }
  ],
  'agent.jarvis': [
    { key: 'url', label: 'Conversation URL', control: 'url', required: true, placeholder: 'https://claude.ai/project/…', help: 'JARVIS\'s Face — the persistent conversation with board-wide jurisdiction.' },
    { key: 'partition', label: 'Session partition', control: 'text', placeholder: 'persist:jarvis' },
    { key: 'persona', label: 'Persona brief', control: 'path-file', placeholder: 'codex/persona.md', filters: [{ name: 'Markdown', extensions: ['md'] }] }
  ],
  'drive.room': [
    { key: 'boardFile', label: 'Board file', control: 'board-file', required: true, placeholder: 'minecraftos/room.board.json', help: 'The nested board this drive descends into, relative to board/.' },
    { key: 'engraving', label: 'Engraving', control: 'text', required: true, placeholder: 'MINECRAFTOS', help: 'Printed on the shield can. Uppercase, A-Z 0-9 and . _ - only, max 20.' },
    { key: 'relation', label: 'Related room', control: 'text', placeholder: 'gameos', help: 'A board id. Shares that room\'s signal colour to show the two are connected.' }
  ],
  'store.repo': [
    { key: 'path', label: 'Repository path', control: 'path-dir', required: true, placeholder: 'C:/dev/TheStalker' },
    { key: 'remote', label: 'Remote URL', control: 'url', placeholder: 'https://github.com/you/TheStalker' },
    OPEN_WITH
  ],
  'store.folder': [
    { key: 'path', label: 'Folder path', control: 'path-dir', required: true, placeholder: 'C:/dev/assets' },
    OPEN_WITH
  ],
  'store.cloud': [
    { key: 'url', label: 'Cloud URL', control: 'url', required: true, placeholder: 'https://drive.google.com/drive/folders/…' },
    { key: 'localPath', label: 'Local mirror', control: 'path-dir', help: 'Optional. The synced folder on this machine, if there is one.' }
  ],
  'file.document': [
    { key: 'path', label: 'Document', control: 'path-file', required: true, placeholder: 'C:/Users/you/Documents/Novel.docx', filters: [{ name: 'Documents', extensions: ['docx', 'doc', 'md', 'txt', 'pdf', 'rtf', 'odt'] }] },
    OPEN_WITH
  ],
  'file.exe': [
    { key: 'path', label: 'Executable', control: 'path-file', required: true, placeholder: 'C:/dev/tool/build/tool.exe', filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd', 'ps1'] }] },
    { key: 'args', label: 'Arguments', control: 'tags', placeholder: '--flag, value' },
    { key: 'cwd', label: 'Working directory', control: 'path-dir' },
    { key: 'confirmBeforeLaunch', label: 'Confirm before launch', control: 'boolean', help: 'On by default. Leave it on for anything outside a dev root.' }
  ],
  'file.artifact': [
    { key: 'glob', label: 'Artifact glob', control: 'glob', required: true, placeholder: 'C:/dev/TheStalker/build/libs/*.jar', help: 'Resolves to the newest match, so the node always points at the current build.' },
    { key: 'exclude', label: 'Exclude', control: 'tags', placeholder: '*-sources.jar, *-dev.jar', help: 'Glob patterns to skip. Gradle produces several jars; this is how you get the right one.' },
    { key: 'versionPattern', label: 'Version pattern', control: 'text', placeholder: '-(\\d+\\.\\d+\\.\\d+)\\.jar$', help: 'Regex with one capture group. The capture becomes the version label on the cartridge.' }
  ],
  'link.url': [
    { key: 'url', label: 'URL', control: 'url', required: true, placeholder: 'https://www.curseforge.com/minecraft/mc-mods/…' }
  ],
  'service.process': [
    { key: 'startCommand', label: 'Start command', control: 'text', required: true, placeholder: 'npm run dev', help: 'Run inside the working directory below. Never elevated.' },
    { key: 'cwd', label: 'Working directory', control: 'path-dir', required: true },
    { key: 'port', label: 'Port', control: 'number', placeholder: '5173' },
    { key: 'healthUrl', label: 'Health URL', control: 'url', placeholder: 'http://localhost:5173/' }
  ],
  'task.scheduled': [
    { key: 'schedule', label: 'Schedule (cron)', control: 'text', required: true, placeholder: '0 22 * * *', help: 'Five fields: minute hour day month weekday.' },
    { key: 'action', label: 'Action', control: 'json', required: true, help: 'A JSON object. e.g. {"type":"jarvis.headless","prompt":"…"}' },
    { key: 'enabled', label: 'Enabled', control: 'boolean' }
  ],
  'monitor.system': [],
  'note.silk': [
    { key: 'text', label: 'Text', control: 'textarea', required: true, placeholder: 'PHASE 1 — FOUNDATIONS', help: 'Engraved on the board. Uppercase reads correctly here.' },
    { key: 'size', label: 'Size', control: 'select', options: ['11', '22'], help: 'Departure Mono is pixel-perfect at 11 and 22 only.' }
  ],
  'group.zone': [
    { key: 'members', label: 'Members', control: 'tags', placeholder: 'u1_agent_stalker, s1_repo_stalker', help: 'Node ids inside this zone. Selecting the zone selects them all.' },
    { key: 'relation', label: 'Related room', control: 'text', placeholder: 'gameos', help: 'A board id. Outlines this cluster in that room\'s signal colour to show they are connected.' }
  ]
};

/** The full, ordered field list for a kind: identity, kind-specific, then the common trailers. */
export function fieldsFor(kind: NodeKind): FieldSpec[] {
  return [...COMMON, ...(BY_KIND[kind] ?? []), ...TRAILING];
}

/** Just the fields that name something real and can therefore be picked and verified. */
export function targetFieldsFor(kind: NodeKind): FieldSpec[] {
  return fieldsFor(kind).filter((f) => isTargetControl(f.control));
}

/**
 * Fields that are pickable and verifiable but are NOT what the node points at.
 *
 * `image` is a face, not a target. It needs a Browse button and an existence check like any
 * other path, but clicking a note.silk must not "open" its picture, and the inspector must not
 * report a decorative image as the thing this component is bound to.
 */
const NON_TARGET_KEYS: readonly (keyof BoardNode)[] = ['image'];

/**
 * The one field that IS this node's target — what a click acts on and what the inspector shows
 * as "resolved". Returns undefined for kinds that point at nothing (note.silk, group.zone,
 * monitor.system, task.scheduled).
 */
export function primaryTargetField(kind: NodeKind): FieldSpec | undefined {
  const fields = targetFieldsFor(kind).filter((f) => !NON_TARGET_KEYS.includes(f.key));
  return fields.find((f) => f.required) ?? fields[0];
}

/** Required fields missing from a node. Empty array means the form may be saved. */
export function missingRequired(node: BoardNode): FieldSpec[] {
  return fieldsFor(node.kind).filter((f) => {
    if (!f.required) return false;
    const value = node[f.key];
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  });
}
