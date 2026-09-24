import type { Board, BoardNode } from './types.js';

/**
 * The prompt node: a quick-chat box printed on the board that sends straight to the Face.
 *
 * William: "a typical empty prompt box that allows for file (image and other file types) upload,
 * and whatever is typed into that box is fed to Jarvis Head/Face as a window with Jarvis head /
 * face opens - sort of like a 'quick chat' feature that embeds in the board."
 *
 * Pure: the shapes that cross IPC, the limits, which conversation a box feeds, and the geometry
 * the pixel sprite and the DOM overlay share. test/prompt.test.ts holds all of it. The delivery
 * itself is src/main/services/prompt-send.ts, and the page scripts it runs are in
 * src/main/services/prompt-page.ts.
 */

/**
 * What pressing Enter does.
 *
 * `send` is the default because of how William put it: "whatever is typed into that box is fed to
 * Jarvis Head/Face … sort of like a 'quick chat'". A quick chat that stops short of sending is a
 * clipboard with extra steps. `draft` puts the text and files into the conversation's own message
 * box and leaves the final Enter to him, for a node where he wants a look before it goes.
 */
export const PROMPT_MODES = ['send', 'draft'] as const;
export type PromptMode = (typeof PROMPT_MODES)[number];

export function promptModeOf(node: Pick<BoardNode, 'promptMode'>): PromptMode {
  return node.promptMode === 'draft' ? 'draft' : 'send';
}

/** What the renderer asks main to deliver. Paths only: main reads the bytes itself. */
export interface PromptSendRequest {
  boardId: string;
  /**
   * The prompt node it was typed into. Absent means the corner prompt (ui/JarvisDock.tsx), which
   * belongs to no node and always sends to the board's JARVIS head.
   */
  nodeId?: string;
  text: string;
  /** Absolute paths the user picked or dropped. */
  files: string[];
}

export interface PromptSendResult {
  ok: boolean;
  /**
   * How far it got. `sent` means the conversation's message box emptied after send, which is the
   * only evidence available that the page accepted it. `drafted` means the text (and files, if
   * any) are in the message box and nothing was sent. `failed` means neither.
   */
  stage: 'sent' | 'drafted' | 'failed';
  /** Files handed to the page. Not a promise that the upload finished. */
  attached: number;
  /** One sentence for the toast: what happened, or exactly where it stopped. */
  message: string;
  /** True when the text was put on the clipboard because delivery did not complete. */
  copied?: boolean;
}

/** A picked file, as the box shows it. */
export interface PromptFileInfo {
  path: string;
  name: string;
  bytes: number;
  image: boolean;
  /** A tiny downscaled PNG as a data URL, shown pixelated. Images only. */
  thumbnail?: string;
  /** Why this file cannot be sent. Shown on the chip; the file is still listed. */
  error?: string;
}

/**
 * The caps on one send.
 *
 * claude.ai takes files of up to about 30 MB each. The whole payload also crosses into the page as
 * one script, so the total is bounded well below anything that would stall the window.
 */
export const PROMPT_LIMITS = {
  maxFiles: 10,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 30 * 1024 * 1024,
  maxTextChars: 100_000
} as const;

/**
 * The conversation a prompt box feeds: the node its `promptTarget` names, or the board's JARVIS
 * head when it names none.
 *
 * An explicit target that is missing, or is not a conversation, is an error rather than a quiet
 * fallback to JARVIS. A message typed into a box labelled for one conversation turning up in
 * another is the worst thing this node could do.
 */
export function resolvePromptTarget(board: Pick<Board, 'nodes'>, node: Pick<BoardNode, 'promptTarget'>): BoardNode | null {
  const isConversation = (n: BoardNode | undefined): n is BoardNode =>
    !!n && (n.kind === 'agent.jarvis' || n.kind === 'agent.chat');
  if (node.promptTarget) {
    const named = board.nodes.find((n) => n.id === node.promptTarget);
    return isConversation(named) ? named : null;
  }
  return board.nodes.find((n) => n.kind === 'agent.jarvis') ?? null;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  xml: 'text/xml', yml: 'text/plain', yaml: 'text/plain', log: 'text/plain',
  js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', tsx: 'text/plain', py: 'text/x-python',
  java: 'text/plain', cpp: 'text/plain', h: 'text/plain', cs: 'text/plain', rs: 'text/plain', glsl: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? (match[1] ?? '').toLowerCase() : '';
}

/** The MIME type the page is told a file is. Unknown types go as bytes and let the page decide. */
export function mimeFor(name: string): string {
  return MIME[extensionOf(name)] ?? 'application/octet-stream';
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

/** The last segment of a Windows or POSIX path. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Split picked files into what can go and what cannot, against PROMPT_LIMITS, in the order given.
 * A refused file keeps its reason, so the chip can say why instead of the file silently vanishing.
 */
export function checkAttachments<T extends { path: string; bytes: number }>(
  files: readonly T[]
): { accepted: T[]; refused: { file: T; reason: string }[] } {
  const accepted: T[] = [];
  const refused: { file: T; reason: string }[] = [];
  let total = 0;
  for (const file of files) {
    if (accepted.length >= PROMPT_LIMITS.maxFiles) {
      refused.push({ file, reason: `MORE THAN ${PROMPT_LIMITS.maxFiles} FILES` });
    } else if (file.bytes > PROMPT_LIMITS.maxFileBytes) {
      refused.push({ file, reason: `OVER ${PROMPT_LIMITS.maxFileBytes / 1024 / 1024} MB` });
    } else if (total + file.bytes > PROMPT_LIMITS.maxTotalBytes) {
      refused.push({ file, reason: `WOULD TAKE THE SEND OVER ${PROMPT_LIMITS.maxTotalBytes / 1024 / 1024} MB` });
    } else {
      accepted.push(file);
      total += file.bytes;
    }
  }
  return { accepted, refused };
}

/* ────────────────────────── the box's geometry ────────────────────────── */

export interface PromptRect { x: number; y: number; w: number; h: number }

/**
 * Where everything sits inside a prompt node, in world pixels from its top-left corner.
 *
 * ONE layout, used by the pixel sprite (component-art.ts draws the frame, the placeholder, the
 * paperclip and the send button) and by the DOM overlay (PromptBoxes.tsx puts the real textarea
 * and the two buttons over exactly those pixels). Two copies of these numbers would drift, and the
 * buttons would stop lining up with the glyphs they are pretending to be.
 *
 * Whole pixels only, so the sprite never lands on a fractional edge.
 */
export interface PromptLayout {
  /** The rounded box itself. */
  box: PromptRect;
  /** Where the typed text goes. */
  text: PromptRect;
  /** The attach button, bottom left. */
  clip: PromptRect;
  /** The send button, bottom right. */
  send: PromptRect;
  /** The title tab across the top left. Zero-sized on a node that has none (the quick-chat box). */
  tab: PromptRect;
}

/**
 * The PROMPT → NODE box: a prompt box whose message goes to JARVIS PRIME as a brief to BUILD a node,
 * not to the Face as chat. See packages/shared/node-build.ts.
 */
export const PROMPT_TO_NODE_KIND = 'agent.prompt-to-node' as const;

/**
 * Height of the PROMPT → NODE title tab, in world px. The tab is what says, at every zoom, that
 * this box is not a quick chat. The canvas draws it and the overlay leaves it alone, and both find
 * it through `promptLayout`.
 */
export const PROMPT_TO_NODE_TAB = 12;

/** The kinds drawn as a message box with a real textarea over them. */
export function isPromptBoxKind(kind: string): boolean {
  return kind === 'agent.prompt' || kind === PROMPT_TO_NODE_KIND;
}

/** The title tab height a prompt kind carries: PROMPT_TO_NODE_TAB for PROMPT → NODE, else none. */
export function promptTabFor(kind: string): number {
  return kind === PROMPT_TO_NODE_KIND ? PROMPT_TO_NODE_TAB : 0;
}

export function promptLayout(width: number, height: number, options: { tab?: number } = {}): PromptLayout {
  const w = Math.max(16, Math.floor(width));
  const h = Math.max(16, Math.floor(height));
  const inset = 2;
  const pad = 4;
  // A tab pushes the box down by its own height; it never takes the box below 16px tall.
  const tabH = Math.max(0, Math.min(Math.floor(options.tab ?? 0), h - 16 - inset));
  const top = tabH > 0 ? tabH : inset;
  const box = { x: inset, y: top, w: w - inset * 2, h: h - top - inset };
  const tab = tabH > 0
    ? { x: inset, y: 0, w: Math.min(box.w, Math.max(48, Math.floor(w * 0.55))), h: tabH }
    : { x: inset, y: 0, w: 0, h: 0 };
  const button = Math.max(8, Math.min(12, Math.floor((box.h - pad * 2) / 2)));
  const toolbarY = box.y + box.h - pad - button;
  const text = {
    x: box.x + pad,
    y: box.y + pad,
    w: Math.max(8, box.w - pad * 2),
    h: Math.max(4, toolbarY - (box.y + pad) - 2)
  };
  return {
    box,
    text,
    clip: { x: box.x + pad, y: toolbarY, w: button, h: button },
    send: { x: box.x + box.w - pad - button, y: toolbarY, w: button, h: button },
    tab
  };
}
