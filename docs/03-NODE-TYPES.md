# 03 — Nodes, edges, and interface systems

## Node kinds

Each entry: what it is · required fields · primary click · secondary (right-click menu) · live state shown.

> **Built 2026-09-11: the board's right-click menu, the same for every kind.** It offers Copy and
> Duplicate (the whole group when the node is in one), Paste here, Summon JARVIS, Open and Edit
> properties. Bare substrate offers Paste. The per-kind items listed below are the intended
> additions and are not built yet. See docs/DECISIONS.md "Copy and paste nodes" and "Summon JARVIS".

### `agent.code` — a Claude Code session
- **Fields:** `cwd`, `launch` (`popout` | `popout-elevated` | `embedded`), `model?`, `resume: true`, `remoteControl?` (start with Claude Code's Remote Control, so the session can be driven from the Claude app on a phone; docs/07), `initialPrompt?`, `mcpServers?`, `prelaunch?`, `addDirs?`, `readOnLaunch?`, `briefing?`
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
- **Note:** this is a logged-in webview of my own account. No scraping, no automation through it. Automation goes through `agent.code`/headless. The one exception is `agent.prompt` below, which types into it only when William presses Enter in a prompt box.

### `agent.jarvis` — the primary agent (one only, root board)
Same as `agent.chat` plus a bound headless worker. See `docs/04-JARVIS.md`.

> **The face window (built 2026-09-11).** Every JARVIS iteration opens a small face window beside
> its own window. That means the Face (this kind), JARVIS Prime's terminals (the Hands chip), any
> node tagged `jarvis`, and an `agent.chat` named like JARVIS.
> - It talks while JARVIS responds, and holds still and blinks otherwise, floating a pixel or two.
> - It comes to the front, hides and closes with the window it belongs to. For the web Face it is
>   an owned window. For a terminal, a read-only tracker follows the window by its title.
> - Frames go in `assets/avatar/jarvis/` (see its README). Per node: `avatarWindow: false`.
>   Globally: LOOK → SYSTEM → "JARVIS face windows".
> - Code: `packages/shared/avatar.ts` and `avatar-window.ts` (pure),
>   `src/main/services/avatar-window.ts` and `window-tracker.ts`, `src/renderer/ui/AvatarApp.tsx`.

### `agent.prompt` — a quick-chat box on the board
William: "a typical empty prompt box that allows for file (image and other file types) upload, and
whatever is typed into that box is fed to Jarvis Head/Face as a window with Jarvis head / face
opens."

- **Fields:** `promptTarget` (the `agent.jarvis` or `agent.chat` node it feeds; omit for the board's
  JARVIS head) and `promptMode` (`send`, the default, or `draft`). Default footprint 11x3, designator
  `P`. Needs no binding to work, so a new one is not provisional.
- **Look:** a pixel-art Claude message box drawn by the canvas (stepped corners, caret, dim
  placeholder, paperclip, send button), with a real textarea and buttons laid over it in the chrome
  font. Both use `promptLayout` in `packages/shared/prompt.ts`, so they line up to the pixel.
- **Use:** click in and type. Enter sends and Shift+Enter makes a new line; Esc leaves the box. The
  paperclip, or dropping files on the box, attaches images and other files, which show as chips
  with pixel thumbnails. Tab onto the node to put the cursor in the box.
- **Delivery:** main opens or focuses the target's conversation window, waits for claude.ai's message
  box, hands over the files, types the text, and in `send` mode presses send and reports "sent" only
  once the box empties. `draft` mode stops before pressing send. On any failure the window stays
  open, the text goes on the clipboard, and the toast says exactly where it stopped.
- **Out of the way:** below 1x zoom the overlay hides and the drawing stands in for it. In Edit
  Board mode it stops taking the pointer, so the node drags, resizes and wires like any other.
- **Code:** `packages/shared/prompt.ts` (pure), `src/main/services/prompt-send.ts` and
  `prompt-page.ts` (delivery), `src/renderer/ui/PromptBoxes.tsx` (overlay), `drawPromptBox` in
  `component-art.ts` (the pixels). The channels are user-only; see docs/07.

### `agent.prompt-to-node` — PROMPT → NODE, a box that builds a node
William: "a type of node … that presents a jarvis hand / prime prompt text box like the others …
but this one prompt-injects Claude Code so it knows to build a node based on what the user wrote in
the prompt box before hitting send; add titling elements that show a prompt to node isn't a regular
node."

- **Fields:** none to bind. Default footprint 11x4 (the quick-chat box plus one row for its tab),
  designator `P`, name and designator not printed.
- **Look:** the same pixel message box, framed in the room's signal colour instead of silk, under a
  signal-coloured folder tab across its top left. The tab carries a plus-in-a-square "build" glyph
  and the words PROMPT → NODE in a 5px pixel font. The canvas draws all of it, so it reads at every
  zoom, including below 1x where the overlay hides. `promptLayout(w, h, { tab: PROMPT_TO_NODE_TAB })`
  places the tab and pushes the box under it, and the overlay uses the same call.
- **Use:** describe the node, attach files if they help, press Enter. Nothing goes to claude.ai.
  `prompt:build` opens a FRESH JARVIS Prime terminal (the root board's Hands chip) whose opening task
  is `buildNodePrompt` (packages/shared/node-build.ts). That task holds William's words verbatim, the
  board id for every skynet tool, where the box is and where to start looking for room, the attached
  paths, and the procedure: node_fields, bind only verified targets, node_create / node_update /
  edge_create, phantom_propose when unsure, and a two-line report.
- **Code:** `packages/shared/node-build.ts` (pure, tested), `src/main/services/node-builder.ts`,
  `drawPromptToNode` in `component-art.ts`, `PromptBoxes.tsx` (shared with the quick-chat box). The
  channel is user-only; see docs/07.

### `agent.audit` — a drive auditor
William: "a drive analyzer and organizer that I can give access to a drive, we discuss the contents
of the drive and the ai determines what should stay on the drive, what can be cleaned, and how to
reorganize without breaking my dependencies."

- **Fields:** `cwd` (the starting drive, usually its root), `addDirs` (the other drives it may
  hop to), `initialPrompt` (notes for this audit), `resume`, `model`.
- **Click:** launches a Claude Code session exactly as `agent.code` does, rooted at the drive, with
  `codex/personas/drive-auditor.md` inlined into its briefing. Each drive is confirmed on launch.
  It never launches elevated.
- **Rules, in brief:** survey, classify, propose, act only on approved rows; never delete; "clean"
  means moving into `<drive>:\_skynet-quarantine\<date>\` with a manifest; dependencies checked
  before any move. The persona file has the full list of what is treated as sacred.
- **Code:** `packages/shared/drive-audit.ts` (pure, tested), `src/main/services/drive-audit.ts`.

### Obsidian: the journal note, and Obsidian-aware agents (added 2026-09-11)
- **Journal:** a `task.scheduled` with `journalVault` (a folder holding `.obsidian`) is the
  journal. A click writes today's note into that vault, into `journalFolder`, or by default the
  vault's own daily-notes folder plus `/SkynetOS`, named in the vault's daily-notes format.
  - The frontmatter is typed for the Properties view: `aliases`, `tags`, the vault template's own
    keys, `date`, `created`, `type: journal`, `source: skynetos`, `projects`, `sessions`, `tokens`
    and `rooms`.
  - Tags come from the vault's own vocabulary first, in its own style.
  - The body is the day's usage per project (with `[[links]]` to notes that exist), sessions,
    decisions and next items.
  - It never overwrites: a taken name becomes `<date> (SkynetOS).md`.
  - `journalVault` is an *optional target*: it is what the node points at only when filled, so a
    plain cron task never reads as broken.
  - No scheduler runs it yet (M8).
- **Awareness:** any node tagged `obsidian`, or with a path (`cwd`, `path`, `journalVault`,
  `addDirs`) inside a vault, is Obsidian-aware. Its sessions open with
  `codex/personas/obsidian.md` inlined in the briefing.
- **OBSIDIUS** (U5, root) is the `agent.code` for the vaults and for Obsidian plugin work, wired
  to the journal. Code: `packages/shared/obsidian.ts` (pure),
  `src/main/services/obsidian.ts` and `journal.ts`.

### Logo source, on any kind (added 2026-09-11)
`logoSource` in the editor's Appearance section, shown there by its label:
- `file`, **Logo image**: the node's `logo` image. The default, and the behaviour before this field
  existed.
- `avatar`, **JARVIS face (still)**: the avatar's still face, `assets/avatar/jarvis/idle.png`. It
  goes through the same mosaic as any logo: dithered onto the room's palette, cropped to its shape,
  cached on the file's mtime.
- `avatar-live`, **JARVIS face (animated)**: the face window's composition in the logo box, drawn
  live by the board in the frames' own colours (docs/02, rule 2's second exception).
  - The box is a mask-dark ground with a 1 px copper-dark edge. `logoScale` sizes it as it does any
    logo. The face sits in it at the largest whole-number scale that fits, or every Nth pixel when
    the box is smaller than a frame.
  - It floats and blinks. The mouth moves while that node's JARVIS responds:
    - a web node (`agent.jarvis`, `agent.chat`) while its conversation window is open and claude.ai
      is streaming;
    - a terminal node (`agent.code`, `agent.audit`) while its live session's transcript is being
      written.

    This works with the face windows switched off. Any other node idles and blinks.
  - Under reduced motion it neither floats nor blinks, and the mouth runs at half speed, because
    "responding" is state, not decoration.
  - Not on printed kinds, nor on a `monitor.system` showing its graphics (the widget owns that face).
- `none`: no logo.

Both faces are redrawn when the frames folder changes. With no `idle.png` yet the node shows no
logo and the inspector says so. `showLogo: false` still hides whichever source is chosen. It was
made for U1, and nothing on the board has been switched to it: that choice is William's.

### GIF wallpapers and logos, on any kind (added 2026-09-11)
A `.gif` works anywhere a wallpaper (`image`) or a logo (`logo`) does, and it plays.
- `imageAnimate` (Appearance, **Animate GIFs**, default on) set to false holds the first frame.
- Every frame is dithered onto the room's palette by the same mosaic as a still, and cached per
  frame.
- The board steps the frames on the GIF's own delays. A delay under 20 ms is raised to 20 ms, and
  0 or 1 cs (browsers' "as fast as you can") plays at 100 ms. A node is redrawn only when its frame
  changes, and only while it is on screen. Under reduced motion it holds still.
- Caps, per image:
  - 120 frames;
  - 16 MB of decoded output, at the size it is drawn;
  - 160 megapixels of source decoded.

  Past any of them, the first frames that fit play, and the inspector says how many. It always
  shows the frame count and the memory in use.
- A pulse glow skips a playing GIF wallpaper; the GIF is its own motion.
- A GIF chosen as the room look's tiled floor is a still: its first frame.

Code: `packages/shared/gif.ts` (compositing, caps, scheduling; pure) and `buildGifMosaic` in
`src/main/services/mosaic.ts`.

### Effects, on any kind (added 2026-09-11)
Pulse glow, text glow, chase light and scan line. Each has a colour (a palette token) and a speed
(25–400%), shown in the editor only once the effect is ticked. All are whole pixels and palette
colours; all stop under reduced motion. See `src/renderer/board/effects.ts`.

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

### `store.explorer` — a file explorer over one folder (added 2026-09-11)
William: "a pixel art representation of file explorer within a folder that actually exists on my
disk … browsing the files within looks like a pixel art / retro file explorer but references real
files / folders — the default / resting folder is selectable."

- **Fields:** `path` (the root, required), `restPath` (the folder the window opens at, inside `path`).
- **Click:** opens the explorer window at `restPath`, or at the root. A folder opens on double-click
  or Enter; a file opens with its default app, and anything that runs code (`.exe`, `.ps1`, `.lnk`…)
  is confirmed every time. A file drags straight out into another program. Keys: arrows, Enter,
  Backspace (up), Alt+Left (back), F5, Esc.
- **Resting folder:** SET AS RESTING FOLDER writes `restPath` with `node.update`, so Ctrl+Z takes it back.
- **Scope:** read-only. Every request is relative to the root; `..`, drive letters and stream names are
  refused by spelling, and a junction or symlink whose real path leaves the root is refused on entry.
  `explorer:list` is agent-readable; `explorer:open` and `explorer:drag` are user-only.
- **Code:** `packages/shared/explorer.ts` (pure, tested), `src/main/services/explorer.ts`,
  `src/renderer/ui/Explorer.tsx`.

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

> **Built 2026-09-11: tasks run on their schedule while SkynetOS is open** (`src/main/services/scheduler.ts`).
>
> - **Schedule:** five-field cron in local time (`packages/shared/cron.ts`: lists, ranges, steps,
>   0 and 7 both Sunday, `@daily` and similar).
> - **Actions** (`action.type`):
>   - `agent.run` starts a FRESH session on `taskTarget` (default JARVIS Prime) holding
>     `taskBrief` (a `.md` in the repo, read at run time) and `taskPrompt`;
>   - `journal.write` writes the Obsidian journal note;
>   - `jarvis.headless` and `notify` are valid but inert until the supervision loop and toasts exist.
> - **Rules:**
>   - one run per slot;
>   - a slot missed while the app was closed runs ONCE on opening within `catchUpHours` (default 4);
>   - a task never catches up the first time it is seen;
>   - at most 6 scheduled runs a day;
>   - never elevated.
> - **Inspector:** the next run, the last run's result, and Run now (user-only `task:runNow`).
> - **On the root board:** MORNING MAINTENANCE (`t_morning_maintenance`, 8 am →
>   `codex/briefs/morning-maintenance.md`) and the Nightly journal (`t1_nightly`, 22:00 →
>   `journal.write`).
>
> See docs/DECISIONS.md "The scheduler, and a morning maintenance run".

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

## Board look (added 2026-09-11)

A room-level field, not a node. `look` in the board file, every key optional; absent is the board
as it always looked. It is changed only through the LOOK panel (`L`, or LOOK in the breadcrumb),
by a `board.update` command, so Ctrl+Z undoes it.

```jsonc
"look": {
  "hue": 40,               // -180..180 degrees, whole-board colour (CSS filter on the canvas)
  "saturation": 120,       // 0..200 %
  "brightness": 100,       // 50..150 %
  "contrast": 100,         // 50..150 %
  "vignette": true,        // an ordered-dither darkening toward the screen edges
  "vignetteStrength": 2,   // 1..4
  "vignetteColor": "ink",  // a wire token: palette token or ink
  "tileImage": "%USERPROFILE%/Pictures/floor.png",  // must be a perfect square
  "tileEnabled": true,     // "enable background image tile"; off keeps the path
  "tileScale": 2           // integer 1..4
}
```

- **Failure path:** a tile picture that is missing, undecodable or not square is refused. The room
  keeps its own procedural substrate and a toast says why ("NOT SQUARE — 640x480"). The panel shows
  the same check under the path.
- **Stored clean:** the defaults are never written, and resetting removes `look` entirely.
- **Hide Recommended Nodes** sits in the same panel. It is a per-viewer preference kept in
  localStorage, not a board field.

---

## Phantoms — recommended nodes (added 2026-09-11)

A phantom is JARVIS's sketch of a node that should exist: a dashed ghost at the spot it would take,
a plate with its name, the reason it belongs, what it would bind to and who proposed it, the traces
it would get drawn dotted to their targets, and a tick and a cross. It lives in the board file under
`phantoms` (schema `$defs/phantom`), never among `nodes`: it resolves nothing, activates nothing and
blocks nothing a real node cares about.

- **At most 4 per board.** `MAX_PHANTOMS_PER_BOARD` in `packages/shared/phantoms.ts`, and the
  schema's `maxItems`. The Hands persona asks JARVIS to keep about four per room, refreshed as the
  board changes.
- **Tick** (`phantom:approve`, user only): the real node is built by the same factory as `node:add`,
  bound with the phantom's `fields`, placed where it was drawn (or the nearest free spot), wired as
  `connect` says, and the phantom removed — one command, one Ctrl+Z. It arrives provisional only
  if something its kind requires is still missing.
- **Cross** (`phantom:dismiss`, user only): the suggestion goes. Nothing real is touched. An agent
  withdraws its own through `command:apply` `phantom.dismiss`; the bus refuses it for William's.
- **Keys:** Tab to a plate, Enter approves, Delete dismisses. Shift+H hides every phantom (a view
  preference; they stay in the file). The HUD counts them: `n RECOMMENDED`.
- **Agents:** MCP `phantom_list`, `phantom_propose`, `phantom_withdraw`. Every path must exist
  before it is proposed.

## Edges (traces)

```jsonc
{
  "id": "t_stalker_jar",
  "from": "u_agent_stalker",
  "to": "u_art_stalker_jar",
  "kind": "produces",          // produces | reads | depends | deploys | syncs | supervises
  "width": 3,                  // 1 to 4; 2 = normal, 3 = primary
  "color": "signal",           // optional run colour, a palette token or "ink"; default copper
  "stroke": "ink",             // optional outline colour, same tokens; default ink (black)
  "dash": "dashed",            // optional run pattern: solid | dashed | dotted; default by kind
  "outlineDash": "solid",      // optional outline pattern, same values; default follows the run
  "outlineWidth": 1,           // optional, 0 to 3 px each side; default 1; 0 = no outline
  "fromAnchor": { "side": "right", "offset": 0.5 }, // optional pinned end: side + fraction along it
  "toAnchor": { "side": "top", "offset": 0.25 },    // optional; the router picks the side if absent
  "waypoints": [[12,8],[12,14]] // optional manual routing, in tiles; auto-routed if absent
}
```

- `produces` — copper, packets flow source→target. The agent→jar wire you described.
- `reads` — thinner, packets flow target→source.
- `depends` — dashed copper, 8 on / 8 off, cut into whole-pixel rectangles and never a CSS or
  Pixi dash. An explicit `dash` overrides it, `solid` included.
- `deploys` — routes to a `service.process` or a `store.cloud`.
- `syncs` — bidirectional, packets alternate.
- `supervises` — JARVIS → other agents. Drawn as a distinct 1px inner-signal-colored trace inside a wider copper run, so the JARVIS network is visually separable at a glance.

Traces that leave the room terminate in a **via** with the destination room's engraving printed beside it.

**Added 2026-09-11.**
- **Every wire has a one-pixel black outline** (`stroke`, default `ink`). Wires are drawn one at a
  time, outline, then run, then strand, so a later wire crosses over an earlier one instead of
  fusing with it.
- **Wires that share a run are drawn side by side.** The router puts both on the same half-grid
  line; `wire-lanes.ts` moves each onto its own lane, symmetric about the line and still
  orthogonal. The couriers walk the lanes.
- **Click a wire to select it**, in either mode. The trace inspector edits its kind, run colour,
  outline colour, width (1–4) and the room its strand leads to. It can also delete the wire, with
  the usual native confirmation. Every change is undoable. Escape deselects.

**Added 2026-09-11: wire patterns and hand routing.**
- **Patterns.** `dash` sets the run's pattern:
  - solid;
  - dashed: 4 on, 3 off;
  - dotted: 1 on, 2 off.

  The lengths are multiples of the run width. With no `dash`, a `depends` wire is dashed by kind
  and every other kind is solid. `outlineDash` sets the outline on its own; absent, the outline
  follows the run, and `solid` gives a continuous black sleeve with the run's dashes inside it.
  `outlineWidth` is 0–3 px per side, default 1.
- **Pinned ends.** `fromAnchor` / `toAnchor` name a side of the node and a fraction along it. The end
  sits there, snapped to the 8 px half-grid, and stays at that place on the node when it is moved
  or resized. The wire always leaves square to the side.
- **Waypoints are honoured.** The router runs A* leg by leg through each one in order, with its turn
  penalty, so the path stays orthogonal.
- **Handles.** In Edit Board mode, a selected wire shows a handle on each end, on every elbow, and in
  the middle of every segment 32 px or longer.
  - Drag an end and it slides round its node's perimeter, corners included.
  - Drag an elbow or a segment and it moves by whole tiles; the rest of the path stays orthogonal
    and the ends stay put.
  - The drop is one undoable `edge.update`.
- **Keyboard.**
  - Tab / Shift+Tab cycle the handles, from the start of the wire to its end.
  - The arrows move the focused handle. An end moves one half-grid step along its side, in the
    arrow's direction, and past a corner carries on along the next side. An arrow pointing into or
    out of the node does nothing. An elbow or a segment moves one tile.
  - The change stays pending on the overlay until Enter keeps it. Escape drops it; a second Escape
    deselects the wire.
- **Inspector.** EdgeInspector sets:
  - the run pattern (AUTO / SOLID / DASHED / DOTTED);
  - the outline pattern (FOLLOW / SOLID / DASHED / DOTTED);
  - the outline width.

  It also shows both anchors (`right 50%`, or `auto`) and the number of bends. **Reset route**
  clears the waypoints and both anchors, back to the router's own choice.
- **Not built:** dropping an end on another node to re-target the wire. Delete it and draw a new one.

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
