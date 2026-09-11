# 03 — Nodes, edges, and interface systems

## Node kinds

Each entry: what it is · required fields · primary click · secondary (right-click menu) · live state shown.

### `agent.code` — a Claude Code session
- **Fields:** `cwd`, `launch` (`popout` | `popout-elevated` | `embedded`), `model?`, `resume: true`, `initialPrompt?`, `mcpServers?`, `prelaunch?`, `addDirs?`, `readOnLaunch?`, `briefing?`
- **Click:** launch or focus its session. If a session already exists, focus it instead of spawning a second one.

> **Built 2026-09-09 (M3).** `popout`, `popout-elevated` and the resume mechanism are live;
> `embedded` refuses with a legible message because `node-pty` does not build here yet.
> Two Claude Code processes on the same conversation would fight over the same session file, so a
> second click on a running chip reports the existing session rather than racing it. "New session
> (fresh context)" is the deliberate way to get a second one. The `initialPrompt` is sent only on
> a conversation that does not exist yet — resending it on every resume would re-ask the same
> question at the top of every session.
>
> **Rewritten 2026-09-10.** No chip had ever actually launched — four stacked bugs, written up in
> `docs/DECISIONS.md`. The whole launch is now a staged `.ps1` under userData whose command line
> carries nothing but file paths, it confirms itself by writing a pid file, and a conversation id
> is verified against `~/.claude/projects` before it is passed to `--resume`.
>
> Four fields arrived with it. `prelaunch` names update steps from an allowlisted registry
> (`packages/shared/prime-steps.ts`) — ids only, because docs/07 forbids executable strings in
> board JSON. `addDirs` becomes one `claude --add-dir` per entry, which is how one agent oversees
> repos on other drives without anything being moved. `readOnLaunch` and `briefing` decide what the
> session is told as it opens; the briefing is composed from the node's own bindings and ends by
> telling the agent to report READY and wait.
- **Right-click:** New session (fresh context) · Open cwd in Explorer · Open in VS Code · Copy resume command · View last 200 lines · Kill
- **Live:** running/idle/fault LED, heat, session uptime, last tool-use summary in the inspector

### `agent.chat` — a claude.ai conversation with fixed identity
- **Fields:** `url` (a specific conversation or Project URL), `partition` (default `persist:jarvis`), `persona` (path to a markdown brief in `codex/`)
- **Click:** open the embedded `WebContentsView` panel on that URL, logged in, with a prompt box. Not a fresh Claude — that specific conversation.
- **Right-click:** Open in real browser · Copy persona brief to clipboard · Reset view
- **Note:** this is a logged-in webview of my own account. No scraping, no automation through it. Automation goes through `agent.code`/headless.

### `agent.jarvis` — the primary agent (one only, root board)
Same as `agent.chat` plus a bound headless worker. See `docs/04-JARVIS.md`.

### `drive.room` — a nested board
- **Fields:** `boardFile` (e.g. `minecraftos/room.board.json`), `engraving` (e.g. `MINECRAFTOS`), `theme`
- **Click:** descend into the room. **Right-click:** open the room's folder on disk · rename engraving · export room as JSON
- **Live:** aggregate heat of everything inside; a small activity bar graph on the shield can

### `store.repo` — a git repository
- **Fields:** `path`, `remote?`, `openWith` (`explorer` | `browser` | `vscode` | `terminal`)
- **Click:** the `openWith` action. GitHub repos open the repo root in the browser.
- **Live:** branch name in silkscreen, dirty dot, ahead/behind counters, last commit age

### `store.folder` — a local folder
`path`, `openWith`. Click opens it. Live: file count + size, refreshed lazily.

### `store.cloud` — Google Drive / OneDrive / Dropbox folder
- **Fields:** `url` (cloud web URL), `localPath?` (synced mirror if any)
- **Click:** opens the cloud URL. If `localPath` exists, right-click also offers Explorer.

### `file.document` — a real document
`path`, e.g. the *Something In The Woods* manuscript. Click opens it in its default app (Word). Live: mtime, word count for `.docx`/`.md` (parsed in main, cached), a "modified since you last opened it here" flag.

### `file.exe` — a launchable program or build
`path`, `args?`, `cwd?`, `confirmBeforeLaunch` (default `true` for anything outside an allowlisted dev root). Click launches it. Live: running indicator with PID, uptime, and a Stop action.

### `file.artifact` — the newest matching build output
- **Fields:** `glob` (`C:/dev/TheStalker/build/libs/*.jar`), `exclude[]`, `label?`
- **Click:** reveal in Explorer.
- **Drag:** the cartridge sprite is a **native drag source** — drag it straight into the Minecraft launcher, a Discord message, a mods folder. Implemented with `webContents.startDrag`.
- **Live:** resolved filename, version label parsed from the filename, mtime, size, and a `STALE` badge if the producing agent has committed since the artifact was built.

### `link.url` — any bookmark
`url`, `favicon?`. Click opens the browser. Useful for CurseForge pages, docs, Bloom.host panel, Twitch dashboard.

### `service.process` — a long-running local service
- **Fields:** `startCommand`, `cwd`, `port?`, `healthUrl?`
- **Click:** start/stop toggle. **Live:** up/down, port, last health check, tail of stdout in the inspector.

> **Built 2026-09-09 (M3),** except the health check. Unlike an agent session a service is NOT
> detached: SkynetOS owns the process, keeps a 200-line tail of its output, and kills the whole
> tree on quit — a dev server that outlives the app that started it is a port you cannot rebind
> and a process you cannot find. Stopping uses `taskkill /T` for the same reason. The working
> directory must resolve inside a dev root; there is no IPC channel that accepts a command
> string, so the only shell that can run is the one the node itself declares.
- Example: the Goobtropolis test server, a Vite dev server, the BitRunners Colyseus server.

### `task.scheduled` — a recurring job
`schedule` (cron string), `action` (any node action or a headless JARVIS prompt), `lastRun`, `enabled`. Renders as a crystal oscillator that ticks. Example: "every morning at 8, run headless JARVIS to summarize what every agent did yesterday and write it to `codex/journal/`."

### `monitor.system` — the PSU
Real machine stats. This is the only node showing real hardware numbers; everything else's temperature is explicitly cosmetic.

> **Built 2026-09-11: activating it opens the system monitor.** Double-click the node, or Tab to it
> and press Space; Esc closes the panel. Modelled on Speccy, with one section per component:
>
> - **System:** OS, board, BIOS, uptime.
> - **CPU:** model, cores/threads, cache, whole-package load and effective clock, then every thread's
>   load and clock.
> - **GPU:** temperature against the driver's own slowdown margin, load, clocks, VRAM, power, fan.
> - **Memory:** use, plus every module's slot, type and configured speed.
> - **Storage:** each drive's type, bus, health, busy % and read/write rates, plus each volume's free
>   space.
> - **Thermal and fans.**
>
> Every live value has a segmented bar. The cell outlines show the expected band (ok, warn, fault)
> and the fill shows now. Sources, all non-elevated: `os.cpus()`, CIM/WMI, and `nvidia-smi`.
> LibreHardwareMonitor's WMI namespace is read whenever it is running.
>
> Windows gives a non-elevated process no CPU die temperature, fan speed or drive temperature. The
> panel lists those under NOT READABLE with the reason and the fix, and never shows a stand-in
> number. The one ACPI zone that is readable is labelled as a motherboard sensor, not the CPU.
>
> Agents read the same data with the `system_info` MCP tool (`hardware:snapshot`). Readings are
> cached for 2–3 s and nothing is read while nobody is asking. Code:
> `packages/shared/hardware.ts` (pure), `src/main/services/hardware.ts` (reading),
> `src/renderer/ui/SystemMonitor.tsx` (panel).

### `note.silk` — engraved text, no component
`text`, `size` (11|22). For section labels and reminders on the board.

### `group.zone` — a silkscreen outline box
A labelled rectangle grouping related components inside a room, like a functional block on a real schematic. Selecting the zone selects its members. Purely organizational, no target.

> **Built 2026-09-10.** Addable, removable and fully editable from the board. `N` in Edit Board
> mode opens the add-component palette; a new zone arrives 10x6 and is dragged and resized to fit.
> Its interactive size cap is the board (512 tiles), not the 48 a component gets — a bracket is
> meant to span a room. Selecting the empty margin selects the zone; clicking a component inside
> it selects the component, because hit-testing is smallest-area-wins.

### `decor.image` — a backdrop
- **Fields:** `image` (required), `footprint`
- **Click:** nothing while browsing. It is not a click target outside Edit Board mode.

Any image on disk, dithered onto the room's six colours and drawn in its own layer above the
substrate and BELOW the copper. So a trace crosses it, a component stands on it, and a courier
walks over it. Resizable like any other node, up to the whole board.

Printed rather than mounted: it occupies no grid, never collides, and is excluded from every
overlap check — `tools/validate-board.mjs`, `board-store.graphProblems`, `layout.findFreeSpace`
and `drag.canDrop`, which are four separate implementations of the same rule and must stay in
step. It is also not a click target while browsing, so a board-sized backdrop does not swallow
every click on empty substrate.

New ones arrive with `showName` and `showDesignator` off: a nameplate floating over a background
element reads as a mistake.

---

## Edges (traces)

```jsonc
{
  "id": "t_stalker_jar",
  "from": "u_agent_stalker",
  "to": "u_art_stalker_jar",
  "kind": "produces",          // produces | reads | depends | deploys | syncs | supervises
  "width": 3,                  // 2 = normal, 3 = primary
  "waypoints": [[12,8],[12,14]] // optional manual routing; auto-routed if absent
}
```

- `produces` — copper, packets flow source→target. The agent→jar wire you described.
- `reads` — thinner, packets flow target→source.
- `depends` — dashed copper (drawn as an alternating tile, not a CSS dash).
- `deploys` — routes to a `service.process` or a `store.cloud`.
- `syncs` — bidirectional, packets alternate.
- `supervises` — JARVIS → other agents. Drawn as a distinct 1px inner-signal-colored trace inside a wider copper run, so the JARVIS network is visually separable at a glance.

Traces that leave the room terminate in a **via** with the destination room's engraving printed beside it.

---

## Systems you didn't list but the app needs

These fill the gaps. Each is small; together they're the difference between a demo and a program you'll actually open every day.

1. **Edit Board mode (`E`)** — grid overlay, component palette drawer, drag to place, snap to 16px, live collision check against footprints, inspector for the selected node's fields, `Ctrl+Z/Y` undo stack, and a diff preview before writing the JSON. Traces are drawn by dragging from one node's pad to another's; the router does the rest.

   **Built 2026-09-09: the grid overlay, dragging, snapping and collision checking.** Still to
   come: the palette drawer and trace drawing.

   Two drag gestures, distinguished by what is under the cursor:
   - **Pan** — left-drag on empty substrate, or middle-drag anywhere, in either mode.
   - **Move** — left-drag on a component, **only in Edit Board mode**. Browsing a board involves
     a lot of clicking and a click that drifts two pixels must never relocate a component, so
     moving is gated behind `E`. Below a 4px threshold a press is a click, not a drag.

   The ghost shows where the component would land, in the room's signal colour when the drop is
   legal and `fault` when it is not — off the board edge or overlapping another footprint, which
   are exactly what the schema and the command bus would reject. On release the move goes through
   the command bus as a `node.move`, so it is validated, snapshotted and `Ctrl+Z`-undoable like
   every other mutation.

   **`E` and `F2` are different operations.** `E` toggles Edit Board mode; `F2` opens the selected
   node's field form. They used to share one flag, which meant opening a form silently made every
   component draggable.

   When the whole board fits on screen the camera is centred and panning correctly does nothing —
   the HUD says `WHOLE BOARD VISIBLE — NOTHING TO PAN`, because a gesture that does nothing for a
   good reason is indistinguishable from a broken one.
2. **Node wizard** — placing a node opens a 3-field form, then *verifies the target exists* before committing. You can't place a broken node by accident, only intentionally (with a `provisional: true` flag that renders it as an unpopulated footprint — a real PCB convention, and a great TODO marker).

   **Built 2026-09-09, ahead of M6, as the target picker + node editor.** The pieces that exist now:
   - `packages/shared/node-fields.ts` declares every editable field per kind, with a `control`
     type. A test checks it against `schema/board.schema.json`, so the form offers exactly the
     fields the schema accepts and marks exactly the ones it requires.
   - Fields whose control is `path-file`, `path-dir`, `glob`, `url` or `board-file` render as a
     **target field**: a text box, a **Browse…** button that opens the native OS picker, and a
     live **verdict** (`RESOLVES` / `NOT FOUND` / `INVALID` / `OUTSIDE DEV ROOT`) that re-checks
     as you type. Picking a concrete file for a `glob` field generalises it to `*.<ext>` and says
     so, because "the newest jar" is almost always what was meant.
   - URL fields are **shape-validated only**. SkynetOS deliberately does not fetch the URL: the
     renderer has no network, and firing a request at whatever is typed would leak to a third
     party at edit time, on a machine that is going to be streamed. The UI says it did not fetch.
   - Saving builds a `node.update` command and hands it to the command bus in the main process.
     The form never writes a file itself, which is what puts a snapshot in front of and a Ctrl+Z
     behind every edit — the same ones an agent's edit gets.
3. **Command bar (`Ctrl+K`)** — fuzzy search across every node in every room by name, designator, path, or tag. Enter jumps to it; `Ctrl+Enter` runs its primary action without leaving the current room.
4. **Global search (`Ctrl+Shift+F`)** — ripgrep across all bound repo paths, results grouped by node, click to open at line.
5. **Minimap** — top-right, current room, with heat baked in. Click to jump.
6. **Inspector panel** — everything about the selected node: resolved target, live state, recent events, related traces, quick actions, and its Codex entries.
7. **Session dock** — a bottom drawer listing every live session across all rooms with uptime and last activity, so agents running in other rooms are never invisible. This is the thing that stops sessions getting orphaned.
8. **Activity feed** — a right-edge scrolling log of telemetry events in silkscreen type, filterable per room. It's also how you notice an agent has been stuck for 20 minutes.
9. **Alerts** — a buzzer node on the root board flashes when: a session exits nonzero, a watched build fails, a repo has been dirty >24h, a scheduled task missed, or a target path disappears. Windows toast + in-app toast.
10. **Snapshots** — `Ctrl+Alt+S` writes a timestamped copy of all board JSON to `board/.snapshots/`. Auto-snapshot before any agent-initiated board mutation. This is your undo of last resort for anything JARVIS does.

    **Built 2026-09-09.** Snapshotting turned out to be worth doing for *user* edits too, not just
    agent ones — it costs a few kilobytes and means Ctrl+Z is not the only way back. Every
    mutation that actually changes something snapshots first; a no-op save writes nothing and
    consumes no undo step. Retention is `snapshotRetentionDays` in settings, pruned at launch.
11. **Board diff viewer** — when JARVIS changes the board, a review panel shows the JSON diff and the visual before/after, with Accept/Revert. Agent edits can be set to `require-approval` (default) or `auto` per room.
12. **Focus mode (`F`)** — dims everything except the selected node and its direct traces. Useful when a room gets dense, and directly useful for how you work.
13. **Screenshot / export (`Ctrl+Shift+P`)** — exports the current room as a clean PNG at 4x with no UI chrome. You'll want this for the stream and for documentation.
14. **Drop-in ingestion** — drag a file or folder from Explorer *into* a room and SkynetOS offers to create the right node type for it, pre-filled. Drag a `.jar`, get an artifact node. Drag a repo folder, get a repo node with git wired up.
15. **Templates** — "new mod project" stamps a standard cluster: agent chip + repo drive + artifact cartridge + traces + a CurseForge link node, all wired, with paths derived from one name input. Adding mod #7 should take 15 seconds.
16. **First-run scan** — on install, scan `C:/dev` (configurable) for git repos and offer to auto-place them into rooms grouped by common parent folder. You start with a populated board, not an empty one.
17. **Health check (`Ctrl+H`)** — validates every node target in every room, lists broken ones, offers bulk repair (re-glob, re-path, delete).
18. **Settings** — dev roots, allowlists, elevation policy, agent-edit policy, reduced motion, zoom, telemetry retention, audio on/off.
19. **Audio (optional, off by default)** — a soft relay click on node activation, a faint coil whine that rises with total board heat. Three short samples, no music. Genuinely helps the "living machine" feel; make it trivially mutable.
20. **Offline/degraded behavior** — no network, no Claude auth, or a missing `claude` binary must degrade to a clearly-labelled read-only board, not a crash or a spinner.
