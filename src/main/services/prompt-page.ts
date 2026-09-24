/**
 * The scripts main runs inside the claude.ai conversation window to deliver a prompt node's
 * message.
 *
 * ── The boundary this keeps ───────────────────────────────────────────────────────────────────
 *
 * docs/07: the conversation window "runs in its own partition and has no preload, no bridge, no
 * access to SkynetOS APIs." That is still true. Nothing here gives the PAGE a way to reach
 * SkynetOS: main pushes a fixed script in with `executeJavaScript`, reads back a small JSON answer,
 * and that is the whole conversation. Every script is a constant in this file. The only variable
 * content is file names and bytes, and those go in through `JSON.stringify`, so a file called
 * `"); alert(1); ("` is a string, not code.
 *
 * ── Why selectors, in order ───────────────────────────────────────────────────────────────────
 *
 * claude.ai's page is not ours and changes without notice. Each list runs from the most specific
 * thing known to work to the most generic, and the caller treats "found nothing" as a failure to
 * report rather than a reason to guess harder. The failure path (clipboard, toast, window left open)
 * is the part that must always work.
 *
 * Pure strings: test/prompt.test.ts compiles every one and checks what the payload can do to it.
 */

/** The message box. claude.ai's is a ProseMirror contenteditable. */
export const COMPOSER_SELECTORS = [
  'div.ProseMirror[contenteditable="true"]',
  '[data-testid="chat-input"][contenteditable="true"]',
  'fieldset div[contenteditable="true"]',
  'div[contenteditable="true"]',
  'textarea'
] as const;

/** The hidden file input the page's own attach button drives. */
export const FILE_INPUT_SELECTORS = [
  'input[type="file"][data-testid="file-upload"]',
  'input[type="file"][multiple]',
  'input[type="file"]'
] as const;

export const SEND_SELECTORS = [
  'button[aria-label="Send message"]',
  'button[aria-label="Send Message"]',
  'button[aria-label*="Send" i]',
  'fieldset button[type="submit"]'
] as const;

/** A function expression, embedded in each script, that returns the first element matching a list. */
const FIND = `(list) => { for (const s of list) { try { const el = document.querySelector(s); if (el) return el; } catch (e) {} } return null; }`;

/** Is there a message box yet? `true` / `false`. */
export function hasComposerScript(): string {
  return `(() => { const find = ${FIND}; return !!find(${JSON.stringify(COMPOSER_SELECTORS)}); })()`;
}

/**
 * Focus the message box and put the caret at the end of whatever is already in it, so the new
 * text follows a draft rather than landing in the middle of it. `true` when there was a box.
 */
export function focusComposerScript(): string {
  return `(() => {
    const find = ${FIND};
    const el = find(${JSON.stringify(COMPOSER_SELECTORS)});
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    } else if (typeof el.value === 'string') {
      el.selectionStart = el.selectionEnd = el.value.length;
    }
    return true;
  })()`;
}

/** The message box's current text, or null when there is no box. */
export function composerTextScript(): string {
  return `(() => {
    const find = ${FIND};
    const el = find(${JSON.stringify(COMPOSER_SELECTORS)});
    if (!el) return null;
    return typeof el.value === 'string' ? el.value : (el.innerText || '');
  })()`;
}

export interface PageFile {
  name: string;
  mime: string;
  /** The file's bytes, base64. */
  base64: string;
}

/**
 * Hand files to the page the way a person would.
 *
 * First choice: the page's own hidden file input, given the files through a DataTransfer and told
 * it changed, which is exactly what its attach button does. Second: a paste event carrying the
 * files, dispatched on the message box, which is what Ctrl+V of a screenshot does. Answers
 * `{ strategy, count }`, or `{ strategy: 'none', error }` when the page offered neither.
 */
export function attachScript(files: readonly PageFile[]): string {
  return `(() => {
    const find = ${FIND};
    const payload = ${JSON.stringify(files)};
    const made = payload.map((f) => {
      const bin = atob(f.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], f.name, { type: f.mime });
    });
    const dt = new DataTransfer();
    for (const file of made) dt.items.add(file);
    const input = find(${JSON.stringify(FILE_INPUT_SELECTORS)});
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { strategy: 'file-input', count: made.length };
    }
    const box = find(${JSON.stringify(COMPOSER_SELECTORS)});
    if (!box) return { strategy: 'none', count: 0, error: 'THE PAGE HAS NO FILE INPUT AND NO MESSAGE BOX' };
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return { strategy: 'paste', count: made.length };
  })()`;
}

/** The send button's state: 'ready', 'disabled' (usually an upload still in flight), or 'absent'. */
export function sendButtonStateScript(): string {
  return `(() => {
    const find = ${FIND};
    const btn = find(${JSON.stringify(SEND_SELECTORS)});
    if (!btn) return 'absent';
    return btn.disabled || btn.getAttribute('aria-disabled') === 'true' ? 'disabled' : 'ready';
  })()`;
}

/** Press the send button. `true` when there was an enabled one to press. */
export function clickSendScript(): string {
  return `(() => {
    const find = ${FIND};
    const btn = find(${JSON.stringify(SEND_SELECTORS)});
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
    btn.click();
    return true;
  })()`;
}

/** Whitespace-insensitive "does the box hold what we typed". ProseMirror rewrites line breaks. */
export function composerHolds(composerText: string | null, typed: string): boolean {
  if (composerText === null) return false;
  const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const wanted = squash(typed).slice(0, 40);
  return wanted === '' || squash(composerText).includes(wanted);
}
