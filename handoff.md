# handoff.md

Rewritten at the end of every session. This is what the next agent reads first, after `CLAUDE.md`.

**Last session (2026-09-23, U3 JARVIS-PRIME, the away hour):**
- The Tailscale guide for William's side: `docs/guides/remote-setup-tailscale.md`.
- FinanceOS: a room, a ledger model, `npm run finance:report`, a finance-advisor persona; numbers
  live only in gitignored `private/finance/`, which William fills from a template.
- Mail: `docs/10-EMAIL.md` and `codex/briefs/email-triage.md`; the Gmail inbox surveyed read-only
  (1 P0, 11 P1 found); labels blocked until the connector gets the modify scope.
- `prime/`: JARVIS Prime's own workspace, with `board:overlap` and `board:snapshot`.
- A bad remote token now counts toward the lockout, as docs/07 said.
- That morning: the `notify` task shows a Windows toast; three renderer fixes.

Details under "The away hour — 2026-09-23" and "Morning maintenance 2026-09-23" below, and in
docs/DECISIONS.md. Nothing committed; William has not asked. Nothing has been seen on screen.

**Session before (2026-09-12, voice and THE MATRIX):** voice control end to end, two raised hands
place the cursor, a Windows 3.1 arrow, THE MATRIX (`G`). Nothing tried with a microphone or on
camera. Details under "Voice, two hands and THE MATRIX — 2026-09-12".

## The away hour — 2026-09-23 (U3 JARVIS-PRIME, William at work)

William: a detailed Tailscale setup for his side; a FinanceOS room with meters, alerts and a place to
work on income and debt; JARVIS reading and managing his inboxes with an urgency scale through one
hub; and a persistent workspace for JARVIS Prime. "Proceed." Three forks, one owner per file; this
session kept the shared docs. **Nothing committed, nothing deleted, no dialog raised, no account
logged into, no mail sent or moved.** Reasoning in docs/DECISIONS.md "2026-09-23 — The away hour".

**1. Read this first: `docs/guides/remote-setup-tailscale.md`.** Eleven sections, one action per
step with what the screen should say. On this PC everything is already done except one restart and
three presses: `npm run boot`, then `L` → System → REMOTE → **Allow remote devices** → **PUBLISH TO
MY TAILNET** (a confirm dialog; Cancel is the default) → **PAIR A DEVICE** → scan the QR with the
iPhone within 5 minutes → Share → Add to Home Screen. Not tried on a real phone; the guide says
where each "you should see" is a prediction.

**2. `private/` is the home for anything about William, and git never sees it.** `.gitignore` has
`private/`; `private/finance/`, `private/email/`, `private/prime/` exist with a README. The repo is
public: a balance or a bank's name in a handoff would ship with the next commit.

**3. FinanceOS (roadmap M11).** `board/financeos/room.board.json` (27 nodes: INSTITUTIONS zone with
J1–J4 `link.url` provisional BANK / CREDIT CARD / LOAN / SAVINGS; LEDGER zone with S1 LEDGER →
`private/finance`, S2 IMPORTS, F1 README; ADVISOR zone with U1 CC-FINANCE on the new
`codex/personas/finance-advisor.md`, T1 WEEKLY FINANCE REVIEW Sunday 18:00 and T2 BILLS DUE Monday
09:00, **both disabled**), reached from **D5 FINANCEOS** on the root board (edited on disk, snapshot
`board/.snapshots/2026-09-23T17-51-27-000Z-agent-financeos/`, **Ctrl+Z will not undo it**). The
model: `packages/shared/finance.ts` (accounts, bills, transactions, CSV import with per-institution
mappings, meters, 30-day spending and earning rates, utilisation, alerts each ending in an action;
`test/finance.test.ts`, 32). The tool: `npm run finance:report` reads `private/finance/ledger.json`
and `imports/*.csv`, prints the summary, writes `report.json`. The board: `finance:status`
(board window only) and `FinanceBlock.tsx` on the LEDGER node's inspector: a meter per account,
stale ones dotted, every alert as a state box. New room theme in `palette.ts` and docs/02.
`private/finance/` holds the README, `ledger.template.json` (fake round numbers) and
`mappings.json`; **no `ledger.json` exists: the numbers are his.** `private/finance/institutions.md`
lists what the mail survey revealed, for the J1–J4 links. Unbuilt: a `monitor.finance` kind drawing
meters on the board face; live bank data (rejected for now, DECISIONS). `npm run board:overlap`:
six boards, no overlap.

**4. Mail.** `docs/10-EMAIL.md` (Gmail as the hub; the Outlook phone app aggregates on the phone
only, so a server-side hub is needed) and `codex/briefs/email-triage.md` (the P0–P3 scale, the
categories, what runs unattended). The Gmail inbox was surveyed read-only: about 10,000 threads,
read to zero, six unread, roughly nine tenths promotions and notifications, **1 P0, 11 P1, 5 P2**
items that look like they need him, listed with dates and reasons in
`private/email/survey-2026-09-23.md`. **No label was created or applied:** the connector is
authorised read-only ("Insufficient scope"), so the mailbox is untouched; the 26-thread labelling
plan is in `private/email/labels-applied-2026-09-23.json` for a run after he re-authorises. No bank
or card writes to Gmail at all, so banking mail almost certainly lives in the hotmail account, which
this session cannot see. The Microsoft 365 connector is present and deliberately left
unauthenticated.

**5. Prime's workspace: `prime/`.** `README.md`, `toolbox.md` (every tool a session can reach, and
where things live), `playbooks/` (session start, board edit on disk, report and stop, parallel
forks, unattended run), `learning/` (repo patterns, Electron notes, a reading list), `log.md`, and
two tools: `npm run board:overlap` (all five boards clean) and `npm run board:snapshot -- <label>`.
`prime/tools/**` is typechecked by verify; `test/board-overlap.test.ts` (6). `codex/index.md`
points at it. `prime/scratch/` is gitignored. My Claude Code memory (outside the repo) now holds
William's profile, the working rules, and today's goals.

**6. A security fix, wanting his eye:** `src/main/services/remote-server.ts` now counts a bad
device token toward the ten-in-ten-minutes lockout, as docs/07 "Wrong guesses turn it off" always
claimed; before, only pairing codes counted. Test added. Verify green.

**For William, in order (one action each):**
1. `npm run boot`. Everything main-process today (the toast, `finance:status`, the remote lockout)
   needs it, and it is step 1 of the phone guide.
2. Open `docs/guides/remote-setup-tailscale.md` and do sections 2–4: three presses and a QR scan.
3. Open FINANCEOS from the root board; copy `private/finance/ledger.template.json` to
   `ledger.json`, replace every number, run `npm run finance:report`, select LEDGER.
4. Read `private/email/survey-2026-09-23.md`: the one P0 and eleven P1 items. Then docs/10 step 8
   (re-authorise the Gmail connector with the modify scope) so the next run can label.
5. Decide: which institutions go on the public board (J1–J4), and whether hotmail forwards into
   Gmail.

**Landmines from today:**
- `board/.snapshots/2026-09-23T17-47-10-359Z-agent-help/` was made by running `board:snapshot`
  with `--help` (the label became "help"). Harmless, gitignored, not deleted (docs/07).
- vite-node strips the script path from `process.argv`; a `.ts` tool cannot recognise itself there.
- The Gmail connector's scope, and whether a chip-launched session has the connector at all, are
  the two facts that gate every mail automation. Neither is in the repo's control.

## Morning maintenance 2026-09-23

The MORNING MAINTENANCE task, run as a catch-up for the 08:00 slot. Unattended, per
`codex/briefs/morning-maintenance.md`. Nothing committed, nothing deleted, no board file touched, no
dependency added. `npm run verify` was green before (103 files, 1,604 tests) and after every change
(103 files, 1,606). Stopped at the brief's bound: three improvements and one roadmap step, inside the 45
minutes. Reasoning in docs/DECISIONS.md "2026-09-23 — Morning maintenance".

**Changes, all uncommitted:**

1. **Roadmap step, M8 "Windows toasts"** — `packages/shared/schedule.ts` (`notify` is a `TaskAction` and a
   `DispatchPlan`; `taskLabel` shared with the scheduled prompt), `src/main/services/scheduler.ts` (an
   Electron `Notification`, titled with the task; a dev copy borrows electron.exe's App User Model ID),
   `packages/shared/node-fields.ts` (the Action field's help). Tests: `test/schedule.test.ts` "reads a
   notify action as its message, and refuses one with nothing to say" and "shows a notify action as a
   toast titled with the task". One older assertion, that `notify` was unsupported, was replaced by the
   new tests rather than loosened. Verify: green, 1,606. **The toast has not been seen on screen.**
2. **Space works on the usage meter's three role="button" spans** — `src/renderer/ui/UsageMeter.tsx` lines
   143, 165, 182. They answered Enter only. No test (renderer). Verify: green.
3. **A gesture switch that fails to save says so** — `src/renderer/ui/GestureCatalogue.tsx`, `toggle`.
   It never read `result.ok`. No test (renderer). Verify: green.
4. **A failed schedule read shows as a warning** — `src/renderer/ui/ScheduleBlock.tsx`. A rejected
   `task:status` rendered READING THE SCHEDULE… in green for as long as it failed; now COULD NOT READ THE
   SCHEDULE with the reason and the 30 s retry. No test (renderer). Verify: green.

**Found, left alone**, now on the roadmap as "Known issues" 11–15: mailbox and gesture catalogue claim
emptiness before and after a failed read; the mailbox's clipboard copy has no failure path; a failed
away-mode save keeps the typed value; the MANUAL chip's tooltip drops its instruction on failure; six
bare fallback strings. And, reported after the bound was reached, "Known issues" 16–18: five comments
naming things that do not exist (one word each), the id slug and the path normaliser each written
three and two times, and twelve exports in `src/main/services/` with no reader, four of them saying
they exist for tests. 16 is the obvious first pick for the next run.

**For William:** 2, 3 and 4 hot-reload in `npm run dev`; 1 is main-process and needs a restart. To see 1:
open DeductionOS, select T1 Daily drill reminder, press **Run now**; a Windows toast titled "T1 Daily drill
reminder" should appear, and the inspector's LAST MANUAL RUN line should read "showed a toast: …". If
nothing appears in a dev copy, check Windows Settings → Notifications for an "electron" entry that is off.
Ctrl+Z has nothing to undo here; this session made no board edits.

## Refresh, the installer, updates, and sessions on the phone — 2026-09-21 (U3 JARVIS-PRIME)

William asked for three things: a board that notices a rebuilt jar, an exe with an update workflow,
and Tailscale for his phone and iPad. All uncommitted. `npm run verify` green at the end (103 files, 1,604 tests; was 98 and 1,544). Reasoning in docs/DECISIONS.md, 2026-09-21.

**1. The board sees builds (the TimeServed fault).**
- Cause: `watchBoard` skipped directories that did not exist, so a never-built mod was never
  watched; and the relink poll refreshed targets but not artifacts, so the cartridge kept NO BUILD.
- `packages/shared/watch-plan.ts` + `src/main/services/watchers.ts`: a missing directory is waited
  for at its nearest existing ancestor (three steps at most, never a drive root or a Windows system folder), and the watch
  re-plans when it appears or when a watched directory is removed.
- `refreshFiles` in the store: **F5**, the palette ("Refresh files and builds"), a **Refresh (F5)**
  button on file nodes in the inspector, the window regaining focus, and the relink poll. The toast
  names what changed (`packages/shared/refresh-summary.ts`).
- Tests: `test/watch-plan.test.ts` (16, two against a real temp directory: first build, clean then
  rebuild), `test/refresh-summary.test.ts` (9).
- **Needs a restart** (the watcher is main-process). Not seen on screen by a person; the packed exe's
  smoke capture of MinecraftOS does show `TIMESERVED-1.2.0.JAR V1.2.0`.

**2. The installed program (docs/09-RELEASE.md, roadmap M10).**
- `release/SkynetOS-0.1.0-x64.exe` exists (145 MB). **William has not run it.** `npm run install:local`.
- Program and data are separate: an install's data home is the repo (`services/home.ts`). ABOUT shows
  the home, the build and the update state.
- `npm run pack | dist | release | install:local | release:publish`, `tools/make-icon.mjs`,
  `tools/build-info.mjs`, `tools/release.mjs`, `tools/ship.mjs`. Version is now **0.1.0**.
- Updates: `src/main/services/updater.ts`, electron-updater, GitHub Releases. Nothing is published;
  `npm run release:publish` is William's.
- Start with Windows sets the exe when pressed in the installed copy.
- The packed exe was run through the smoke harness beside the live dev copy: home
  `C:/dev/SkynetOS (built-from)`, five boards, the full screenshot set.

**3. Tailscale and the phone.**
- This PC needs nothing installed: Tailscale is signed in, MagicDNS and HTTPS certificates are on
 , the iPhone is on the tailnet. Nothing is published yet.
- Left for William, all user-only switches: restart SkynetOS, `L` → SYSTEM → REMOTE → **Allow remote
  devices** → **PUBLISH TO MY TAILNET** → **PAIR A DEVICE**, scan the QR with the iPhone.
- Sessions: an `agent.code` node's editor has **Reachable from my phone** (`remoteControl`). Its next
  launch adds `--remote-control "<designator> <name>"`; the Claude app, signed in as William, then
  reads and drives the session. docs/07 "Sessions from the phone". Not tried on a phone.
- Roadmap "Known issues" 9 (half revoke) is fixed, with a test.

**An incident, caused by this session and fixed in it.** The smoke runs of the packed exe overwrote
and then removed the live app's `%APPDATA%/SkynetOS/control.json`. William's app kept running, but the
skynet MCP tools answer SKYNETOS IS NOT RUNNING until it is restarted. `npm run smoke:shots` always
had this fault. Fixed: a smoke run keeps its control file in its capture folder, and a process removes
only a file that names its own pid (`packages/shared/control-file.ts`, `test/control-file.test.ts`),
proved with a decoy that survived a run. The `to-face` note for this session was written by hand.

**Landmines from today:**
- **Never start `release/win-unpacked/SkynetOS.exe` plainly while William's app is open:** it takes
  over from the running copy (`services/instance.ts`). Run it with `SKYNET_SMOKE_DIR` and
  `SKYNET_SMOKE_SHOTS_ONLY=1`, which is exempt and writes nothing to the board.
- A bash heredoc collapses doubled backslashes even with a quoted delimiter. Write regex-bearing
  scripts with the Write tool.
- `npm install` from the Claude Code shell needs `env -u npm_config_allow_scripts`.
- The installed copy and the dev copy share `%APPDATA%/SkynetOS`, settings and `skynet.db` included.
- An older installed build refuses a board that uses a schema field it does not know.
  `remoteControl` is the first such field. It is in the 0.1.0 installer as rebuilt at the end of this
  session; any build made earlier today is not the one to install.

## Morning maintenance 2026-09-19

The MORNING MAINTENANCE task, run as a catch-up for the 08:00 slot. Unattended, per
`codex/briefs/morning-maintenance.md`. Nothing committed, nothing deleted, no board file touched, no
dependency added. `npm run verify` was green before (98 files, 1,538 tests) and after every change
(98 files, 1,544). Stopped at the brief's bound: three improvements and one roadmap step, well inside
the 45 minutes. Reasoning in docs/DECISIONS.md "2026-09-19 — Morning maintenance".

**Changes, all uncommitted:**

1. **The Frame select says what each frame draws** — `packages/shared/node-fields.ts` (`optionHelp`
   on `FieldSpec`, set to `FRAME_BLURB` on the frame field) and `src/renderer/ui/NodeEditor.tsx` (the
   `title` of each option, and of the select for the chosen option). `FRAME_BLURB` was written for
   this tooltip and nothing read it. Test: `test/node-fields.test.ts` "says what each frame does, for
   every frame the select offers". Verify: green, 1,539. **Not seen on screen.**
2. **The schedule readout's errors end in an action** — `packages/shared/schedule.ts`, `nextRunFor`.
   "DISABLED" and "THIS SCHEDULE NEVER FIRES" now say to tick Enabled, or to check the day and month
   fields. Test: five new cases in `test/schedule.test.ts`; `nextRunFor` had none. Verify: green, 1,544.
3. **The REMOTE panel survives a rejected call** — `src/renderer/ui/RemotePanel.tsx`. `toggle` no
   longer leaves the switch disabled when main rejects, and `revoke`, `makeCode` and `publish` say
   what failed instead of nothing. No test: there is no DOM environment (roadmap "Known issues" 10).
   Verify: green, 1,544. **Not seen on screen.**
4. **Roadmap step, docs/06 "Known issues" 8 (exports nobody imports)** — every one of the fifteen
   read: fourteen are live inside their own file and stay exported; `FRAME_BLURB` was the dead one
   and is change 1. A wider count found three more with no second mention. One fixed:
   `src/main/services/settings.ts` imports `REMOTE_DEFAULT_PORT` instead of repeating 47821. Two
   left for William: `isChannel` and `FEATURE_NAMES`. Verify: green, 1,544.

**Found, left alone**, now on the roadmap as "Known issues" 9 and 10: a failed save in
`revokeDevice` leaves a device half revoked (socket still open, token good again after a restart);
and no `.tsx` handler can be unit-tested without a DOM library, which is a new dependency.

**For William:** the renderer half (1 and 3) hot-reloads in `npm run dev`; 2 and 4 are main-process
and need a restart. To see 1: open any node's editor, Appearance, hover the Frame select with a frame
chosen. To see 2: untick Enabled on a `task.scheduled` node and read its inspector. Ctrl+Z has
nothing to undo here; this session made no board edits. The working tree already held several
hundred uncommitted files, so `git diff` on a file shows earlier work as well as this run's.

## The MinecraftOS mod grid — 2026-09-15 (afternoon, U3 JARVIS-PRIME)

William: "build out the layout of the other minecraft mods … formatted the same as The Stalker …
background image behind, and its agent, repo, and jar lined up … all of the mod layouts sorted
neatly into a grid." Seven mods: LociBook, Just1Nudge, TimeServed, ThereCouldBeGiants, PaceKeeper,
TheStalker, MCCamOp. All seven repos are on disk under `C:/dev`.

**Done, in `board/minecraftos/room.board.json`, uncommitted:**
- Seven identical clusters in two columns (x 32 and 110) and four rows (y 30, 54, 78, 102). Each:
  a 59x18 backdrop (`minecraft-cover.jpg`, the Stalker's) three tiles proud of a 53x12 zone; an
  8x7 castellated agent at +2,+3 with the mod's `icon.png` as its face; the LED beside it; the repo
  at +21,+3; the jar at +46,+3; screws at the zone's corners; agent → repo → jar wires, and jar →
  Client mods. Row 3 is LociBook and Just1Nudge; row 4, left, is MCCamOp.
- PaceKeeper, Giants and TimeServed were brought to the Stalker's shape (agent 7x6 → 8x7, zone 11 →
  12 tall, castellated frame, backdrop, icon). Their ids, designators, notes and priorities are
  unchanged. The Stalker's own nodes did not move.
- William's `u_new_agent` (Claude-MCCamOp, made in-app at 17:17) is now `u8_agent_mccamop`,
  CC-MCCAMOP, keeping his `prelaunch` and icon. Its session id in `skynet.db`, if any, is under the
  old id.
- The deployment bus, the backlog and the second fiducial moved down 48 tiles; `grid.height` 132 →
  180. Nothing else moved.
- Phantoms `ph_just1nudge` and `ph_mccamop` withdrawn (U3's own; they are real nodes now). The two
  remaining phantoms moved with the bus.
- Not added: TimeServed → Client mods. It is a server-side mod that deploys to Goobtropolis only.
- Snapshot of every board before the edit: `board/.snapshots/2026-09-15T17-51-43-000Z-agent-mod-grid/`.
  **Ctrl+Z will not undo this** (edited outside the command bus); `git checkout board/` or the
  snapshot restores it.
- Checks: `validate:board` ok (80 nodes, 24 traces); `paths:check` portable; no two components
  overlap; extent 166x163 inside 192x180; vitest 1,538 green (the router test routes the real board).
- The running app re-reads the file on the next `board:load`, so leaving and re-entering the room
  shows it; a room already open shows the old layout until then.

**Not seen on screen.** Backdrop overlap of the two columns: column L's backdrop ends at x 88,
column R's starts at 107, so they do not touch. Icons on chips have been seen only for William's
own MCCamOp node.

## Morning maintenance 2026-09-15

The MORNING MAINTENANCE task, run as a catch-up for the 08:00 slot. Unattended, per
`codex/briefs/morning-maintenance.md`. Nothing committed, nothing deleted, no board file touched.
`npm run verify` was green before (97 files, 1,529 tests) and after every change (98 files, 1,538).
Stopped at the brief's bound: three improvements and one roadmap step. Reasoning in
docs/DECISIONS.md "2026-09-15 — Morning maintenance".

**Changes, all uncommitted:**

1. **Drag badges no longer overlap** — `src/renderer/ui/DragBadges.tsx`. The DIRTY PLUSH over PANIC
   fault from "What is next" 1 ("Known, seen in a screenshot"). The phantom plates' push-below rule
   now lives in `src/renderer/ui/stack-plates.ts` (`pushBelow`, `boxesOverlap`, `plateOrder`) and
   both overlays use it. `Phantoms.tsx` calls the helper instead of its inline loop; same comparison,
   same order. Test: `test/stack-plates.test.ts`, 8 cases. **Not seen on screen**: the rAF placement
   cannot run under vitest. Verify: green.
2. **Dead helper removed** — `packages/shared/adaptive.ts`, `ema`. No importer, no caller in its own
   file, a comment describing callers that did not exist. Verify: green.
3. **Roadmap step, docs/06 "Known issues" 1 (rotation)** — `test/node-fields.test.ts` now pins that
   the rotation control is offered on `decor.part` and `decor.image` only, for every kind. The
   hiding half is ticked with that evidence; rotating component art stays open. Verify: green.

**Found, left alone**, now on the roadmap as "Known issues" 7 and 8: `useChromeLayout`'s 400 ms
re-measure, and a dozen never-imported exports in `packages/shared/`.

**For William:** restart `npm run dev` or `npm run boot` and zoom the root board out to 1/4x: the
DIRTY PLUSH and PANIC badges should stack instead of covering each other. Ctrl+Z has nothing to undo
here; this session made no board edits.

**Session before (2026-09-12, U3 JARVIS-PRIME, gesture baseline):** rebuilt gesture recognition from
geometry up for the five controls. Details under "Gesture control — 2026-09-12, the baseline".

**Before that (2026-09-11/12, U3 JARVIS-PRIME, gesture rig):** hand roles, the training wizard, the
catalogue audit. Details under "Gesture control — 2026-09-11".

**Session before (2026-09-11, U3 JARVIS-PRIME):** gave the Face a way to read this machine. `FACE-BOOT.md` at the repo root, rebaked by a pre-commit hook. `standing:` mail now writes `codex/face-brief.md`. The panel honours a pasted header, so `run:` works through it for the first time.
**Then:** the Face sent its face-brief protocol (v1: five sections, a header with written-at and supersedes). SkynetOS now writes that header itself, and FACE-BOOT shows the orders in force as section 5. The Face has not yet sent a first instance; the protocol message William relayed was cut off mid-sentence.
**Restart SkynetOS once more** before the first `standing:` message: the dev app was restarted before the protocol header landed. An older app still works; it just writes the pre-protocol header, which is still read correctly.
**Session before that:** stood SkynetOS up on the second desktop (`William-Desktop`). No code changed.
**Milestones done:** M0–M4, plus most of M5 (usage telemetry, animation).
**Committed by William since:** U3's read list, zoom down to 1/4x, the Browse fix, group selection, couriers on the traces, file-based usage credit, and the system monitor panel.
**Uncommitted, built on 2026-09-11 by this session and its parallel agents (forks A–F), in three batches:**
- **Batch 1:**
  - wires: black outlines, parallel lanes, selectable, trace inspector;
  - prompt node `agent.prompt` (quick chat to the Face);
  - monitor widget on the PSU/MONITOR faces;
  - Fable 5.1 → Opus 5 fallback with the CORES countdown;
  - effects (chase and scan, plus colour and speed on every effect);
  - drive auditor `agent.audit`;
  - usage calibration;
  - node editor sections;
  - one-line help and the `?` key panel;
  - wrapped drag badges.
- **Batch 2:**
  - copy, paste and duplicate (Ctrl+C/V and a right-click menu, one undo per paste);
  - Summon JARVIS from any node;
  - countdown digits in seven whites and greys;
  - earthy tones on the editor sections;
  - the board LOOK panel (`L`: hue, saturation, brightness and contrast, a dithered vignette, a square tiled background);
  - phantom recommended nodes: about 4 per room, a tick or a cross, seeded on every board, Shift+H hides them;
  - `store.explorer`, a retro file explorer (RESEARCH → `C:/dev/DirtyPlush/research`);
  - the DIRTY PLUSH REPO node;
  - the research library with its fetch tool (`npm run research:fetch`);
  - the Dirty Plush codex entry;
  - an efficiency pass: the monitor widget no longer keeps PowerShell running, and the relink poll backs off.
- **Batch 3:**
  - the corner prompt to the Face (bottom left, `/`) with rotating quotes;
  - `agent.prompt-to-node` (PROMPT → NODE: briefs a fresh JARVIS Prime to build a node);
  - a proposed voice, `codex/personas/voice-blend.md`, not in force;
  - `npm run smoke:shots`, screenshots only, safe beside a running app;
  - OBSIDIUS (`u_obsidius`, an `agent.code` in the SolidState Sync vault, tagged `obsidian`),
    wired to the nightly journal;
  - a click on the journal (`t1_nightly`) writes a new Obsidian note into
    `01 Personal/-a- JOURNAL/SkynetOS/`, with frontmatter and the vault's own tag spelling. It
    never overwrites (`wx`);
  - every Obsidian-aware session gets `codex/personas/obsidian.md` inlined (`isObsidianAware`);
  - recommendation plates never overlap, and their tick and cross say why when they cannot act.
- **Remote (fork Q):** the whole app on an iPhone, iPad, Mac or second PC. It is the same renderer,
  served from 127.0.0.1 over a WebSocket, reached through Tailscale, with pairing by QR code and a
  `remote` actor. It is off until William turns it on in LOOK → SYSTEM → REMOTE. Steps are in
  "What is next" item 9. The same fork fixed a desktop bug: when the pool was 90% spent or more,
  the usage meter's `fault` class picked up the fault-screen layout, which stretched the meter
  down the window and turned its bars vertical.

**`npm run verify` is green at 1,233 tests (77 files)** after the overnight batch: forks N–Q, the room restyle, the Face window fix, and the usage meter folding on a phone.

It has been seen only in smoke captures (`npm run smoke:shots`):
- the four restyled rooms;
- the layout audit: 56 desktop states plus the phone and tablet windows, with 0 overlaps, 0 off-screen and 0 clipped;
- the remote pages, over the bridge.

It has not been seen in William's running app. SkynetOS needs a restart for everything main-process: the renderer half hot-reloads in `npm run dev`; the main-process half does not.

---

## Voice, two hands and THE MATRIX — 2026-09-12

**Voice.**
- `src/main/services/voice.ts` runs three things, and `voice:setEnabled(false)` stops all three:
  - the wake sidecar: PowerShell and System.Speech, with a closed grammar from `wakeScript`;
  - `whisper-server.exe` on 127.0.0.1:47831;
  - the hidden capture window: `src/renderer/voice.html`, partition `voice`, microphone only, no network.
- The board side is `ui/useVoice.ts` and the summoned JarvisDock.
- Settings keys: `voice.server`, `voice.serverModel`, `voice.port`, `voice.phrases` and
  `voice.captureLabel`. The defaults point at `%LOCALAPPDATA%/SkynetOS/voice/cuda/Release/whisper-server.exe`
  and `…/voice/models/ggml-large-v3-turbo-q5_0.bin`, both present on William-Desktop.
- `npm run voice:probe` checks the engine with synthesised speech and no microphone. Last run: loaded in
  1,325 ms; sentences took 64–83 ms, and all four came back word for word.
- Rules: docs/07-SECURITY.md → Voice.

**Gestures** (`gesture-control.ts`):
- Two raised open hands put the cursor between them.
- Zoom events carry x and y, and `useGesture.ts` zooms with a wheel event at that point.
- A click lands at the cursor 70 ms before the close was noticed.
- An unmistakable fist enters at once.
- Movement starts a drag only after 150 ms closed.
- The hand that closes while two are up keeps the controls.
- `test/gesture-two-hands.test.ts`: 7 of its 8 tests failed on the old code, and all pass now.

**The pointer.** `ui/cursor-sprites.ts`: a Windows 3.1 arrow, and a closed hand while dragging.

**THE MATRIX.**
- The code:
  - `packages/shared/matrix.ts` — the geometry, with 21 tests;
  - `src/renderer/matrix/MatrixView.tsx` — a software rasteriser;
  - `src/main/services/visits.ts` — `userData/visits.json`, written on every successful `node:open` from
    the board window;
  - the `node:visits` channel.
- It opens with `G`, the MATRIX button, or "open the matrix".
- `npm run smoke:shots` now also captures `07-matrix.png` and `08-matrix-zoomed.png`.
- A colour census of the globe in that capture found exactly the room's four colours.

**The breadcrumb row.**
- The room path truncates; the switches do not.
- Below 1100 px wide the switches show icons alone.
- The planner places the usage meter and LOOK (`usageTop`, `lookTop`).
- A remote screen does not show MANUAL or VOICE.
- Layout audit: all 56 desktop states failing → 6. Those 6 are the HUD clipped with the inspector open,
  which was already the case before this work.

## Gesture control — 2026-09-12, the baseline

**Why most gestures did nothing:** the driving-hand gate required the old pointing posture (so an open
hand and a fist never drove), `hand-metrics.ts` measured upright hands 44% too narrow at 16:9 (so they
failed the readability gate), and the pointer sat on a fingertip that moves 22% of the frame when a
fist closes. Not the training data.

**New files:** `packages/shared/hand-geometry.ts` (3D curl as reach, fused points with perspective undone,
palm side from anatomy), `pose-model.ts` (Student-t mixture with near-miss rejection; refinement from
recordings), `one-euro.ts` (cursor filter), `hand-synth.ts` (kinematic hand + pinhole camera);
`tools/gesture-eval.ts` (`npm run gesture:eval`) and `tools/gesture-model-probe.mjs`
(`npm run gesture:probe`). Tests for each, plus a rewritten `test/gesture-control.test.ts` in which a
synthetic hand performs every control frame by frame.

**Rewritten:** `gesture-control.ts` for the five controls; `hand-roles.ts` takes an injected control-pose
gate and the aspect ratio; the vision page prefers MediaPipe's GestureRecognizer
(`%LOCALAPPDATA%/SkynetOS/vision/gesture_recognizer.task`, downloaded 2026-09-12, SHA-256 in DECISIONS)
and falls back to the HandLandmarker; the wizard records pose features at the shutter and has a CHECK
DIRECTION step; `useGesture.ts` moves the cursor by the driving camera's measured mirroring.

**Measured:** synthetic accuracy table in DECISIONS (open 98–100%, fist 99.6–100%, peace 96.5%, per
frame). The model probe loads the recognizer in-app on GPU in 330 ms and runs at 3.3 ms a frame.

**Landmines:**
- Recordings made before today carry no pose features, so they sharpen nothing. Re-record to teach the
  pose model.
- `DEFAULT_MIRRORED` changed meaning and value: it is now camera geometry, default `false`. The label
  correction is `labelsSwapped`. Never derive one from the other.
- `handMetrics(hand, aspect)` defaults to 1 for the older square-coordinate test hands. Anything fed
  real camera landmarks must pass 16/9.
- Top-level `await` in an ESM Electron entry deadlocks `app.whenReady()` — every probe uses an unawaited
  `main()`.

## Gesture control — 2026-09-11

Reasoning in `docs/DECISIONS.md` under "Hands have roles, training has a conscience, and gestures
have variants". Everything here is **built, typechecked, tested and bundled, and none of it has
been in front of a camera yet.** That is the whole of what is next.

### Per-hand roles (`packages/shared/hand-roles.ts`, `test/hand-roles.test.ts`)

`assignHands(hands, previousDriver, config)` gives every hand a role each frame — `driver`,
`support`, `resting`, `edge` — from where it is (a title-safe action boundary), what shape it is
in, and how readable it is. Sticky driver, so the pointer does not flick between two raised hands.
This replaces `hands[0]`, which is what made the cursor work only with both hands present.

`gesture-control.ts` now separates the SUBJECT of recognition (any readable hand) from the hand
that is DRIVING, because a fist is not a pointing posture and the halt and suppression gestures
were unreachable while recognition was gated on a driver. Zoom needs two `raised` hands, not two
pointing ones — a zoom is made with cupped hands.

### The wizard (`src/renderer/vision-train.ts`), rewritten

- **Paced.** 3 s countdown before the first keyframe, 1.8 s between keyframes, 2 s between takes,
  and the shutter waits for four frames within 0.045 hand spans before firing — with a 2.5 s
  timeout so a tremor cannot deadlock it.
- **Cropped hand thumbnail per keyframe** (`snapshotHand` in `vision.ts`). Transient data URL,
  never written, never sent over IPC.
- **Keyframe editor** before START: `+`/`−` between 1 and 3. Arms on the first click, acts on the
  second, because it discards the gesture's examples.
- **RETRY CAPTURES** per gesture, and **REDO LAST KEYFRAME** within a take.
- **Alternative takes** — clean, rough, angled, other-hand, far — offered once a clean set exists.
- **A fourth phase, CHECK**, which audits what was just taught and offers REPAIR.

### The wizard's buttons are pinned (fixed after William hit it)

The first run trapped him on the intro screen: the window is a fixed 820x620 with
`overflow: hidden`, and the new furniture pushed START and NOT NOW below the fold. `.wz` is now a
flex column with a scrolling `.wz-body` and the action row pinned outside it; empty furniture
collapses; the previews use `clamp(120px, 24vh, 220px)`.

`npm run gate:wizard` (`tools/wizard-layout-probe.mjs`) checks all six phases at the real window
size in real Electron and reports which buttons, if any, fall off. Holds to a 150px viewport.
**Landmine:** a top-level `await` in an ESM Electron entry deadlocks `app.whenReady()` — put the
work in an unawaited `main()`.

### The 2026-09-12 rework (second pass, after William's first real training run)

- **Shutter is a clock**: 8s countdown per keyframe, banks whatever is in shot at zero; 2s red grace
  only when nothing at all was visible. No detection gate.
- **Training detection at 0.15** (control stays 0.5), `numHands: 2` always in train mode.
- **Both cameras banked** per take, one example each, tagged by lens. Thumbnail wall shows a row per
  camera.
- **Three hand modes**: `one` / `two` / `both`, declared per gesture. Second hand on its own
  `offhand` track. `hands: 2` from earlier that day migrates to `mode: 'two'`.
- **Travel gestures**: `travel: true` changes the prompts to START/FINISH positions; every sample
  records `path` (palm centre per keyframe).
- **New vocabulary**: open hand = cursor, fist = click, fist + travel = drag, open to peace = right
  click. ONE FIST is RETIRED (`RETIRED_BUILT_INS`) because it was trained to be ignored and a fist
  is now the click.
- **Confirmation after every take** — which also kills the endless-variant loop (only a successful
  take used to count toward the end condition). Plus BACK between gestures.
- **Handedness — reworked after William reported it inverted.** ONE calibrated fact, `mirrored` on
  the calibration profile (default `true`, i.e. most webcams present a mirror). Both rules derive
  from it: `sideFromLabel` for labels, `rightHandHasSmallerX` for the position fallback. The camera
  page passes the landmarker's label through untranslated. Loaded back on wizard start — the first
  version wrote it and never read it. Correctable from AIM *and* from the gesture card
  (`SWAP L/R`), and the detected hand is named on every camera row during a take.
  **Landmine:** never interpret a handedness label or a left/right position anywhere without going
  through those two helpers. Two independent guesses is what caused the bug.
- **`packages/shared/gesture-analysis.ts`**: leave-one-out accuracy, per-gesture separation, fitted
  thresholds (geometric mean of own-spread and nearest-rival), measured travel axes. `TUNE FROM MY
  DATA` in CHECK writes the thresholds in and reports accuracy before/after. New IPC:
  `gesture:analysis`, `gesture:tune`, `gesture:setMode`, `gesture:setTravel`.

**Not yet done, and it matters:** `gesture-control.ts` still implements the OLD poses at run time —
aperture-based pinch for the click, roll for the right click. The catalogue now describes the new
vocabulary and the trainer records it, but the live tracker has not been rewritten to match. Until
it is, training teaches the right things and control still acts on the old ones.

### The safety net (`libraryHealth`, `gesture:health`, `gesture:repair`)

A sample is condemned only if it is nearer to a different gesture than to its own siblings AND does
not belong with its siblings either. The second clause is load-bearing: without it, one intruder
landing on CURSOR condemns the whole of CURSOR too. Endangered-but-innocent classes are marked
`watch` and left alone. The board's catalogue shows the verdict as a banner with a REPAIR button.

### New IPC

`gesture:resetSamples`, `gesture:dropSample`, `gesture:setFrames`, `gesture:repair` (vision page
only, `VISION_METHODS`); `gesture:health` (both windows, `VISION_SHARED`).

### CLOSE THE BOOK

One hand shutting like a cover switches manual control off. Intercepted in `visionEvents` in main —
the way out must not depend on the board being responsive — then forwarded so the board can put its
crosshair away.

## What landed this session

Reasoning for each is in `docs/DECISIONS.md` under 2026-09-11.

### 1. FACE-BOOT.md: the Face's whole view of the repo

The Face tested its reach. Drive is search-only. GitHub works, but it can fetch only URLs that
William pasted or that appeared in an earlier result, and it cannot list directories. Its entire
cold-start reach is the root page plus one hop. So `FACE-BOOT.md` sits at the root and inlines:
the codex index, unread `to-face/` mail, board truth (every unresolved target, every provisional
node, resolved through `target-resolver.ts`), this handoff's lead block and "What is next" titles,
and the MCP tool names.

- `npm run face:bake` → `tools/face-bake.ts` (vite-node) → `src/main/services/face-boot.ts` (pure).
- `npm run face:hook` installs a **pre-commit** hook that bakes and stages it. Installed on
  William-Desktop and WF_LAPTOPMAIN; the laptop's first bake landed as `04cb826`. Board truth is
  resolved on whichever machine committed last, and the file names it.
- The lead block and numbered bold titles under "What is next" in THIS file are what the Face sees
  as the Hands' state. Keep them accurate and keep that shape.

### 2. Standing orders

A message with `standing: true` makes SkynetOS write its body over `codex/face-brief.md`, then
archive it. The Face owns the file and the Hands never edit it. Every Hands session opens with it
inlined between the briefing and the mail (`session-manager.ts`). Only the node picked by
`pickHandsNode` (`packages/shared/face-brief.ts`) receives it, and `run:` dispatch now uses the same
function. The file does not exist yet: the Face has a shape for it and has not sent it.

### 3. Mailbox fixes

- The panel lifts a pasted header (`liftPastedHeader`). Before this, a `run:` pasted through the
  panel landed in the body and never fired.
- MCP `mailbox_send` never passed `from`, so agent mail was signed `undefined`. It also wrote
  `to: to-head`. `normaliseSide` fixes the side and `from: 'hands'` fixes the signature.
  Verified live after the restart: the side is right. The signature still came out `unknown`,
  because the MCP server is spawned once per Claude Code session and this one predates the fix.
  A fresh session picks it up.
- The mail section of a briefing now gives absolute paths, because U3 runs from `C:/dev`.

### 4. The resolver runs without Electron

`settings.ts` reads `%APPDATA%/SkynetOS/settings.json` directly when `app` is absent, and never
creates it from there. `target-resolver.ts` derives its board root from `skynetRoot()`. `tools/**/*.ts`
is now typechecked.

### 5. Today's board work (uncommitted)

- **Wires.** Parallel lanes (`board/wire-lanes.ts`, pure). A black outline under every run, drawn in
  one Graphics per wire (`traces.ts`). Per-edge `color`, `stroke` and `width` 1–4, with `ink` as a
  wire-only token (`palette.ts`). `EdgeInspector.tsx`. Click hit-testing is `wireAt`.
- **Prompt node** (fork A). `agent.prompt` sits under U1 as `q_quick_chat`. `prompt:*` channels are
  user-only. Delivery is `prompt-send.ts` and `prompt-page.ts`.
- **Monitor widget** (fork B). `monitor-widget.ts` and `live-slots.ts`. `showSystemGraphics: false`
  puts the node's chosen image back.
- **Fable fallback** (fork C). `model-availability.ts` in shared and main, `FableCores.tsx`, and
  `--model`/`--effort` in `launch-args`. Settings `autoModel` and `fableResetsAt`.
- **Effects.** `board/effects.ts` (pure). Chase and scan, plus a colour and a speed (25–400%) on every
  effect. They are drawn on `effectLayer` above the nodes.
- **Drive auditor.** `agent.audit` is launched as an `agent.code` session with
  `codex/personas/drive-auditor.md` inlined. The persona quarantines and never deletes.
- **Calibration.** `calibrateFromLimits` reads `quotaLimits` refusals out of the transcripts.
  `PlanDialog` offers the measured limit, or a percentage typed in from `/usage`.
- **Editor sections.** `SECTION_ORDER` and `sectionOf` in `node-fields.ts`. A section with a missing
  required field opens itself.

---

## Second desktop — state as of 2026-09-10

`npm ci` and `npm run verify` are green here. Of 63 target paths across the five boards, 41
resolve. Everything the board points at inside the repo (`%SKYNET%`), in OneDrive
(`%USERPROFILE%`), and in `%APPDATA%/.minecraft` relinked untouched. FACE-BOOT's count differs (32
unresolved primary targets) because it counts one target per node, not every path field.

The rest is **not a portability bug**:

- **TruthQuestRetro was cloned here.** This machine has Build Tools 2026 and no VS 2022, so the
  repo's `win-debug` preset cannot configure. A gitignored `CMakeUserPresets.json` in that repo
  adds `win-debug-vs2026`, which builds into the same `build/win-debug` folder the root board's
  PLAYER and FORGE nodes point at. Rebuild with `cmake --build --preset win-debug-vs2026` using the
  CMake bundled in Build Tools, since none is on PATH.
- **The gameos room's TQR paths are stale on every machine.** `tools/forge` is `forge/`,
  `docs/design.md` is `docs/design/game-design.md`, the executables are `player.exe` and
  `forge.exe`, and there is no `assets/` folder (art lives in `content/` and `assets-inbox/`).
  Not repointed: Release vs Debug is the user's call.
- **Five Minecraft repos exist nowhere but the primary desktop.** GoobtropolisTest, Hurtcraft,
  JohnWickMobs, TheBlobs, TimeServed are not on GitHub.
- **storyos and deductionos still carry `REPLACE_ME` template paths** from the base commit. The
  novels are actually in `%USERPROFILE%/OneDrive/Documents/01 DOCUMENTATION/` and the
  "Something In The Woods (PANIC) Novel" Claude project folder.
- **Anki is not installed** on either desktop.

Session ids in `skynet.db` do not travel, so "Resume conversation" on an agent node starts fresh
here the first time.

---

## Landmines

### New this session

- **Voice hears the wake phrase on the Windows DEFAULT input only.** The sentence after it uses the same
  device unless `voice.captureLabel` names another.
- **`src/main/services/voice-status.ts` is now only a re-export** of `voice.ts`. Removing the file needs
  William's approval (docs/07).
- **whisper-server's first start after a reboot compiles CUDA kernels**, so VOICE … can last far longer than
  the 1.3 s measured warm. Port 47831 must be free.
- **`ControlEvent` `click` and `zoom` now carry `x` and `y`.** Use them: the click point is deliberately not
  the last cursor drawn.
- **The MATRIX swallows plain keys while it is open**, so the board underneath cannot act unseen. Ctrl
  shortcuts still pass.
- **Smoke shots-only now opens and closes the MATRIX** between `05-whole-board.png` and the face shots. Its
  `07-` and `08-` names sit beside the face's `07-` to `09-`.
- **Pillow is not installed.** The pixel census used a stdlib PNG decoder in the session scratchpad, not in
  the repo.

- **U3 runs from `C:/dev`, so its `readOnLaunch` entries are prefixed `SkynetOS/`.** Fixed
  2026-09-11. `resolveReading` joins them to the cwd and does not expand `%SKYNET%`, so keep that
  prefix when editing the list. `persona` is `%SKYNET%/codex/personas/persona.md`, so the
  inspector's Verify resolves it.
- **Start with Windows is per machine.** The Run value (`HKCU\...\Run\SkynetOS`) and its login
  script (`%APPDATA%/SkynetOS/boot.vbs`, with this machine's node and repo paths) are never in the
  repo. Switch it on separately on each desktop: the LOOK panel's SYSTEM section, or
  `npm run autostart:on`. On 2026-09-11 it was tested on William-Desktop (on, read back, off) and
  left OFF. Each sign-in start logs one line to `%APPDATA%/SkynetOS/boot.log`.
- **Replace-on-launch needs one restart to begin.** A copy started before 2026-09-11's
  `instance.ts` holds no single-instance lock, so a new copy runs beside it instead of replacing
  it. After one restart, `npm run boot` (or a sign-in start) closes the open copy and takes over.
  `npm run dev` takes part too: starting a boot copy closes the dev copy.
- **JARVIS Prime's face finds its terminal BY TITLE.** The launch script sets
  `SkynetOS — <designator> — <name>` (made ASCII) and `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`.
  Change either and the face loses its window. `test/avatar-window.test.ts` holds the fragment
  and the script together.
  - The tracker is ONE hidden `powershell.exe` (user32 P/Invokes), started with the first tracked
    terminal and stopped with the last. If faces stop following, look for it in Task Manager and
    for `[tracker]` lines in the log.
- **The rooms were restyled outside the command bus on 2026-09-11** (DECISIONS: "The rooms,
  restyled"). Ctrl+Z will not undo it. The originals are in
  `board/.snapshots/2026-09-11T12-00-06-237Z-agent-room-restyle/`.
- **The Face window now waits for claude.ai to finish loading** before the face attaches or its
  probe runs. If it still hangs, Ctrl+Shift+R in that window clears its cache (the login is
  kept), and F12 shows why.
- **Every path a process is started in must be EXPANDED.** Board values carry `%USERPROFILE%` and
  `%SKYNET%`. Hand one to `spawn` or `Start-Process` raw and it is a folder that does not exist:
  the launch dies before a window opens. That is how every terminal and admin terminal on a
  portable node broke on 2026-09-11. Use `expandPath` or the resolved target. `openTerminal` now
  refuses a missing working directory up front.
- **`%APPDATA%/SkynetOS/launch/` is the evidence locker.** Every launch leaves `<key>.ps1`, and a
  `<key>.pid` once the shell actually runs. A script with no pid never ran. Read the script: it is
  exactly what was executed.
- **`npm run smoke` edits the real `board/`.** It does a node drag, a notes edit and a hand-drawn
  wire, each undone, and writes a probe row to `skynet.db`. Beside a running SkynetOS, use
  `npm run smoke:shots`, which stops before the first write.
- **Parallel agents and board files.** On 2026-09-11 fork C rewrote every board file whole while
  fork A was adding nodes to `root.board.json`. Fork A's nodes survived, checked by id afterwards,
  but only because the timing was kind. When more than one agent edits a board, have each use
  targeted edits or the command bus, never a read-modify-write of the whole file.
- **DirtyPlush is a PUBLIC repo.** `research/.gitignore` keeps out the POST workbooks (state
  copyright, no redistribution licence) and every file over 20 MB. `node tools/fetch-research.mjs
  --restore <dir>` rebuilds them on another machine from `SOURCES.json`, checking each sha256.
- **New user-only channels need a restart:** `node:paste`, `jarvis:summon`, `prompt:build`,
  `phantom:approve`/`dismiss`, `explorer:open`/`drag`, `mosaic:boardTile`, and `prompt:send` with no
  node. Until main restarts, each fails as "no handler".
- **The prompt node's delivery has never run against claude.ai.** Its selectors are best knowledge;
  the failure path (window stays open, text on the clipboard, toast says where it stopped) is the
  guarantee. Fix selectors in `src/main/services/prompt-page.ts`.
- **Usage is per machine; limits are per account.** This machine's only recorded five-hour limit
  hit had no local usage in its window at all: the work ran elsewhere. Every meter figure is
  this machine's share. On the roadmap (docs/06 item 5).
- **`npm run dev` hot-reloads the renderer mid-edit.** A half-applied edit shows up as a Render Fault
  on William's screen and clears itself when the edit lands ("monitorFaces is not defined" was
  exactly that). Keep each renderer edit self-consistent.
- **Never find a window with `BrowserWindow.getAllWindows()[0]`.** It is the newest window, which
  is the Face's once that has been opened. Use `boardWindow()` from `services/main-window.ts`.
- **Two persona files disagree.** U1 uses `codex/personas/persona.md`, U3 the older
  `codex/persona.md`, which lacks the voice section. Root-level `persona.md` and `jarvis-voice.md`
  are untracked copies William added; they match `codex/personas/` apart from whitespace.
- **The Claude Code shell sets `npm_config_allow_scripts`**, and npm 12 refuses it in a
  project-scoped install (`EALLOWSCRIPTS`). Clear it for that one command:
  `Remove-Item Env:npm_config_allow_scripts; npm install ...`.
- **The repo is public.** `FACE-BOOT.md` and `codex/mailbox/` are world-readable.
- **Board edits made in the running (pre-restart) app store absolute image paths.** Three
  backdrops arrived as `C:/dev/SkynetOS/...` and turned `paths:check` red; each was rewritten with
  `npm run paths:portable`. The picker fix stops this once SkynetOS is restarted.
- **The system monitor cannot read CPU die, fan or drive temperatures non-elevated.** It says so
  under NOT READABLE. Running LibreHardwareMonitor as administrator fills them in automatically
  (WMI namespace `root/LibreHardwareMonitor`).
- **`git commit -- <paths>`** uses a temporary index, so the pre-commit hook's `git add` may not
  make it into that commit. A normal `git commit` and GitHub Desktop are fine.

### `sendInputEvent` does not produce pointer events

`BoardCanvas` listens for `pointerdown`. `win.webContents.sendInputEvent({ type: 'mouseDown' })`
produces the mouse half and **no pointer event at all**. The smoke harness dispatches real
`PointerEvent`s: `pointerdown` on the canvas, `pointermove`/`pointerup` on `window`.

### The smoke harness must not guess where things are

Ask the page. `document.elementFromPoint` arbitrates "clickable"; `window.__skynetCamera` and
`window.__skynetWire` say where things actually are; poll for a change rather than sleeping; and
always undo what you created, because this runs against the real `board/`. scaleFactor 2 means
main sees 1267x717 while the page is 2534x1434.

### Renderer `console.info` is filtered in the smoke log

Forwarded only when the level is not `info` **or** the message starts with
`[router|atlas|ui|mosaic]`. Use one of those prefixes for a probe.

### Bash heredocs eat backslashes

`\n` inside a heredoc becomes a literal newline in the file. Use the Write/Edit tools, a Python
heredoc with a quoted delimiter, or `String.fromCharCode(92)`.

### The older ones, still true

- **Never use `existsSync` to test for an executable.** Windows App Execution Aliases are
  zero-length reparse points and `stat` throws EACCES. Use `services/which.ts`.
- **A node texture is described in exactly one place** (`specFor` in `BoardCanvas.tsx`).
  `test/render-invariants.test.ts` guards it structurally.
- **A control inside `.breadcrumb`, `.hud` or `.help` needs `pointer-events: auto`.**
- **The Ajv validator is keyed on the schema file's mtime+size.**

---

## What is next

**0. Voice, two hands and THE MATRIX, live (2026-09-12).** Restart SkynetOS first: most of this is
main-process. Nothing opens a microphone or a camera until you press its switch.
1. Settings (`L`) → Audio should read Off, with the speech engine ON THIS MACHINE. Make the microphone you
   speak into the Windows default input.
2. Press VOICE. It reads VOICE … while the model loads, which takes longer on the first start after a
   reboot, then VOICE ON.
3. Say "Hey JARVIS", wait for LISTENING in the middle of the screen, then say "zoom in".
4. Say "what did I work on yesterday". It is shown with Esc to cancel, then sent to the Face.
5. Say "stop listening". If the wake phrase never fires, suspect the Windows default input first.
6. Turn MANUAL ON and raise both hands: the arrow goes between them. Move the hands apart and together to
   zoom about it, and close one hand to click where they put it.
7. With one hand, make quick close-and-open clicks. Report any miss with the monitor's pose line.
8. Press `G`. Drag the globe and let go while it moves; try WASD; turn the wheel onto a file; press Enter to
   open it. Then do the same with MANUAL ON.

**0 (earlier on 2026-09-12). The five controls, on camera.** Relaunch SkynetOS so the main process picks up the
gesture model route. Turn manual control on and watch the monitor: between actions it shows the pose and
its probability ("OPEN 94%"). Then, in order: open hand moves the cursor; close-and-open clicks; close,
hold and move drags; peace sign right-clicks once; two hands pointed at each other zoom. If the cursor
runs backwards, run CALIBRATE AND TRAIN → AIM → CHECK DIRECTION and save. Report the probabilities the
monitor shows for any pose that does not work — that number says whether it is the model or the timing.

**0′. (Superseded 2026-09-12 — kept for the record.) The gesture rig, on camera.** Nothing below has been seen working; every claim about it is a
claim about tests, not about hands.

   - **0a.** Relaunch SkynetOS first — a probe cleanup on 2026-09-11 killed every `electron.exe`
     on the machine, which closed the running app and its MCP server with it. Then turn manual control on, and check the resting posture — pointer and
     thumb toward the screen, not touching — no longer produces a stream of double clicks. The
     hysteresis band was widened (`apertureThresholds`, 0.30/0.62 of the learned range) and a 70 ms
     debounce plus an 0.85 excursion test were added; whether that is enough is a question only his
     hand can answer.
   - **0b.** One hand up, one resting on the desk: the raised one should keep the cursor and the
     resting one should not start a zoom.
   - **0c.** CLOSE THE BOOK: open flat palm, then shut it. Manual control should switch off.
   - **0d.** Run CALIBRATE AND TRAIN end to end. Watch the countdown, the HOLD gate and the
     thumbnails. Then add one alternative take (SLOPPY) to CURSOR and see whether the CHECK phase
     still passes.
   - **0e.** If gestures are already misbehaving from the last training pass, open the catalogue on
     the board first: if the amber banner is there, press REPAIR before re-training.
   - **Known unbuilt, and named in DECISIONS:** per-camera roles from `viewpointOf`, the
     POINT·CLICK·TWIST calibration phase, transition learning, and the whole of voice.

1. **Restart SkynetOS and check today's work on screen.** None of it has been seen yet. Items 1a–1c have never been run at all; do those first.
   - **1a. The prompt node against the real claude.ai page.** Type in QUICK CHAT under JARVIS and press Enter.
   - **1b. The Fable countdown.** It shows UNKNOWN until a restart time is typed into it.
   - **1c. A drive auditor on a spare drive.**
   - **1d. PROMPT → NODE** (`q_prompt_node`, below QUICK CHAT): type "a node for the TimeServed jar" and see whether the fresh Prime builds it through the MCP tools.
   - **1e. Summon JARVIS** from a right-click, with and without a directive.
   - **1f. The corner prompt** (bottom left, `/`): a real send to the Face.
   - **1g. Phantoms:** tick one and cross one on the root board, then undo both. On an app started
     before the phantom channels existed, the X only closes the plate on screen, and a toast asks for
     a restart.
   - **1h. The journal:** click `t1_nightly` and check the note in
     `SolidState Sync/01 Personal/-a- JOURNAL/SkynetOS/`. Launch OBSIDIUS once: the path has spaces
     and is on OneDrive, and its briefing should carry the Obsidian section.
   - **Known, seen in a screenshot:** at overview zoom the DIRTY PLUSH and PANIC drag badges overlap
     each other. It is the same fault the phantom plates had; give DragBadges the same de-overlap.
   - **The rest:**
     - wires selectable and restylable, with parallel lanes and black outlines;
     - the effects' colour and speed;
     - the monitor widget and its switch;
     - CALIBRATE in the usage meter;
     - the grouped node editor, now in earthy tones;
     - `?` for keys;
     - copy and paste across rooms;
     - the LOOK panel (`L`);
     - the RESEARCH explorer window;
     - the quotes above the corner prompt.
   - **Before any of that,** `npm run smoke:shots` puts six screenshots in `.smoke/` without touching the board.
2. **Prove standing orders end to end with the Face's first real brief** — restart SkynetOS, paste the Face's `standing:` message into the panel whole, confirm `codex/face-brief.md` appears with the protocol header, and open U3 fresh to see it in the briefing. Not yet run.
3. **A board selector** — save and load board variations, so alternatives can be tried side by side.
4. **Rooms within rooms.** `drive.room` already points at a board file; the descend stack already holds more than two levels.
5. **Agent node output boxes.** A summary of the agent's last output (no model needed: the last assistant turn is in `~/.claude/projects/<cwd>/<uuid>.jsonl`) and an in-character remark (`claude -p` on the Max subscription).
6. **A commercial UI pass** — tooltips, auto-closing submenus, more symbols, fewer words, transitions.
7. **William's logged overhauls, docs/06 "Known issues":**
   - rotation that actually rotates component art;
   - the TruthQuestRetro fonts, each at its exact pixel-clean sizes;
   - a private cross-machine usage ledger;
   - the editor's remaining simplification.
8. **The JARVIS face.**
   - **Done:** William's 12 frames are in `assets/avatar/jarvis`, pass every rule
     (`test/avatar-frames-real.test.ts`), and render crisp at 2x in a preview window, photographed
     by `npm run smoke:shots` (`.smoke/07-09`). PREVIEW FACE is in LOOK → SYSTEM.
   - **Still unseen live:** a face tethered to the real Face window or a Prime terminal, and the
     talking signals from claude.ai and from a transcript. Check both after the next restart.
9. **Remote from the iPhone, iPad, a Mac or another PC (M9): built, off, never tried on a real
   phone.** The phone runs the desktop renderer itself, in Safari, over a WebSocket to the PC
   (`docs/08-REMOTE.md`). Pairing William's iPhone:
   1. `npm run boot` (the remote code is main-process, so the running app does not have it).
   2. Install Tailscale on the PC (tailscale.com/download) and on the iPhone (App Store), signed
      into the same account.
   3. On the PC, press `L` for LOOK, then open SYSTEM → REMOTE and tick **Allow remote devices**.
      The status line shows the port (47821) and whether Tailscale is up.
   4. Press **PUBLISH TO MY TAILNET** and confirm the dialog. It runs
      `tailscale serve --bg http://127.0.0.1:47821`, which reaches William's own devices only and is
      never Funnel. If Tailscale says HTTPS is off for the tailnet, turn on MagicDNS and HTTPS
      certificates in the Tailscale admin console and press it again.
   5. Press **PAIR A DEVICE** and scan the QR code with the iPhone camera within 5 minutes. Safari
      opens `https://<pc>.<tailnet>.ts.net/#pair=…` and pairs itself.
   6. In Safari, Share → Add to Home Screen gives a full-screen app.
   7. Check that the iPhone appears in the REMOTE device list. REVOKE removes it.
      `userData/remote-audit.log` records every call it makes.
   - **From a phone:**
     - no deleting (undo still works);
     - no desktop dialogs: they answer CONFIRM ON THE DESKTOP;
     - no settings, autostart or opening files on the PC.
   - **Fallbacks:**
     - Cloudflare Tunnel with Access (add the hostname to `remoteAllowedHosts` in settings.json);
     - today, with no setup: Parsec, RustDesk or Chrome Remote Desktop.
   - **Unverified:**
     - Safari on a real iPhone;
     - touch on real glass;
     - that `tailscale serve` passes the tailnet Host through. The origin check depends on it; if the
       socket is refused, look there first.

Still outstanding from earlier:

- **Component sprites are still 12 drawn placeholders.** `component.*` keys have no atlas entries.
- **The `@theme` colour-key swap is unimplemented**, so no sprite may use `@mask-dark`,
  `@mask-light` or `@signal`.
- **A tilesheet-CELL palette** — pick an arbitrary cell from a vendor sheet, not just a baked key.
