---
name: drop
description: Drag-and-drop files, images, PDFs and folders into a terminal Claude Code session. Use when the user asks how to attach or drop a file, or invokes /drop. Windows Terminal pastes a dropped file's path into the prompt; the drop-attach hook turns every real path in a prompt into context automatically.
---

# /drop: attach files by dragging them onto the terminal

**How it works.** Drag any file, image, PDF or folder from Explorer onto this terminal window. Windows
Terminal pastes its full path into the prompt (quoted if it has spaces). Type what you want done
with it, or nothing, and press Enter. The `drop-attach` hook (`~/.claude/hooks/drop-attach.mjs`,
run on every prompt) finds each real path and attaches it:

| Dropped | What Claude gets |
|---|---|
| Text, code, JSON, CSV, Markdown, configs | The contents inline, up to 64 KB per file and 200 KB in total, with a truncation note |
| PNG, JPG, GIF, WEBP, BMP | An instruction to `Read` the path, which renders the image |
| PDF | An instruction to `Read` the path (with `pages` for long ones) |
| DOCX, XLSX, PPTX | A pointer to the matching Office skill |
| A folder | Its first 50 entries |
| Anything else | Size and type, not inlined |

**What it refuses on purpose.** `.env` files, private keys and certificates (`.pem`, `.key`, `id_rsa*`,
`.p12`, `.pfx`), and anything under `.git/` or `node_modules/` are named but never read. Ask Claude to
read one directly if you mean it.

**When invoked as /drop.** Tell the user, in two lines: drag the files onto this window, press Enter,
and they arrive as attachments. If the last prompt already contained paths that did not attach,
check that they exist and are not in the refused list, then `Read` them directly.

**Several files.** Drop them together; each path is attached in the order it appears. Paths in
git-bash form (`/c/Users/...`) and home-relative form (`~/Documents/x.md`) work too.

**Clipboard images.** A screenshot on the clipboard is pasted with Ctrl+V straight into Claude Code;
no drop needed.
