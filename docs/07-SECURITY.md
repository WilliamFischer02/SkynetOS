# 07 — Security and blast radius

This app spawns shells, launches executables, and lets an AI agent modify its own configuration. That's the point, and it's also exactly how a fun project turns into a bad afternoon. The rules below are cheap and non-negotiable.

## Electron hardening
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`
- All IPC channels explicitly allowlisted and typed; no `ipcRenderer.invoke(arbitraryChannel)` pass-through
- `will-navigate` and `setWindowOpenHandler` deny everything except `shell.openExternal` for `https:`
- CSP on the renderer; no remote code loaded into the main window
- The claude.ai `WebContentsView` runs in its own partition and has **no** preload, no bridge, no access to SkynetOS APIs. It is a browser tab, nothing more.

## Path and execution policy
- `devRoots` in settings (default `C:/dev`). Any node whose target resolves outside a dev root or
  the user profile requires confirmation on activation.
- `file.exe` nodes: `confirmBeforeLaunch: true` by default. A launch shows the full resolved path
  and asks.
- **One question, not two.** Opening a program outside a dev root used to raise two dialogs in a
  row — "target outside your dev roots", then "launch this program?" — for one click, about one
  file, both answered by the same person for the same reason. They are now a single dialog carrying
  the same path, the same out-of-root warning and the same refusal default. No consent is lost; a
  second dialog for the same decision only teaches people to click through without reading.
- **`confirmBeforeLaunch: false` means it.** It used to be overridden by an unconditional
  "ask once per binary per run", so a user who explicitly turned confirmation off still got a
  dialog. Setting it now suppresses the prompt — for a **user-initiated** activation only.
- **An agent is asked every time, whatever the board says.** Board JSON is agent-writable
  (`command:apply` is in `AGENT_METHODS`) and so is activation (`node:open`). If a node could
  silence its own prompt for everyone, an agent could point one at anything, clear the flag,
  activate it, and run an arbitrary program with nothing on screen. `openTarget` therefore takes an
  actor and `trustedByUser` refuses anything that is not `'user'`.
- **Elevation is always confirmed**, whatever the node says and whoever asked. "Run this" and "run
  this as administrator" are different questions.
- `settings.confirmAllLaunches` puts every prompt back. It lives in settings.json, which has no
  write channel, so it is the one lever an agent cannot touch.
- Path traversal is rejected: a board file may not reference `..` past its room root without an explicit `allowEscape: true` flag on that node.
- Board JSON is data. It never contains executable code, template expressions, or shell strings that aren't `startCommand`/`args` on a node that declares them.

## Elevation
- Default is **non-elevated**. `popout-elevated` is opt-in per node, shows a distinct sprite badge (a lightning bolt on the package), and is listed in Settings so you can audit which nodes have it.
- SkynetOS itself never runs elevated. It launches an elevated child when asked.
- The supervision loop may never start an elevated session, ever, regardless of node config.

## Agent authority
What agents can do through `skynet-mcp`:

| Action | Policy |
|---|---|
| Read board, telemetry, sessions, codex | Allowed, always |
| Create/update/move nodes and edges | Allowed, auto-snapshot first, diff shown; per-room policy `require-approval` (default) or `auto` |
| Delete a node, edge, or room | **Always requires explicit approval in the UI.** No auto policy can override this. |
| Write codex files | Allowed |
| Start/stop a declared session | Allowed |
| Send a message to a running session | Allowed, rate-limited to 3/hour/session |
| Approve a Claude Code permission prompt | **Never.** Not exposed as a tool. |
| Delete files on disk, `git push --force`, `git reset --hard` | **Never.** Not exposed as a tool. JARVIS may print the command for you to run. |
| Modify settings, allowlists, or elevation policy | **Never.** Settings are user-only. |
| Run arbitrary shell | Only within a node's declared `cwd`, and only via a session the node already declares |
| Open a terminal or session on a node, with a task | Allowed. The node supplies the working directory; the task reaches it through a staged FILE, never a command line |
| Launch elevated | **Never.** A node set to `popout-elevated` is refused, not downgraded — elevation is a decision a human made about that node |
| Start a session from a mailbox message | Allowed when the message carries `run:`, capped at 3/hour, never elevated, message archived before launch so it cannot fire twice. `autoRunMail: false` disables it |
| Replace the Face's standing orders from a mailbox message | Allowed when the message carries `standing:`. Writes exactly one file, `codex/face-brief.md`, whole, then archives the message; every earlier version stays in `archive/`. Never launches anything, even with `run:` also set. Injected only into the Hands node's briefing. Not gated on `autoRunMail`, because it starts nothing: it changes what the next session is told, which every message in `to-hands/` already does |
| Undo or redo | **Never.** The undo stack is shared with the user and is not per-actor: an agent's undo reverts whatever happened last, which may be William's work |
| Summon a native file picker or any modal | **Never.** A modal an agent raised is a modal the user may dismiss by reflex |

### Where this is enforced

`callAsAgent` in `src/main/ipc.ts`, against `AGENT_METHODS` in `packages/shared/ipc.ts`. It is an
allowlist of things granted, not a denylist — a channel added later is unreachable by an agent
until someone deliberately adds it. It also rewrites every `command:apply` request so it cannot lie
about itself: `actor` becomes `agent` regardless of what was asked for, and `approved` is stripped,
because that flag means "a human approved THIS command in THIS exchange" and an agent setting it
for itself would turn the delete guard in `command-bus.ts` into a comment.

Everything an agent can reach goes through that one function. The MCP server
(`tools/skynet-mcp.mjs`) is a proxy with no authority of its own; editing it to ask for something
else changes nothing.

The transport is a **named pipe**, not a localhost port. A port is reachable by every process on
the machine and, on a misconfigured box, from the network; a pipe is subject to the same
user-account boundary that already protects `sessions.db` and `settings.json`. A token is written
beside it in userData and required on every request — not as the security boundary, but so a
process that stumbles onto the pipe name still cannot drive the board without being able to read
the user's own AppData. The token is minted per run, so a stale control file names a pipe that no
longer exists and a token nothing will accept.

## Secrets
- No tokens, keys, or passwords in `board/*.json` — the board is git-tracked and will end up on stream. Secrets live in Windows Credential Manager via `keytar`, referenced by name.
- `service.process` nodes reference a `.env` path, never inline values.
- **The repo is public.** `FACE-BOOT.md` and `codex/mailbox/` are how the Face reads this machine,
  and anyone can read them too. Mail to the Face never quotes a secret, a token, or a path outside
  what the boards already expose.
- Before any screenshot export, the exporter redacts full paths beyond the dev root and any string matching a secret-like pattern.

## Recovery
- Auto-snapshot to `board/.snapshots/` before every agent mutation, retained 30 days.
- `board/` is git-tracked, so `git checkout board/` is always the escape hatch.
- Deleting `skynet.db` loses telemetry and session ids only; the board and codex are unaffected.
- Deleting `codex.db` loses nothing — it rebuilds from the markdown.

## Streaming safety
You will put this on stream. Add a `Stream mode` toggle that: hides the full path column in the inspector, blurs nothing (no blur — it *hides* rather than obscures), suppresses toast contents to a generic "Activity", and disables the claude.ai webview from rendering conversation text until you re-enable it.
