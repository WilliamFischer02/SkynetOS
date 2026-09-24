import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { clipboard, dialog, nativeImage, type WebContents } from 'electron';
import {
  PROMPT_LIMITS,
  checkAttachments,
  fileNameOf,
  isImageFile,
  mimeFor,
  promptModeOf,
  resolvePromptTarget,
  type PromptFileInfo,
  type PromptSendRequest,
  type PromptSendResult
} from '@shared/prompt.js';
import { loadBoard } from './board-store.js';
import { chatWindowFor, openChatWindow } from './chat-window.js';
import { boardWindow } from './main-window.js';
import { refuseDialogWhenRemote } from './remote-context.js';
import {
  attachScript,
  clickSendScript,
  composerHolds,
  composerTextScript,
  focusComposerScript,
  hasComposerScript,
  sendButtonStateScript,
  type PageFile
} from './prompt-page.js';

/**
 * Delivering a prompt node's message to the Face.
 *
 * William: "whatever is typed into that box is fed to Jarvis Head/Face as a window with Jarvis head
 * / face opens … automatically open the iteration of that chat with the message input and images."
 *
 * ── The order, and why each step waits for evidence ───────────────────────────────────────────
 *
 *   1. Open or focus the TARGET node's conversation window: the same window a click on the JARVIS
 *      chip opens, on the same conversation, never a fresh one.
 *   2. Wait for claude.ai's message box to exist. A new window is still loading, and a signed-out
 *      one never shows a box at all.
 *   3. Hand over the files first, then type, so the text is the last thing in the box.
 *   4. Check the box actually holds the text before going on.
 *   5. `send` mode: wait for the send button to enable (it stays disabled while an upload is in
 *      flight), press it, and call it sent only once the box has emptied.
 *
 * Every failure leaves the window open, puts the text on the clipboard, and says exactly where it
 * stopped. Nothing here ever reports "sent" on the strength of having tried.
 *
 * ── Boundaries ────────────────────────────────────────────────────────────────────────────────
 *
 * The three `prompt:*` channels are NOT in AGENT_METHODS: an agent must not be able to type into
 * William's own claude.ai conversation. The file bytes come from `readFileSync` on the paths the user
 * picked or dropped, never from the renderer. The page gets fixed scripts from prompt-page.ts and
 * nothing that could call back into SkynetOS; the window still has no preload and no bridge.
 */

/** A fresh window loading claude.ai takes a few seconds; a signed-out one never gets a box. */
const COMPOSER_TIMEOUT_MS = 25_000;
/** How long an attachment may keep the send button disabled before we stop waiting. */
const UPLOAD_TIMEOUT_MS = 90_000;
/** Longest side of the pixel thumbnail shown on a chip. Drawn at an integer 2x, pixelated. */
const THUMBNAIL_PX = 16;

async function poll(check: () => Promise<boolean>, timeoutMs: number, everyMs = 300): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/** The native multi-file picker, parented to the board window (never getAllWindows()[0]). */
export async function pickPromptFiles(): Promise<{ paths: string[] }> {
  refuseDialogWhenRemote('a file picker');
  const win = boardWindow();
  const options: Electron.OpenDialogOptions = {
    title: 'Attach to the prompt',
    buttonLabel: 'Attach',
    properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
    filters: [
      { name: 'All files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }
    ]
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return { paths: result.canceled ? [] : result.filePaths };
}

/**
 * What the box shows for picked files: name, size, whether it is an image, a tiny thumbnail, and
 * a reason when it cannot be sent. Every file is listed, sendable or not, so a refused file says
 * why rather than vanishing.
 */
export function describePromptFiles(paths: string[]): PromptFileInfo[] {
  return paths.slice(0, 50).map((path) => {
    const name = fileNameOf(path);
    const info: PromptFileInfo = { path, name, bytes: 0, image: isImageFile(name) };
    if (!isAbsolute(path)) return { ...info, error: 'NOT AN ABSOLUTE PATH' };
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return { ...info, error: 'NOT A FILE' };
      info.bytes = stat.size;
      if (stat.size > PROMPT_LIMITS.maxFileBytes) {
        info.error = `OVER ${PROMPT_LIMITS.maxFileBytes / 1024 / 1024} MB`;
      } else if (info.image) {
        const image = nativeImage.createFromPath(path);
        if (!image.isEmpty()) {
          const { width, height } = image.getSize();
          const scale = THUMBNAIL_PX / Math.max(width, height, 1);
          const small = image.resize({
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
            quality: 'good'
          });
          info.thumbnail = small.toDataURL();
        }
      }
    } catch (err) {
      info.error = `CANNOT READ — ${(err as Error).message.split('\n')[0]}`;
    }
    return info;
  });
}

function pressKey(wc: WebContents, keyCode: string, modifiers: ('shift')[] = []): void {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

export async function sendPrompt(request: PromptSendRequest): Promise<PromptSendResult> {
  const text = String(request.text ?? '').slice(0, PROMPT_LIMITS.maxTextChars);
  const paths = Array.isArray(request.files) ? request.files.filter((p): p is string => typeof p === 'string') : [];
  let attached = 0;

  /** Stop here: window left as it is, text on the clipboard, and the reason said out loud. */
  const fail = (reason: string): PromptSendResult => {
    const copied = text.trim() !== '';
    if (copied) clipboard.writeText(text);
    return {
      ok: false,
      stage: 'failed',
      attached,
      message: copied ? `${reason} — YOUR TEXT IS ON THE CLIPBOARD` : reason,
      copied
    };
  };

  if (!text.trim() && !paths.length) return { ok: false, stage: 'failed', attached: 0, message: 'NOTHING TO SEND' };

  const load = loadBoard(request.boardId);
  if (!load.ok) return fail(load.error);
  /*
   * No node means the corner prompt (ui/JarvisDock.tsx): it belongs to no node and always sends to
   * the board's JARVIS head, in send mode. A nodeId that names something else is still refused.
   */
  const node = request.nodeId ? load.board.nodes.find((n) => n.id === request.nodeId) ?? null : null;
  if (request.nodeId && (!node || node.kind !== 'agent.prompt')) return fail('THAT IS NOT A PROMPT NODE');
  const target = resolvePromptTarget(load.board, node ?? {});
  if (!target) {
    return fail(node?.promptTarget
      ? `"${node.promptTarget}" IS NOT A CONVERSATION ON THIS BOARD`
      : 'THIS BOARD HAS NO JARVIS HEAD TO SEND TO');
  }
  if (!target.url || !/^https:\/\//i.test(target.url)) return fail(`${target.name} HAS NO https CONVERSATION URL`);

  // The bytes, read here from the paths the user chose. Nothing else is allowed to supply them.
  const described = describePromptFiles(paths);
  const unreadable = described.find((f) => f.error);
  if (unreadable) return fail(`CANNOT ATTACH ${unreadable.name}: ${unreadable.error}`);
  const { accepted, refused } = checkAttachments(described);
  const firstRefused = refused[0];
  if (firstRefused) return fail(`CANNOT ATTACH ${firstRefused.file.name}: ${firstRefused.reason}`);
  let pageFiles: PageFile[];
  try {
    pageFiles = accepted.map((f) => ({ name: f.name, mime: mimeFor(f.name), base64: readFileSync(f.path).toString('base64') }));
  } catch (err) {
    return fail(`CANNOT READ A FILE — ${(err as Error).message.split('\n')[0]}`);
  }

  openChatWindow(target, target.url);
  const win = chatWindowFor(target.id);
  if (!win) return fail('THE CONVERSATION WINDOW DID NOT OPEN');
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const wc = win.webContents;
  const run = async <T>(code: string): Promise<T | null> => {
    if (win.isDestroyed()) return null;
    try {
      return (await wc.executeJavaScript(code, true)) as T;
    } catch {
      return null;
    }
  };

  const hasBox = await poll(async () => (await run<boolean>(hasComposerScript())) === true, COMPOSER_TIMEOUT_MS);
  if (!hasBox) {
    return fail(`NO MESSAGE BOX IN ${target.name}'S WINDOW AFTER ${COMPOSER_TIMEOUT_MS / 1000} s (SIGNED OUT, STILL LOADING, OR claude.ai CHANGED ITS PAGE)`);
  }

  if (pageFiles.length) {
    const result = await run<{ strategy: string; count: number; error?: string }>(attachScript(pageFiles));
    if (!result || result.strategy === 'none') {
      return fail(`COULD NOT HAND THE FILES TO THE PAGE (${result?.error ?? 'THE SCRIPT FAILED'}). NOTHING WAS SENT`);
    }
    attached = result.count;
  }

  if (text.trim()) {
    if (!(await run<boolean>(focusComposerScript()))) return fail('LOST THE MESSAGE BOX BEFORE TYPING');
    wc.focus();
    /*
     * Typed through the input pipeline, line by line, with Shift+Enter between lines: claude.ai's
     * box is a ProseMirror editor, which takes typed text as typed text, and Enter on its own would
     * send the first line early. Nothing is pasted, so the clipboard is left alone on success.
     */
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line) await wc.insertText(line);
      if (i < lines.length - 1) pressKey(wc, 'Enter', ['shift']);
    }
    const holds = await poll(async () => composerHolds(await run<string | null>(composerTextScript()), text), 3000);
    if (!holds) return fail('TYPED INTO THE WINDOW BUT ITS MESSAGE BOX DOES NOT SHOW THE TEXT');
  }

  const withFiles = attached ? ` WITH ${attached} FILE${attached === 1 ? '' : 'S'}` : '';

  if (node && promptModeOf(node) === 'draft') {
    return { ok: true, stage: 'drafted', attached, message: `IN ${target.name}'S MESSAGE BOX${withFiles} — PRESS ENTER THERE TO SEND` };
  }

  const buttonReady = await poll(
    async () => (await run<string>(sendButtonStateScript())) === 'ready',
    attached ? UPLOAD_TIMEOUT_MS : 5000
  );
  if (buttonReady) {
    await run<boolean>(clickSendScript());
  } else if ((await run<string>(sendButtonStateScript())) === 'absent') {
    // No recognisable button: Enter in the box is how claude.ai sends from the keyboard.
    await run<boolean>(focusComposerScript());
    pressKey(wc, 'Enter');
  } else {
    return {
      ok: false,
      stage: 'drafted',
      attached,
      message: `THE SEND BUTTON STAYED DISABLED${attached ? ' (A FILE MAY STILL BE UPLOADING)' : ''} — IT IS IN ${target.name}'S BOX, PRESS SEND THERE`
    };
  }

  if (!text.trim()) {
    // An empty box proves nothing when there was no text in it to begin with.
    return { ok: true, stage: 'sent', attached, message: `PRESSED SEND IN ${target.name}${withFiles} — FILES ONLY, SO NOT CONFIRMED` };
  }
  const cleared = await poll(async () => ((await run<string | null>(composerTextScript())) ?? 'x').trim() === '', 5000);
  if (!cleared) {
    return { ok: false, stage: 'drafted', attached, message: `PRESSED SEND BUT ${target.name}'S MESSAGE BOX DID NOT EMPTY — CHECK THE WINDOW` };
  }
  return { ok: true, stage: 'sent', attached, message: `SENT TO ${target.name}${withFiles}` };
}
