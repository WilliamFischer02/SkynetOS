# 07 — Security and blast radius

This app spawns shells, launches executables, and lets an AI agent modify its own configuration. That's the point, and it's also exactly how a fun project turns into a bad afternoon. The rules below are cheap and non-negotiable.

## Electron hardening
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`
- All IPC channels explicitly allowlisted and typed; no `ipcRenderer.invoke(arbitraryChannel)` pass-through
- `will-navigate` and `setWindowOpenHandler` deny everything except `shell.openExternal` for `https:`
- CSP on the renderer; no remote code loaded into the main window
- The claude.ai `WebContentsView` runs in its own partition and has **no** preload, no bridge, no access to SkynetOS APIs. It is a browser tab, nothing more.

## Path and execution policy
- `devRoots` in settings (default `C:/dev`). Any node whose target resolves outside a dev root or the user profile requires confirmation on every activation.
- `file.exe` nodes: `confirmBeforeLaunch: true` by default. First launch of any binary shows the full resolved path and a hash, and asks once.
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

## Secrets
- No tokens, keys, or passwords in `board/*.json` — the board is git-tracked and will end up on stream. Secrets live in Windows Credential Manager via `keytar`, referenced by name.
- `service.process` nodes reference a `.env` path, never inline values.
- Before any screenshot export, the exporter redacts full paths beyond the dev root and any string matching a secret-like pattern.

## Recovery
- Auto-snapshot to `board/.snapshots/` before every agent mutation, retained 30 days.
- `board/` is git-tracked, so `git checkout board/` is always the escape hatch.
- Deleting `skynet.db` loses telemetry and session ids only; the board and codex are unaffected.
- Deleting `codex.db` loses nothing — it rebuilds from the markdown.

## Streaming safety
You will put this on stream. Add a `Stream mode` toggle that: hides the full path column in the inspector, blurs nothing (no blur — it *hides* rather than obscures), suppresses toast contents to a generic "Activity", and disables the claude.ai webview from rendering conversation text until you re-enable it.
