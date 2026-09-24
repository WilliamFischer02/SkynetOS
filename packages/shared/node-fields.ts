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

import { PRIME_STEP_IDS } from './prime-steps.js';
import { DECOR_PARTS } from './types.js';
import { PALETTE_TOKENS } from './palette.js';
import { FRAME_BLURB, NODE_FRAMES } from './frames.js';
import { PROMPT_MODES } from './prompt.js';
import { LOGO_SOURCES, LOGO_SOURCE_LABELS } from './logo-source.js';
import type { BoardNode, NodeKind } from './types.js';

/**
 * How a field is edited.
 *  text        one line
 *  textarea    prose — notes, prompts
 *  number      integer
 *  boolean     checkbox
 *  select      one of `options`
 *  tags        comma-separated list -> string[]
 *  multi       a set of tickers over `options` -> string[]. For allowlisted ids, where free
 *              text would be wrong: the choices are the only legal values.
 *  dir-list    a list of directories, each with its own Browse button and existence check.
 *              Used by `addDirs`, which is how an agent reaches repos outside its own cwd.
 *  footprint   two tile counts, w and h. The typed path to scaling a node; the corner handle
 *              and Shift+arrows are the other two.
 *  priority    a 0-5 slider. Drawn as layers of long shadow, so the control is a slider rather
 *              than a number: you are choosing a height, not entering a value.
 *  path-file   a file on disk. Offers Browse (native open dialog) + existence check.
 *  path-dir    a directory on disk. Offers Browse (native folder dialog) + existence check.
 *  glob        a path with a `*` in it. Resolves to the newest match and shows which file won.
 *  url         http/https. Shape-validated. Reachability is NOT checked — see targets.ts.
 *  board-file  a path to another board JSON, relative to board/.
 *  json        a raw JSON object (task.scheduled action)
 */
export type FieldControl =
  | 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'tags' | 'multi'
  | 'path-file' | 'path-dir' | 'glob' | 'url' | 'board-file' | 'json'
  | 'dir-list' | 'footprint' | 'priority' | 'rotation' | 'percent';

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
  /**
   * A target field that is the node's target only when it is filled in. `journalVault` on a
   * task.scheduled: a journal task points at its vault, an ordinary cron task at nothing, and an
   * empty optional target must not render every such task as broken.
   */
  optionalTarget?: boolean;
  /**
   * This field and its group-mates satisfy "required" between them: exactly one must be filled.
   *
   * `file.document` is the case this exists for. William: "many of my word docs are hosted in
   * onedrive so instead of a hard drive directory they have an https address." A document is a
   * document whether it lives on a disk or behind a URL, and forcing a path on one that has none
   * would mean either a second node kind for the same thing or a node that renders broken forever.
   */
  requiredOneOf?: string;
  options?: readonly string[];
  placeholder?: string;
  help?: string;
  /** For path-file: the native dialog's file filters. */
  filters?: readonly { name: string; extensions: string[] }[];
  /**
   * Only shown while this boolean field is on. How an effect's colour and speed stay out of the
   * way until the effect itself is ticked. William: "when those effects are enabled color and speed
   * modifiers for the animation."
   */
  showWhen?: keyof BoardNode;
  /** For `select`: what to show for each option, when the stored value is not what a person should read. */
  optionLabels?: Readonly<Record<string, string>>;
  /**
   * For `select`: one line about each option, shown as the tooltip of the option and of the select
   * while that option is chosen. `help` says what the field is; this says what the choice does.
   */
  optionHelp?: Readonly<Record<string, string>>;
  /** For `percent`: the range the control offers. Defaults to 10–300. */
  min?: number;
  max?: number;
}

/** On every kind. */
const COMMON: FieldSpec[] = [
  { key: 'name', label: 'Name', control: 'text', required: true, placeholder: 'CC-STALKER', help: 'Max 40 chars. Shown in the inspector and the command bar.' },
  { key: 'designator', label: 'Designator', control: 'text', placeholder: 'U4', help: 'Reference designator, like a real board. U4, J2, D7. How you refer to this node when talking to an agent.' }
];

// Only what the mosaic can decode: Electron reads PNG, JPEG and ICO; GIF goes through omggif.
// WebP and BMP are not offered, because they would fail on load (mosaic.ts says so if one gets in).
const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'ico'] }];

/** On every kind, shown last. */
const TRAILING: FieldSpec[] = [
  {
    key: 'footprint', label: 'Size', control: 'footprint',
    help: 'Width and height in tiles. Also draggable from the corner handle in Edit Board mode (E), or Shift+arrows on the keyboard. 1 to 24.'
  },
  {
    key: 'image', label: 'Wallpaper', control: 'path-file',
    filters: IMAGE_FILTERS,
    help: "Any image. Stretched to fill the whole footprint and dithered onto the room's six palette colours, so it reads as part of the board rather than a pasted photo. The file is never copied or modified."
  },
  {
    key: 'logo', label: 'Logo', control: 'path-file',
    filters: IMAGE_FILTERS,
    help: 'A smaller badge centred on the wallpaper, cropped to the shape of the image itself so a wide logo stays wide. Use one with a transparent background and the wallpaper shows around it.'
  },
  {
    key: 'logoSource', label: 'Logo source', control: 'select',
    options: LOGO_SOURCES,
    optionLabels: LOGO_SOURCE_LABELS,
    help: "Logo image: the Logo file above (the default). JARVIS face (still): the avatar's still face, dithered onto the room's palette like any logo. JARVIS face (animated): the face window's own box, alive on the board: it floats, blinks, and talks while this node's JARVIS is responding, in the frames' true colours. None: no logo. Show logo off still hides whichever is chosen. Frames come from assets/avatar/jarvis."
  },
  {
    key: 'logoScale', label: 'Logo size', control: 'percent',
    help: 'How big the badge is, as a percentage of the size the footprint suggests. The shape never changes — this scales the box the image is fitted into.'
  },
  {
    key: 'showThumbnail', label: 'Show wallpaper', control: 'boolean',
    help: 'Draw the wallpaper across the whole footprint. Off keeps the drawn package silhouette and leaves the image bound to the node.'
  },
  {
    key: 'showLogo', label: 'Show logo', control: 'boolean',
    help: 'Draw the logo badge centred on the face. Independent of the wallpaper — a badge on a drawn package reads well, and so does a photograph with nothing over it.'
  },
  {
    key: 'imageAnimate', label: 'Animate GIFs', control: 'boolean',
    help: 'A GIF wallpaper or logo plays, every frame dithered onto the room\'s palette. Untick to hold its first frame. Up to 120 frames animate; a very large GIF keeps fewer, and says so.'
  },
  {
    key: 'frame', label: 'Frame', control: 'select',
    options: NODE_FRAMES,
    optionHelp: FRAME_BLURB,
    help: 'The copper that hangs off the edge of this node — pin legs, connector fingers, mounting tabs, a socket ring. Works with a wallpaper: the frame draws in a margin outside the footprint, so it never covers the picture and never changes what the node collides with.'
  },
  {
    key: 'priority', label: 'Priority / height', control: 'priority',
    help: 'How important this node is, shown as physical height. Each level is two pixels of long shadow cast down and to the right — a level-3 node sits six pixels proud. Deliberately thin: it is a hierarchy cue, not a skyline.'
  },
  {
    key: 'textColor', label: 'Text colour', control: 'select',
    options: PALETTE_TOKENS,
    help: "The colour this node's text is printed in. Palette tokens only — signal, mask-dark and mask-light take on whatever the ROOM's are, so a note keeps its room's accent when you look at it there."
  },
  {
    key: 'textStroke', label: 'Text outline', control: 'select',
    options: PALETTE_TOKENS,
    help: 'A one-pixel outline stamped around every glyph. Use mask-dark for a near-black edge that keeps text readable over a busy backdrop. Leave unset for none.'
  },
  {
    key: 'textPlate', label: 'Text plate', control: 'boolean',
    help: 'Print the text on a rounded pixel box that sizes itself to the text. What keeps a legend readable where the board is busy — over traces, over a backdrop, under couriers.'
  },
  {
    key: 'plateColor', label: 'Plate fill', control: 'select',
    options: PALETTE_TOKENS,
    help: "The plate's fill colour. Defaults to the room's mask-dark."
  },
  {
    key: 'plateBorder', label: 'Plate border', control: 'select',
    options: PALETTE_TOKENS,
    help: "The plate's 1px border. Defaults to copper-dark."
  },
  {
    key: 'textGlow', label: 'Text glow', control: 'boolean',
    help: "Pulse the text brighter and back along the room's colour ramp. The same effect as the wallpaper pulse, applied to type. Stops under reduced motion."
  },
  {
    key: 'textGlowColor', label: 'Text glow colour', control: 'select', options: PALETTE_TOKENS, showWhen: 'textGlow',
    help: "The colour the text reaches at the top of its pulse. Unset: two rungs up the room's own ramp."
  },
  {
    key: 'textGlowSpeed', label: 'Text glow speed', control: 'percent', min: 25, max: 400, showWhen: 'textGlow',
    help: '100% is the tuned pace; 200% pulses twice as fast.'
  },
  {
    key: 'pulseGlow', label: 'Pulse glow', control: 'boolean',
    help: "Energy flowing outward from the centre of the wallpaper. A shift along the room's own brightness ramp rather than a translucent glow, so it stays exactly six colours and perfectly crisp. Needs a wallpaper; stops under reduced motion."
  },
  {
    key: 'pulseColor', label: 'Pulse colour', control: 'select', options: PALETTE_TOKENS, showWhen: 'pulseGlow',
    help: "The colour at the crest of the wave. Unset: two rungs up the room's own ramp."
  },
  {
    key: 'pulseSpeed', label: 'Pulse speed', control: 'percent', min: 25, max: 400, showWhen: 'pulseGlow',
    help: '100% is a wave every 1.3 seconds; 200% is twice as often.'
  },
  {
    key: 'chase', label: 'Chase light', control: 'boolean',
    help: "A short run of light travelling round the node's edge, like a marquee or a status ring. Whole pixels in one palette colour; stops under reduced motion."
  },
  {
    key: 'chaseColor', label: 'Chase colour', control: 'select', options: PALETTE_TOKENS, showWhen: 'chase',
    help: "Unset: the room's signal colour."
  },
  {
    key: 'chaseSpeed', label: 'Chase speed', control: 'percent', min: 25, max: 400, showWhen: 'chase',
    help: '100% is three tiles a second.'
  },
  {
    key: 'scan', label: 'Scan line', control: 'boolean',
    help: "A line sweeping down across the node's face and pausing below it, like a CRT scanline or a sensor sweep. Whole pixels in one palette colour; stops under reduced motion."
  },
  {
    key: 'scanColor', label: 'Scan colour', control: 'select', options: PALETTE_TOKENS, showWhen: 'scan',
    help: "Unset: the room's signal colour."
  },
  {
    key: 'scanSpeed', label: 'Scan speed', control: 'percent', min: 25, max: 400, showWhen: 'scan',
    help: '100% sweeps two and a half tiles a second.'
  },
  {
    key: 'showDesignator', label: 'Show designator', control: 'boolean',
    help: 'Print U4 / J2 on the package.'
  },
  {
    key: 'showName', label: 'Show name', control: 'boolean',
    help: 'Print the name on a nameplate above the package.'
  },
  { key: 'tags', label: 'Tags', control: 'tags', placeholder: 'minecraft, mods', help: 'Comma separated. Searchable from Ctrl+K.' },
  { key: 'notes', label: 'Notes', control: 'textarea', help: 'Free text. Never rendered on the board.' },
  { key: 'codexRef', label: 'Codex ref', control: 'text', placeholder: 'codex/projects/the-stalker.md', help: 'The markdown file in codex/ that describes this thing.' },
  { key: 'provisional', label: 'Provisional', control: 'boolean', help: 'Renders as an unpopulated footprint — a TODO printed on the board. A real PCB convention and a good way to place a node before its target exists.' }
];

/**
 * Priming on a plain terminal. The same allowlist an agent chip uses — "open a shell here and
 * bring it up to date" is the same act whether or not an agent follows it.
 */
const PRIME_FIELD: FieldSpec = {
  key: 'prelaunch', label: 'Prime before launch', control: 'multi',
  options: PRIME_STEP_IDS,
  help: 'Update steps to run when a terminal opens on this folder. Ids only — the commands live in code, never in board JSON.'
};

/**
 * The JARVIS face window. Ticked means ALLOWED: the face appears only on JARVIS iterations (the
 * Face, JARVIS Prime, anything tagged `jarvis`), so on any other chip this does nothing until the
 * node is tagged. Unticking switches the face off for this node.
 */
const AVATAR_WINDOW_FIELD: FieldSpec = {
  key: 'avatarWindow', label: 'Face window', control: 'boolean',
  help: 'JARVIS nodes (the Face, JARVIS Prime, anything tagged jarvis) open a face window beside their window, which talks while JARVIS responds and blinks otherwise. Untick to switch it off for this node. On other chips this does nothing; tag the node jarvis to give it a face. Frames go in assets/avatar/jarvis.'
};

const OPEN_WITH: FieldSpec = {
  key: 'openWith', label: 'Open with', control: 'select',
  options: ['explorer', 'default', 'browser', 'terminal', 'vscode'],
  help: 'What a click does. explorer reveals it in File Explorer; default hands it to Windows; vscode runs `code <path>`; terminal opens a shell there.'
};

/**
 * The same control, plus `office`, for documents.
 *
 * `office` hands an online document to the DESKTOP Word/Excel/PowerPoint through the `ms-word:`
 * family of URI schemes instead of opening it in a browser tab. It is offered rather than made the
 * default because it only works on a direct document URL — a SharePoint or OneDrive link that ends
 * in .docx. A share link (1drv.ms/..., or a /:w:/g/ URL) is a redirect, and Office cannot follow
 * one; it fails with a dialog rather than falling back, so the browser stays the safe default.
 */
const OPEN_WITH_DOCUMENT: FieldSpec = {
  key: 'openWith', label: 'Open with', control: 'select',
  options: ['default', 'office', 'notepadpp', 'obsidian', 'browser', 'explorer', 'terminal', 'vscode'],
  help: 'What a click does. For an online document, default and browser open it in your browser; office hands it to desktop Word/Excel/PowerPoint, which needs a direct link to the file (one ending in .docx), not a share link. notepadpp opens it in Notepad++; obsidian opens a note in Obsidian, and only works for a file inside a vault.'
};

const ROTATION_FIELD: FieldSpec = {
  key: 'rotation', label: 'Rotation', control: 'rotation',
  help: 'Quarter turns only. Any other angle would resample the pixels and be the one blurred thing on the board.'
};

/* ────────────────────────── sections in the node editor ────────────────────────── */

/**
 * The editor's collapsible sections, in the order they appear.
 *
 * William: "the entire node properties panel needs a … simplicity overhaul; more elements need to be
 * nested in dropdowns that have section headers so that the user can more quickly open a dropdown to
 * navigate to a section." A node carries up to forty fields, and as one flat column the one you
 * wanted was always a scroll away. Grouped, Identity and the binding open by default and everything
 * else is one click, labelled with how many fields it holds.
 */
export const SECTION_ORDER = ['identity', 'binding', 'session', 'appearance', 'text', 'effects'] as const;
export type SectionId = (typeof SECTION_ORDER)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  identity: 'Identity',
  binding: 'What it points at',
  session: 'Session',
  appearance: 'Appearance',
  text: 'Text',
  effects: 'Effects'
};

/** Anything not listed is a kind-specific binding field, which is what each kind's list is mostly made of. */
const SECTION_BY_KEY: Partial<Record<keyof BoardNode, SectionId>> = {
  name: 'identity', designator: 'identity', tags: 'identity', notes: 'identity', codexRef: 'identity', provisional: 'identity',
  launch: 'session', model: 'session', resume: 'session', remoteControl: 'session', prelaunch: 'session', briefing: 'session',
  avatarWindow: 'session', readOnLaunch: 'session', addDirs: 'session', initialPrompt: 'session', mcpServers: 'session', persona: 'session', partition: 'session',
  footprint: 'appearance', image: 'appearance', logo: 'appearance', logoSource: 'appearance', logoScale: 'appearance', showThumbnail: 'appearance', imageAnimate: 'appearance',
  showLogo: 'appearance', frame: 'appearance', priority: 'appearance', rotation: 'appearance', showDesignator: 'appearance',
  showName: 'appearance', showSystemGraphics: 'appearance',
  textColor: 'text', textStroke: 'text', textPlate: 'text', plateColor: 'text', plateBorder: 'text', text: 'text', size: 'text',
  textGlow: 'effects', textGlowColor: 'effects', textGlowSpeed: 'effects', pulseGlow: 'effects', pulseColor: 'effects',
  pulseSpeed: 'effects', chase: 'effects', chaseColor: 'effects', chaseSpeed: 'effects', scan: 'effects', scanColor: 'effects',
  scanSpeed: 'effects'
};

export function sectionOf(key: keyof BoardNode): SectionId {
  return SECTION_BY_KEY[key] ?? 'binding';
}

const BY_KIND: Record<NodeKind, FieldSpec[]> = {
  'agent.code': [
    AVATAR_WINDOW_FIELD,
    { key: 'cwd', label: 'Working directory', control: 'path-dir', required: true, placeholder: 'C:/dev/TheStalker', help: 'The repo the Claude Code session opens in. This is the session\'s whole world.' },
    { key: 'launch', label: 'Launch mode', control: 'select', required: true, options: ['popout', 'popout-elevated', 'embedded', 'headless'], help: 'popout opens Windows Terminal. popout-elevated triggers a UAC prompt every launch and is badged on the sprite — opt in per node only.' },
    { key: 'model', label: 'Model', control: 'text', placeholder: 'claude-opus-5', help: 'Optional. Omit to use the CLI default.' },
    { key: 'resume', label: 'Resume prior session', control: 'boolean', help: 'On: reattaches to this node\'s own conversation with `claude --resume`. Off: a fresh context every launch.' },
    {
      key: 'remoteControl', label: 'Reachable from my phone', control: 'boolean',
      help: 'On: the session starts with Claude Code\'s Remote Control, named after this node. Open the Claude app on a phone or claude.ai/code, signed in as you, to read it, type to it and answer its permission prompts. The terminal must stay open on this PC. Takes effect at the next launch.'
    },
    {
      key: 'prelaunch', label: 'Prime before launch', control: 'multi',
      options: PRIME_STEP_IDS,
      help: 'Update steps the terminal runs before handing over. Ids only — the commands live in code, never in board JSON. Leave every box clear to prime nothing.'
    },
    {
      key: 'briefing', label: 'Send the briefing', control: 'select',
      options: ['first', 'every', 'none'],
      help: 'first: only when a conversation starts. every: re-orient on resume too. none: open at an empty prompt. The briefing is built from the reading list, the persona and the granted directories below.'
    },
    {
      key: 'readOnLaunch', label: 'Read on launch', control: 'tags',
      placeholder: 'CLAUDE.md, codex/persona.md',
      help: 'Repo-relative documents the session reads first, in order. Leave empty to derive from CLAUDE.md + the persona brief + the codex ref.'
    },
    {
      key: 'addDirs', label: 'Granted directories', control: 'dir-list',
      help: 'Directories outside the working directory this agent may read and write (claude --add-dir). How one agent oversees repos scattered across the disk without moving any of them. Anything outside your dev roots is confirmed on every launch.'
    },
    { key: 'initialPrompt', label: 'Extra briefing text', control: 'textarea', help: 'Added to the generated briefing. Persona and character notes go here; the reading list and the granted directories are added for you.' },
    { key: 'mcpServers', label: 'MCP servers', control: 'tags', placeholder: 'skynet-mcp' }
  ],
  'agent.audit': [
    {
      key: 'cwd', label: 'Starting drive', control: 'path-dir', required: true, placeholder: 'D:/',
      help: 'The drive the auditor opens at, usually its root. It is outside your dev roots, so SkynetOS confirms it on every launch.'
    },
    {
      key: 'addDirs', label: 'Drives it may hop to', control: 'dir-list',
      help: 'Other drives the auditor may read, and move files within once you approve, in the same conversation. Each is confirmed on launch. Its rules forbid deleting anything; "clean" means moving into a dated quarantine folder with a manifest.'
    },
    {
      key: 'initialPrompt', label: 'Notes for this audit', control: 'textarea',
      help: 'What you want it to look at, and anything it must never touch. Added under its standing rules (codex/personas/drive-auditor.md), never instead of them.'
    },
    { key: 'resume', label: 'Resume prior session', control: 'boolean', help: 'On: carries on the same audit conversation. Off: a fresh audit every launch.' },
    { key: 'model', label: 'Model', control: 'text', placeholder: 'claude-opus-5', help: 'Optional. Omit to let SkynetOS choose: Fable 5.1 while it is available, Opus 5 otherwise.' }
  ],
  'agent.chat': [
    AVATAR_WINDOW_FIELD,
    { key: 'url', label: 'Conversation URL', control: 'url', required: true, placeholder: 'https://claude.ai/project/…', help: 'A specific claude.ai conversation or Project. Not a fresh Claude — that exact conversation.' },
    { key: 'partition', label: 'Session partition', control: 'text', placeholder: 'persist:jarvis', help: 'Keeps this webview logged in and separate from the others.' },
    { key: 'persona', label: 'Persona brief', control: 'path-file', placeholder: 'codex/personas/observer.md', filters: [{ name: 'Markdown', extensions: ['md'] }] }
  ],
  'agent.jarvis': [
    AVATAR_WINDOW_FIELD,
    { key: 'url', label: 'Conversation URL', control: 'url', required: true, placeholder: 'https://claude.ai/project/…', help: 'JARVIS\'s Face — the persistent conversation with board-wide jurisdiction.' },
    { key: 'partition', label: 'Session partition', control: 'text', placeholder: 'persist:jarvis' },
    { key: 'persona', label: 'Persona brief', control: 'path-file', placeholder: 'codex/persona.md', filters: [{ name: 'Markdown', extensions: ['md'] }] }
  ],
  'agent.prompt': [
    {
      key: 'promptTarget', label: 'Sends to', control: 'text', placeholder: 'u1_jarvis',
      help: 'The id of the JARVIS head or conversation node this box types into. Leave empty for this board\'s JARVIS head.'
    },
    {
      key: 'promptMode', label: 'Enter does', control: 'select', options: PROMPT_MODES,
      help: 'send: open the conversation, type it in with the files, and press send. draft: leave it in the conversation\'s own message box for a last look.'
    }
  ],
  // Nothing to bind: it always briefs the root board's JARVIS Prime chip. See node-build.ts.
  'agent.prompt-to-node': [],
  'drive.room': [
    { key: 'boardFile', label: 'Board file', control: 'board-file', required: true, placeholder: 'minecraftos/room.board.json', help: 'The nested board this drive descends into, relative to board/.' },
    { key: 'engraving', label: 'Engraving', control: 'text', required: true, placeholder: 'MINECRAFTOS', help: 'Printed on the shield can. Uppercase, A-Z 0-9 and . _ - only, max 20.' },
    { key: 'relation', label: 'Related room', control: 'text', placeholder: 'gameos', help: 'A board id. Shares that room\'s signal colour to show the two are connected.' },
    {
      key: 'size', label: 'Title size', control: 'select', options: ['11', '22'],
      help: 'Departure Mono is pixel-exact at 11 and 22 only — there is no size in between, and a fractional one would be blurred. At 22 the auto-appended OS drops to 11 and is genuinely half the title; at 11 it stays 11 and reads as subordinate by colour and outline alone.'
    }
  ],
  'store.repo': [
    { key: 'path', label: 'Repository path', control: 'path-dir', required: true, placeholder: 'C:/dev/TheStalker' },
    { key: 'remote', label: 'Remote URL', control: 'url', placeholder: 'https://github.com/you/TheStalker' },
    OPEN_WITH,
    PRIME_FIELD
  ],
  'store.folder': [
    { key: 'path', label: 'Folder path', control: 'path-dir', required: true, placeholder: 'C:/dev/assets' },
    OPEN_WITH,
    PRIME_FIELD
  ],
  'store.explorer': [
    {
      key: 'path', label: 'Root folder', control: 'path-dir', required: true, placeholder: 'C:/dev/DirtyPlush/research',
      help: 'The folder the explorer window browses. It never lists anything above this, and never writes or deletes anything in it.'
    },
    {
      key: 'restPath', label: 'Resting folder', control: 'path-dir', placeholder: 'C:/dev/DirtyPlush/research/maps',
      help: 'Where the window opens. Must be inside the root folder. Leave empty to open at the root, or set it from the window with SET AS RESTING FOLDER.'
    }
  ],
  'store.cloud': [
    { key: 'url', label: 'Cloud URL', control: 'url', required: true, placeholder: 'https://drive.google.com/drive/folders/…' },
    { key: 'localPath', label: 'Local mirror', control: 'path-dir', help: 'Optional. The synced folder on this machine, if there is one.' }
  ],
  'file.document': [
    {
      key: 'path', label: 'Document', control: 'path-file', requiredOneOf: 'document',
      placeholder: 'C:/Users/you/Documents/Novel.docx',
      filters: [{ name: 'Documents', extensions: ['docx', 'doc', 'md', 'txt', 'pdf', 'rtf', 'odt'] }],
      help: 'A file on this machine. A OneDrive folder that syncs locally counts — and is the better choice when you have it, because it opens instantly in the desktop app, works offline, and the board can watch it for changes.'
    },
    {
      key: 'url', label: 'Document URL', control: 'url', requiredOneOf: 'document',
      placeholder: 'https://onedrive.live.com/... or https://contoso-my.sharepoint.com/...',
      help: 'For a document that is only online — one shared with you, or a OneDrive file you have not synced. Fill in EITHER this or the path above.'
    },
    OPEN_WITH_DOCUMENT
  ],
  'file.exe': [
    { key: 'path', label: 'Executable', control: 'path-file', required: true, placeholder: 'C:/dev/tool/build/tool.exe', filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd', 'ps1'] }] },
    { key: 'args', label: 'Arguments', control: 'tags', placeholder: '--flag, value' },
    { key: 'cwd', label: 'Working directory', control: 'path-dir' },
    { key: 'confirmBeforeLaunch', label: 'Confirm before launch', control: 'boolean', help: 'On by default. Leave it on for anything outside a dev root.' },
    { key: 'elevated', label: 'Run as administrator', control: 'boolean', help: 'Windows shows a UAC prompt every launch — that is unavoidable, because SkynetOS itself is not elevated and no process can grant itself privileges. Asked for confirmation every time regardless of the setting above.' }
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
    {
      key: 'action', label: 'Action', control: 'json', required: true,
      help: 'A JSON object. {"type":"agent.run"} starts a FRESH session on the target agent with the brief and prompt below (never elevated, never commits). {"type":"journal.write"} writes the Obsidian journal note. {"type":"notify","message":"…"} shows a Windows toast titled with this task. jarvis.headless is kept but does nothing yet.'
    },
    { key: 'enabled', label: 'Enabled', control: 'boolean' },
    {
      key: 'taskTarget', label: 'Runs on (agent id)', control: 'text', placeholder: 'u3_jarvis_hands',
      help: 'agent.run only: the Claude Code chip a run opens a fresh session on, by id, on this board or the root board. Empty: JARVIS Prime.'
    },
    {
      key: 'taskBrief', label: 'Brief (markdown in the repo)', control: 'text', placeholder: 'codex/briefs/morning-maintenance.md',
      help: 'agent.run only: read at run time, so editing the file changes the next run. Must be a .md inside the SkynetOS repo.'
    },
    { key: 'taskPrompt', label: 'Extra instructions', control: 'textarea', help: 'agent.run only: appended after the brief.' },
    {
      key: 'catchUpHours', label: 'Catch-up window (hours)', control: 'number', placeholder: '4',
      help: 'A run missed because SkynetOS was closed still fires ONCE if it opens within this many hours. 0 means only on time. Max 48.'
    },
    {
      key: 'journalVault', label: 'Journal vault', control: 'path-dir', optionalTarget: true,
      placeholder: '%USERPROFILE%/OneDrive/Documents/My Vault',
      help: 'An Obsidian vault (a folder holding .obsidian). Set, and a click writes today\'s SkynetOS journal note into it, tagged from the vault\'s own tags. It never overwrites a note.'
    },
    {
      key: 'journalFolder', label: 'Journal folder', control: 'text',
      placeholder: '01 Personal/-a- JOURNAL/SkynetOS',
      help: 'Inside the vault. Empty means the vault\'s own daily-notes folder, in a SkynetOS subfolder.'
    }
  ],
  'monitor.system': [
    {
      key: 'showSystemGraphics', label: 'Display system performance graphics', control: 'boolean',
      help: "On: the node's face is a live widget of this machine's CPU, GPU and memory, refreshed every two seconds. Off: it shows its wallpaper and logo like any other component. Double-click opens the full monitor either way."
    }
  ],
  'note.silk': [
    { key: 'text', label: 'Text', control: 'textarea', required: true, placeholder: 'PHASE 1 — FOUNDATIONS', help: 'Engraved on the board. Uppercase reads correctly here.' },
    { key: 'size', label: 'Size', control: 'select', options: ['11', '22'], help: 'Departure Mono is pixel-perfect at 11 and 22 only.' }
  ],
  'group.zone': [
    { key: 'members', label: 'Members', control: 'tags', placeholder: 'u1_agent_stalker, s1_repo_stalker', help: 'Node ids inside this zone. Selecting the zone selects them all.' },
    { key: 'relation', label: 'Related room', control: 'text', placeholder: 'gameos', help: 'A board id. Outlines this cluster in that room\'s signal colour to show they are connected.' }
  ],
  /*
   * Nothing kind-specific. A `decor.image` IS its picture, and `image` is already in TRAILING — a
   * second copy would be two controls bound to the same key, which is a form that can disagree
   * with itself. `fieldsFor` promotes the shared field to required for this kind instead.
   */
  'decor.image': [ROTATION_FIELD],
  'decor.part': [
    {
      key: 'part', label: 'Part', control: 'select', required: true,
      options: DECOR_PARTS,
      help: 'Which piece of board furniture. Each is one cell of a real tilesheet, recoloured to the locked palette by the bake pipeline. The led_* parts pulse.'
    },
    ROTATION_FIELD
  ]
};

/** The full, ordered field list for a kind: identity, kind-specific, then the common trailers. */
export function fieldsFor(kind: NodeKind): FieldSpec[] {
  const fields = [...COMMON, ...(BY_KIND[kind] ?? []), ...TRAILING];

  /*
   * A backdrop's wallpaper is not decoration on top of something else — it is the whole node, and
   * the schema requires it. Promoting the shared field beats declaring a duplicate: two controls
   * bound to one key is a form that can disagree with itself.
   */
  if (kind === 'decor.image') {
    return fields.map((f) =>
      f.key === 'image' ? { ...f, label: 'Backdrop', required: true } : f);
  }
  return fields;
}

/** Just the fields that name something real and can therefore be picked and verified. */
export function targetFieldsFor(kind: NodeKind): FieldSpec[] {
  return fieldsFor(kind).filter((f) => isTargetControl(f.control));
}

/**
 * Fields that are pickable and verifiable but are NOT what the node points at.
 *
 * `image` and `logo` are faces, not targets. They need a Browse button and an existence check
 * like any other path, but clicking a note.silk must not "open" its picture, and the inspector
 * must not report a decorative image as the thing this component is bound to.
 */
const NON_TARGET_KEYS: readonly (keyof BoardNode)[] = ['image', 'logo'];

/**
 * The one field that IS this node's target — what a click acts on and what the inspector shows
 * as "resolved". Returns undefined for kinds that point at nothing (note.silk, group.zone,
 * monitor.system, task.scheduled).
 */
/**
 * The field that says what this node points at.
 *
 * `node` disambiguates a `requiredOneOf` group: a `file.document` can be bound by `path` OR by
 * `url`, and which one it IS depends on which one is filled in. Without the node the answer is a
 * guess, and the guess would decide whether the node resolves against the filesystem or against a
 * URL — so a document behind a OneDrive link would be looked for on disk and render broken.
 */
export function primaryTargetField(kind: NodeKind, node?: BoardNode): FieldSpec | undefined {
  const fields = targetFieldsFor(kind).filter((f) => !NON_TARGET_KEYS.includes(f.key));

  if (node) {
    const filled = fields.find((f) => {
      const value = node[f.key];
      return typeof value === 'string' && value.trim() !== '';
    });
    if (filled) return filled;
  }

  // An optional target is the target only when filled, which the branch above already covered.
  const fallback = fields.filter((f) => !f.optionalTarget);
  return fallback.find((f) => f.required) ?? fallback.find((f) => f.requiredOneOf) ?? fallback[0];
}

/** Required fields missing from a node. Empty array means the form may be saved. */
export function missingRequired(node: BoardNode): FieldSpec[] {
  const filled = (f: FieldSpec): boolean => {
    const value = node[f.key];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
  };

  const fields = fieldsFor(node.kind);
  const missing = fields.filter((f) => f.required && !filled(f));

  /*
   * A `requiredOneOf` group is satisfied by ANY of its members. Report the whole group as missing
   * when none is filled — naming one arbitrarily would tell the user to fill in a path when a URL
   * would have done.
   */
  const groups = new Set(fields.map((f) => f.requiredOneOf).filter((g): g is string => Boolean(g)));
  for (const group of groups) {
    const members = fields.filter((f) => f.requiredOneOf === group);
    if (!members.some(filled)) missing.push(...members);
  }

  return missing;
}
