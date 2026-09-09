# 01 — Architecture

## TL;DR

**Electron 33+ · Vite · React 18 · TypeScript · PixiJS v8 (WebGL, nearest-neighbour) · Zustand · better-sqlite3 · node-pty + xterm.js · chokidar · simple-git · a local MCP server**

Electron is chosen over Tauri for four specific reasons, all of which are requirements here:

| Requirement | Why Electron wins |
|---|---|
| Drag a real `.jar` out of the app into the Minecraft launcher | `webContents.startDrag({file, icon})` is first-class and battle-tested ([docs](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop)). Tauri needs a community plugin. |
| Embed a persistent, logged-in claude.ai session as JARVIS's face | `WebContentsView` + `partition: 'persist:jarvis'` keeps the login and lands on a specific conversation URL. |
| Spawn/attach PowerShell + PTY sessions | Node `child_process` + `node-pty` in-process, no Rust FFI layer. |
| Speed of build by a single agent | One language across main/renderer/tooling. Fewer places to get stuck. |

Cost: ~150MB installer and ~200MB RSS. Acceptable for a single-user dashboard on a desktop PC. If that ever stops being acceptable, the port target is Tauri v2 + `tauri-plugin-drag`; keep all OS-touching code behind the `services/` boundary so the port is a rewrite of one layer, not the app.

---

## Process model

```
┌─ MAIN (node) ──────────────────────────────────────────────────┐
│  BoardStore      loads/validates/writes board/*.json           │
│  SessionManager  spawns pwsh / wt / node-pty, tracks PIDs      │
│  FileResolver    resolves node targets, globs, newest-artifact │
│  WatcherService  chokidar → file change events                 │
│  GitService      simple-git → branch/dirty/ahead-behind        │
│  CodexDB         better-sqlite3: memory, telemetry, sessions   │
│  TelemetryBus    events → heat model → renderer stream         │
│  ShellOpener     explorer.exe / start / cloud URL mapping      │
│  McpServer       stdio + local HTTP; exposes board tools       │
│  JarvisWorker    headless `claude -p --output-format stream-json` │
└────────────────────────────────────────────────────────────────┘
        │ contextBridge IPC (typed, allowlisted channels)
┌─ RENDERER (react) ─────────────────────────────────────────────┐
│  <BoardCanvas/>   PixiJS stage: substrate, traces, nodes, FX   │
│  <Inspector/>     selected-node panel (DOM, not Pixi)          │
│  <Palette/>       Edit Board drawer                            │
│  <CommandBar/>    Ctrl+K fuzzy actions                         │
│  <Terminal/>      xterm.js, embedded session tabs              │
│  <Minimap/> <Breadcrumb/> <Toaster/> <HeatLegend/>             │
└────────────────────────────────────────────────────────────────┘
┌─ WEBVIEW (isolated) ───────────────────────────────────────────┐
│  WebContentsView → claude.ai, partition persist:jarvis         │
└────────────────────────────────────────────────────────────────┘
```

**Rule:** the renderer never touches `fs`, `child_process`, or the network directly. Everything crosses via `window.skynet.*` on the contextBridge, with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

---

## Data model

Three stores, deliberately separated by lifetime:

### 1. Board data — `board/*.json` (git-tracked, human-editable)
The layout, the nodes, the traces, the names. Slow-changing, diffable, reviewable. One file per room:

```
board/root.board.json          the mainboard
board/minecraftos/room.board.json
board/deductionos/room.board.json
board/storyos/room.board.json
board/gameos/room.board.json
```

A `drive.room` node on a parent board points at a child board file. Rooms nest arbitrarily. Room folder names mirror the board id so the filesystem is browsable.

### 2. Runtime state — `%APPDATA%/SkynetOS/skynet.db` (SQLite, not git-tracked)
Fast-changing, machine-local, worthless to diff.

```sql
sessions(id, node_id, kind, cwd, claude_session_id, pid, started_at, ended_at, exit_code)
events(id, ts, node_id, kind, magnitude, meta_json)      -- telemetry firehose
heat(node_id, value, temp_c, updated_at)                 -- derived, rebuildable
artifacts(node_id, resolved_path, mtime, size, version_label, hash)
git_state(node_id, branch, dirty, ahead, behind, checked_at)
```

### 3. JARVIS memory — `codex/` markdown + `codex.db` index (git-tracked)
See `docs/04-JARVIS.md`. Markdown is the source of truth so it stays reviewable; SQLite FTS5 is a rebuildable index over it.

---

## Services

### FileResolver
Turns a node's `target` into a concrete path. Handles:
- literal paths, `%ENV%` and `~` expansion
- **artifact globs** — `C:/dev/TheStalker/build/libs/*.jar` with `exclude: ["*-sources.jar","*-dev.jar"]`, resolving to newest mtime. This is how "always point at the newest jar" works.
- staleness: if resolved mtime > N hours old while the producing agent has been active, flag the node `stale`.

### SessionManager
Four launch modes, chosen per node:

| Mode | Implementation |
|---|---|
| `popout` | `Start-Process wt.exe -ArgumentList "-d <cwd> pwsh -NoExit -Command claude ..."` (Windows Terminal if present, else `pwsh`) |
| `popout-elevated` | same, `-Verb RunAs`. UAC prompt each time. Opt-in only. |
| `embedded` | `node-pty` spawn → xterm.js tab inside SkynetOS |
| `headless` | `claude -p --output-format stream-json` for supervision/automation, no UI |

Resume behavior: on first launch, capture the Claude Code session id from the stream-json `system/init` event; store it in `sessions`; subsequent launches use `claude --resume <id>` so a chip always reopens *its* conversation, not a fresh one. Docs: <https://code.claude.com/docs/en/headless>.

### ShellOpener
Maps a node's `openWith` to a real action:
- `explorer` → `explorer.exe /select,<path>` or the folder
- `default` → `shell.openPath(path)` (Word doc opens in Word, `.exe` launches)
- `browser` → `shell.openExternal(url)` (GitHub repo root, Google Drive folder)
- `terminal` → open a PTY tab at that cwd
- `vscode` → `code <path>`

### TelemetryBus + heat model
Sources of events: PTY output bytes, Claude Code stream-json tool-use events, file writes in a watched repo, git commits, artifact rebuilds, node clicks.

```
heat[node] = heat[node] * exp(-Δt / τ) + Σ(event.magnitude)     τ = 900s
tempC      = 34.0 + clamp(heat, 0, 1) * 6.0        // 34.0 – 40.0 °C, never alarming
glow       = quantize(clamp(heat,0,1), 4)           // 4 discrete glow steps, no gradients
```
Heat decays visibly over ~15 minutes of idle. Traces glow at the same quantized step as their busier endpoint. Temperature readouts are cosmetic and labelled `SIM` in the inspector so I never mistake them for real sensor data. Real CPU/RAM/disk go on the PSU node instead (see `docs/03`).

### McpServer
A local MCP server exposing the board to any Claude Code session, and to JARVIS. This is the mechanism that lets an agent redraw the board from inside a conversation. Tool surface in `docs/04-JARVIS.md` §Tools. Registered in each project's `.mcp.json`.

---

## Rendering pipeline

```
Board JSON ──parse──► BoardGraph (nodes, edges, rooms)
                          │
                          ├─► TraceRouter: orthogonal + 45° elbow A* on the 16px grid,
                          │     bundling parallel runs, avoiding node footprints
                          │
                          └─► Pixi scene graph
                                Layer 0  substrate tilemap (solder mask + silkscreen text)
                                Layer 1  traces (static copper)
                                Layer 2  trace signal overlay (glow step + packet sprites)
                                Layer 3  node sprites + animation frames
                                Layer 4  node chrome (LEDs, temp readout, labels)
                                Layer 5  selection/edit overlay (grid, snap ghosts)
```

Camera: integer zoom only (`2x 3x 4x`), position rounded to device pixels each frame, `roundPixels: true`, textures `scaleMode: 'nearest'`, no mipmaps.

Traces are re-routed only on graph change, cached as a baked texture per room, with the animated overlay drawn on top. Target 60fps with 200 nodes; if a room exceeds ~300 nodes the answer is a sub-room, not an optimization.

## Navigation

- **Pan:** WASD / arrows (accelerating, 4px→16px per frame), middle-drag, or left-drag on empty substrate
- **Zoom:** `1`/`2`/`3` keys, Ctrl+scroll, snapping to integers
- **Enter a room:** click a `drive.room` node, or `Enter` with it selected → iris-wipe transition (hard-edged pixel iris, not a fade)
- **Leave a room:** `Esc` / `Backspace`, or the ejector on the room's edge
- **Breadcrumb:** `SKYNET / MINECRAFTOS / THE STALKER` rendered as silkscreen along the top edge
- **Ctrl+K:** command bar — fuzzy search every node in every room, jump to it, or run its action without navigating
- **Tab / Shift+Tab:** cycle nodes in reading order; `Space` activates. Full keyboard operation is a requirement, not a nicety.
