# 06 — Roadmap

Each milestone ends with something you can actually open and use. No milestone is "infrastructure only." Build them in order.

---

### 2026-10-03 1035 note (third away-mode pass the same day, PLAN level; confirms the 0835 note below, zero drift)

No mail on `to-hands`. Bash denied this pass too. Every phantom slate matched both earlier passes
today exactly: `root` 4/4, `financeos` 3/4, `scheduleos` 0/4, `minecraftos` 3/4, `gameos`/`storyos`/
`deductionos` 4/4. Nothing proposed, nothing edited beyond this note and the journal
(`codex/journal/away-2026-10-03-1035.md`). **Repeating the standing suggestion a third time:**
three same-day PLAN passes with an unchanged picture is spent usage — the next one should wait for
mail on `to-hands`, a phantom ticked/dismissed, or a changed handoff file, not a fixed interval.

### 2026-10-03 0835 note (second away-mode pass the same day, PLAN level; confirms the 08:37 note below)

Bash denied this pass (no `git log`/`git status`); repo state came from `Read`/`Glob` only. No mail
on `to-hands`. Every phantom slate matches the 08:37 pass exactly, including `ph_goobtropolis_configs`
that pass proposed (`minecraftos` now 3/4): `root` 4/4, `financeos` 3/4, `scheduleos` 0/4,
`minecraftos` 3/4, `gameos`/`storyos`/`deductionos` 4/4 — zero drift in the twenty minutes between
passes.

A `Glob` sweep for `*/README.md`, `*/CLAUDE.md` and `*/package.json` directly under `C:/dev` turned
up nothing not already in `codex/projects/`: the coverage-gap pattern that found real gaps on
2026-09-11, 2026-09-15, 2026-09-19, 2026-10-01 and this morning's 08:37 pass has, for the first time,
come up empty. Also checked: `scheduleos.md`'s "Next" item 1 (rewrite `habits.json` from William's
real 16-habit set) already has board presence — `f_habits`/F3 on the `scheduleos` room already points
at `private/schedule/reclaim/habits.json` — so there is nothing left for a phantom to add there; the
rewrite itself is agent data-entry work for a Hands-level session, not a board recommendation.

**Suggestion:** two away-mode PLAN passes landing twenty minutes apart with an identical picture is
the same spent-usage pattern the 2026-09-19/26/27 notes warned about for the Minecraft/GoobOS/GameOS
cluster, now showing up program-wide in one day. Nothing here needs another PLAN sweep until mail
lands on `to-hands`, a phantom is ticked or dismissed, or a handoff file changes.

### 2026-10-03 note (away-mode pass, PLAN level; adds to the 2026-10-01 note below)

No mail on `to-hands`. Every phantom slate matched the 2026-10-01 picture exactly — `root` 4/4
(`ph_bitrunners`, `ph_stackassembler`, `ph_story_universe_map`, `ph_jarvis_voice`, unticked since
2026-09-16/25), `financeos` 3/4, `scheduleos` 0/4, `minecraftos` 2/4 (before this pass), `gameos`/
`storyos`/`deductionos` 4/4 — no board edit by William since the last pass, so no re-sweep of those
repos was warranted per the standing skip advice.

**Real find this pass:** `codex/index.md` has cited `projects/goobtropolis.md` since before
2026-09-12 (the MinecraftOS projects list, line pointing at the Bloom.host SMP every mod in that
room targets), but the file itself never existed — the same "promised but unwritten" pattern the
index's own header warns about. Wrote `codex/projects/goobtropolis.md`: there is no local repo for
the server itself, only an exported config folder (`C:/dev/goobtropolis-configs`, four mod configs —
afkplus, chunky, doubledoors, ledger, styled-chat, universal-graves — mtime 2026-09-21) with zero
prior board or codex presence. `minecraftos` had 2/4 phantom slots open (`ph_latest_log`,
`ph_crash_reports`, both unticked since 2026-09-11) — used one: proposed `ph_goobtropolis_configs`
(store.folder), wired `reads` to the existing `p1_goobtropolis` node. That existing node is a
separate, older gap worth flagging again: it's a `service.process` pointing at
`C:/dev/GoobtropolisTest`, a local test-server checkout that still does not exist on this machine
(first noted in the 2026-09-11 handshake mail to the Face) — unrelated to the new phantom, not
touched this pass.

Not re-catalogued: `MagicTrainer`'s entry (written 2026-10-01) still names the same blocker —
v1.0.0 ready to ship, root board still 4/4 with no capacity for `ph_magictrainer`. No change there
to report.

### 2026-10-01 note (away-mode pass, PLAN level; adds to the 2026-09-30 note below)

Bash worked this pass (unlike most priors). No mail on `to-hands`. Re-checked `scheduleos` (still
0/4, no drift from 2026-09-30 — same facts, all already have nodes) and `financeos`/`root` (3/4 and
4/4, unticked, nothing new deserving the open slot) per the standing skip advice below; the
Minecraft/GoobOS/GameOS cluster was not re-swept.

**Real find this pass:** a plain `ls` of `C:/dev` (the Bash tool finally answering) turned up two
repos with zero codex presence — the coverage-gap pattern the 2026-09-11 pass first found and
later passes periodically re-run for:

- **`MagicTrainer`** (`C:/dev/MagicTrainer`) — a real, fully-built MTG deck visualizer/trainer
  (Tauri 2 + React 19), started 2026-09-24, **v1.0.0 tagged 2026-09-25** with a built MSI/NSIS
  installer sitting unshipped since then. All 14 of William's design questions were already
  "accept all"-resolved the same day. Written up: `codex/projects/magictrainer.md`. **No phantom
  proposed** — `root` is 4/4 (same four phantoms unticked since 2026-09-16/25) and this one
  deserves a slot more than at least one of the three bare-repo-coverage ones already there
  (`ph_bitrunners`, `ph_stackassembler`, `ph_story_universe_map`), since it is a *finished,
  shippable build*, not just a coverage gap. Flagged for William's decision rather than withdrawing
  one of his standing recommendations myself.
- **`goobtab`** — a four-file Minecraft datapack (`pack.mcmeta` description: "Goobtropolis playtime
  days/hours"), a small tab-list playtime tracker for the Goobtropolis SMP. Too small to warrant
  its own codex project file; noted here only (inferred: a utility for `projects/goobtropolis.md`,
  not independently tracked).

### 2026-09-30 note (away-mode pass, PLAN level; corrects the 2026-09-27 "skip ScheduleOS" standing note below)

No mail on `to-hands`. `board_list` now returns **seven** boards, not five: `scheduleos` exists as a
real room — it did not on 2026-09-27, when the prior pass's standing advice was "skip re-checking
ScheduleOS until a handoff changes." One has now changed substantially, which is exactly the signal
that note said should end the skip:

- **ScheduleOS Phase 6 is done, with William present, 2026-09-30**: every calendar retimezoned to
  Denver, Reclaim authenticated (32 tools), seven real October PBS shifts loaded with six-step prep
  chains (42 events) live on `Work – Prep Blocks`, streams turned into recurring calendar events with
  a shift-takes-priority rule applied automatically, his 16 real habits rebuilt in Reclaim, and a new
  `panel.calendar` built (K1 CALENDAR in the room, K1 THIS WEEK on root) — not yet seen on screen.
  `codex/projects/scheduleos.md` and `skynetos.md`'s "Next" section updated to match; see
  `scheduleos.md` "Next" for the three items still open (two William's, one a small agent data-entry
  task: rewriting `habits.json` from his real set).
- `scheduleos` phantom slate: 0/4, and correctly so — every real fact already has a built node on the
  new room (see above), nothing here deserves a phantom recommendation yet.
- Re-checked `financeos` (3/4, unticked since 2026-09-26 — `ph_rent_run`, `ph_rent_run_research`,
  `ph_aggregator_options`) and `root` (`ph_bitrunners`, `ph_stackassembler`, `ph_story_universe_map`,
  `ph_jarvis_voice`, unticked since 2026-09-16/25): no change, no new capacity, nothing new deserving
  a slot.
- The Minecraft/GoobOS/GameOS cluster (`minecraftos` 2/4, `gameos`/`storyos`/`deductionos` 4/4) was
  **not** re-swept this pass, per the standing skip note below — nothing suggested it had moved.
- **Revised suggestion:** the earlier blanket advice to skip re-checking FinanceOS/ScheduleOS no
  longer holds for ScheduleOS now that its room exists and is actively being built with William —
  future passes should check it each time until it stabilizes. FinanceOS is still genuinely
  blocked on William's own numbers (`ledger.json`) and the DataAnnotation/Prolific review emails, so
  the skip still applies there.

### 2026-09-27 note (away-mode pass, PLAN level; adds to the 2026-09-26 notes below)

No mail on `to-hands`. Checked every board's phantom slate (`board_list`: root, deductionos,
financeos, gameos, minecraftos, scheduleos, storyos) and found **no new capacity, no drift, and
nothing new deserving a proposal** — so this pass added zero phantoms:

- `root` 4/4 (`ph_bitrunners`, `ph_stackassembler`, `ph_story_universe_map`, `ph_jarvis_voice`, all
  unticked since 2026-09-16/25).
- `financeos` 3/4 (`ph_rent_run`, `ph_rent_run_research`, `ph_aggregator_options`, unticked since
  2026-09-26); one slot open but nothing on disk since the 09-26 pass deserves it — `selections.json`
  still shows Prolific and DataAnnotation both `applied`, waiting on emails that have not arrived.
- `scheduleos` 0/4, re-confirmed: `mcp-tools.md` still says "no session has authenticated to Reclaim
  yet", `pbs-shifts.json` is still `[]`, the timezone fix is still William's hands. Same picture as
  the 2026-09-26 16:13 check — third confirmation in a row of no change.
- `minecraftos` 2/4, `gameos`/`storyos`/`deductionos` 4/4 — unticked since 2026-09-11, per the
  standing "skip" note below; not re-swept this pass.

Also re-checked `BitRunners` and `StackAssembler` `.claude/handoff.md` directly (their tails looked
unfamiliar at first read, but both are append-only logs with newest-first ordering — the tail is
old 2026-07-01/07-02 history, not new work). Confirmed: still the same 2026-07-12 / 2026-08-12
top entries the codex already cites. No drift.

**Extending the standing suggestion below:** the Minecraft/GoobOS/GameOS cluster has now gone
unchanged across at least six away-mode passes (since 2026-09-11). FinanceOS and ScheduleOS have
now each shown zero change across three consecutive passes (2026-09-26 16:13, 2026-09-26 23:42,
2026-09-27) because both are genuinely blocked on William's own actions (Google Calendar timezone,
Reclaim browser login, Prolific/DataAnnotation review emails) rather than on agent work. Suggest
away-mode PLAN passes skip re-checking any of these boards until a phantom is ticked/dismissed, a
handoff file changes, or new mail lands on `to-hands` — a pass that finds the same picture a fourth
time is pure spent usage. The one place still worth checking each pass: mail on `to-hands`, since
that's the only channel that can hand this session new work.

## Board coverage gap found, not closed (away-mode pass, 2026-09-11 evening)

`board_list` returns only five boards: `root`, `deductionos`, `gameos`, `minecraftos`, `storyos`.
There is no `goobos` room (`board/goobos/room.board.json` does not exist), even though
`codex/index.md` lists four GoobOS projects with real codex entries — `bitrunners.md`,
`stackassembler.md`, `story-universe-map.md`, `wfp-site-ops.md`. Those repos currently have zero
board presence: no node, no phantom, nothing clickable. Building a room board is out of an
away-mode session's write bounds (codex/ and this file only) — it needs a real M2-style room
addition. Also found: two more codex entries were missing outright — `there-could-be-giants.md`
and `locibook.md` — now written (see index.md's coverage note), and `LociBook.md`'s index line had
been copy-pasted from Goobtropolis's description; fixed to describe the actual mod. All five
existing rooms already carry 4/4 phantom recommendations each — no capacity for new proposals
until William approves or dismisses some of the standing ones.

## Codex coverage gap found and closed (away-mode pass, 2026-09-11 afternoon)

Six repos under `C:/dev` had real, current CLAUDE.md/handoff state but zero presence in
`codex/index.md` or `codex/projects/` — meaning no JARVIS session had board visibility into them
at all: `BitRunners` (ASCII MMO, live prod deploys, a PR unmerged since 2026-07-12), `StackAssembler`
(MTG simulator, three-agent studio, Phase 3 engine un-built), `MCCamOp` and `Just1Nudge` (both
Goob Entertainment Fabric mods, already phantom-proposed into the `minecraftos` room by an earlier
pass today but never written up), `wfp-site-ops` (Webflow site ops, two unpublished page overhauls
on staging), and `story-universe-map` (an Obsidian plugin, with `obsidian-dev-vault` as its test
harness). All six now have `codex/projects/*.md` files and index entries. This was inferred from
each repo's own CLAUDE.md/handoff — verify against the repo before acting on a stale figure.

### 2026-09-26 note (away-mode pass, PLAN level; adds to the notes below)

Bash denied this pass too (no `git log`/`git status`); repo state came from `Read`/`Glob` on each
repo's own `CLAUDE.md`/handoff files. No mail on `to-hands`, nothing to undo/redo.

- **No drift, fifth pass in a row:** re-checked `BitRunners` and `StackAssembler` against their
  `.claude/handoff.md` directly (still 2026-07-12 / 2026-08-12), and `TimeServed`, `MCCamOp`,
  `LociBook`, `Just1Nudge`, `There Could Be Giants` against their codex entries — same picture as
  2026-09-19: no `handoff.md` yet in TimeServed/MCCamOp/LociBook, nothing else moved. The
  2026-09-19 suggestion stands and is repeated here: **skip PLAN-level away passes over the
  Minecraft/GoobOS/GameOS cluster** until a phantom is ticked or a handoff changes — a fifth
  no-op pass over the same ground is the cost this note warned about.
- **Where the real capacity is:** the `financeos` room (built 2026-09-23, Face's drop merged
  2026-09-25) had **0/4 phantoms** — the only board with open slots this pass. Verified
  `private/finance/research/` (216 options, top-picks.md, plan-30-day.json, sources.txt) and the
  Rent Run claude.ai artifact are both real and referenced from `codex/projects/rent-run.md`, but
  neither had board presence. Proposed `ph_rent_run` (link.url, the artifact) and
  `ph_rent_run_research` (store.folder, the research folder) on `financeos`, right of the LEDGER
  zone, both wired `reads`/`syncs` to `s1_ledger`.
- **Not board work, William's / a build session's:** FinanceOS Phase 2 (the interactive 60–90 min
  session — card issuer/APR/minimum, PBS schedule, Ross question) and Phase 4 (live SimpleFIN
  feed) per `codex/handoffs/financeos-scheduleos.md`; ScheduleOS Phase 5 (the room itself doesn't
  exist yet — `board/scheduleos/room.board.json` is not on disk, so no phantom can bind to it; a
  real M2-style room build is needed first, out of this pass's write bounds).

## Right now (updated 2026-09-15 evening by an away-mode JARVIS Prime pass — supersedes the 2026-09-13 note below)

**SkynetOS was running this time** — every `board_*`/`phantom_*`/`mailbox_*` MCP tool worked, unlike
the two prior away passes (2026-09-11 evening, 2026-09-12). No unread mail on `to-hands`.

Root board's phantom slate had gone to **0/4** (the `minecraftos` room grid work on 2026-09-15
turned two of its own phantoms — `ph_just1nudge`, `ph_mccamop` — into real nodes, and root had none
to begin with), so this pass had real capacity for the first time since 2026-09-11. Used three of
the four slots on the root board's own coverage gap, noted below since 2026-09-11 evening and never
closed: `bitrunners.md`, `stackassembler.md` and `story-universe-map.md` have real, current codex
entries but **no board presence anywhere**, because no `goobos` room exists to hold them and a room
addition is out of an away-mode session's write bounds. Since these are ordinary repos, not room
residents, they don't need the room — so this pass proposed `store.repo` phantoms for all three
directly on `root`, right of the existing `wfp-site-ops` node (S4), which already proves a bare repo
node works there with no room underneath it: `ph_bitrunners` (165,35), `ph_stackassembler` (165,75),
`ph_story_universe_map` (175,95). One root slot is still open. This does not close the `goobos` room
gap itself — that still needs a real M2-style addition — but it gets all three repos their first
board presence and click-through.

Checked `bitrunners.md` and `stackassembler.md` against each repo's own `.claude/handoff.md`
directly: **no drift**. BitRunners is still at the 2026-07-12 mega-batch-3 handoff (PR still
unmerged, migration 0019 still unapplied); StackAssembler is still at the 2026-08-12 data-build
handoff (Phase 3 engine still the named blocker). Neither codex entry needed an update.

### 2026-09-19 evening note (away-mode pass, PLAN level; adds to the 2026-09-15 note above)

Bash was denied this pass, so no `git log`/`git status` was read; repo state comes from file
listings and mtimes only (inferred). SkynetOS was running; no mail on `to-hands`.

- **Closed:** `codex/projects/time-served.md` written (repo `C:/dev/TimeServed`, v1.1.0 on 2026-09-13,
  no CLAUDE.md/handoff.md). It was listed in the index but had no file.
- **No new phantoms.** Slates: `root` 3/4 (the three GoobOS repos from 2026-09-15, still unticked),
  `minecraftos` 2/4 (`ph_latest_log`, `ph_crash_reports`, both from 2026-09-11), `gameos`,
  `storyos`, `deductionos` 4/4, all from 2026-09-11 and unactioned for eight days. Nothing new
  deserved a slot over those; the standing ones are the recommendation.
- **Found, not catalogued:** `C:/dev/Stream` holds one empty file (`apprentice_scroll.txt`), and
  `C:/dev/StreamerBot` is an installed Streamer.bot app (DLLs, WebView2 cache), not a repo. Inferred:
  William is setting up streaming. No codex entry written because there is nothing to track yet.
- **Sized next tasks** (each also in its project's "Next"): TimeServed and MCCamOp each need a
  `handoff.md` first (S, one short session each); MCCamOp v2.1 path-aware framing (L); everything
  under SkynetOS "Next" is still William-at-the-screen work, not agent work.

### 2026-09-19 17:20 note (second away-mode pass the same day, PLAN level)

Bash was denied again, so no `git log`/`git status` (repo state inferred from file listings). Found
**no change** since the 13:44 pass: same phantom slates (`root` 3/4, `minecraftos` 2/4, the other three
4/4), `C:/dev/Stream` still one empty file, no `handoff.md` yet in TimeServed, MCCamOp or LociBook. No
new phantoms and no codex edits: nothing new outranked the 11 standing recommendations. The
blocker is now William's decisions, not agent work; the list is in the 13:44 journal and the
1720 journal (`codex/journal/away-2026-09-19-1720.md`). Suggestion (inferred): if a third away pass
finds the same picture, the scheduler should skip PLAN-level away runs until a phantom is ticked or a
handoff changes, since each one spends usage to confirm nothing moved.

### 2026-09-13 note (superseded above, kept for the record)

**SkynetOS was not running again** (no control file at `%APPDATA%/SkynetOS/control.json`), same
blocker as the 2026-09-12 pass — every `board_*`/`phantom_*`/`mailbox_*` MCP tool refused. Two
away-mode passes in a row have landed with the program closed, so no phantom recommendations have
reached the board since 2026-09-11. If away-mode sessions are meant to leave board recommendations,
SkynetOS needs to be left running (or started on a schedule) before one begins — worth a decision
either way, not another silent no-op.

This pass otherwise audited the codex against each repo's real `CLAUDE.md`/handoff state (13
project files, plus `TheStalker`/`PaceKeeper`/`LociBook`/`MCCamOp`/`BitRunners`/`StackAssembler`/
`SkynetOS` itself read directly) and found **no drift** — every "Next" section already matches its
repo's current handoff, including `StackAssembler`'s and `BitRunners`' long multi-session handoffs,
which still top out at the same 2026-08-12 / 2026-07-12 entries the codex already cites. The prior
two away-mode passes (2026-09-11 evening, 2026-09-12) already did this coverage work; there was
nothing left this pass to close.

### 2026-09-12 note (superseded above, kept for the record)

Per `handoff.md` at the repo root, a second layer of uncommitted, unverified work has landed on
top of the 2026-09-11 overnight batch: **voice control, two-hand gesture cursor/zoom, and THE
MATRIX**, all built end to end and green on `npm run verify` (97 files, 1,529 tests), and **none
of it tried with a real microphone or camera yet**. The gesture recognizer itself was rebuilt from
geometry up the session before that (pose model, hand synthesis, MediaPipe GestureRecognizer) —
also unseen on camera. Nothing has been committed; William has not asked.

The single highest-priority next action is still the same shape as 2026-09-11's note, just with
more in the queue: restart SkynetOS and put both the new voice/gesture/MATRIX work (handoff.md
"What is next" items 0 and 0-earlier) and the still-unrun overnight-batch click-through list
(items 1a–1h: quick chat to the Face, the Fable countdown, the drive auditor, PROMPT → NODE,
Summon JARVIS, the corner prompt, phantoms, the journal note) in front of William. Until that
happens, treat all of it as "built, unverified" rather than "done."

Also still open: proving standing orders end-to-end with the Face's first real `standing:` brief
(item 2), William's five logged overhauls in "Known issues and requested overhauls" below
(rotation, node-editor layout, fonts, usage calibration, cross-machine usage ledger), and Remote
(M9) on a real iPhone (never tried outside this machine).

**This away-mode pass could not check any of it against the live board:** SkynetOS was not
running (no control file at `%APPDATA%/SkynetOS/control.json`), so every `board_*`/`phantom_*`/
`mailbox_*` MCP tool refused. No phantom recommendations were proposed this pass as a result —
see `codex/journal/away-2026-09-12-2128.md`.

### 2026-09-11 note (superseded above, kept for the record)

The single highest-priority next action was restarting SkynetOS and watching three overnight
batches of uncommitted work (forks A–Q) actually run on William's screen for the first time.
`npm run verify` was green (1,233 tests) and the work had been smoke-shot, but almost none of it
had been clicked by a human yet.

---

## M0 — Skeleton (½ day)
Electron + Vite + React + TS, `contextIsolation` on, typed IPC bridge, Pixi canvas mounted with nearest-neighbour and integer zoom, `npm run verify` wired (tsc + vitest + both validators), electron-builder NSIS config.

**Exit:** a window opens showing a tiled solder-mask substrate at 3x zoom, WASD pans it, nothing shimmers.

## M1 — Board data → pixels (2 days)
JSON Schema, board loader/validator, `BoardGraph`, static rendering of `store.repo`, `store.folder`, `note.silk`, and hand-routed traces. Selection, inspector panel, breadcrumb.

**Exit:** `board/root.board.json` renders as a recognizable board. Clicking a repo node opens that folder in Explorer. A malformed board file shows a clear error, not a blank screen.

## M2 — Rooms + auto-routing + procedural substrate (2 days) — **DONE 2026-09-09**
`drive.room` nodes, iris transition, nested boards, back navigation, minimap. Orthogonal trace auto-router. Seeded procedural substrate per room.

**Exit:** click MinecraftOS, descend, see four mod clusters, press Esc, come back. Traces route themselves when a node moves.

**Met.** Evidence from `npm run smoke`, which drives the built app with real key events:

```
descend: "SKYNETOS" -> "SKYNETOS/MINECRAFTOS"   changed=true
room HUD: 27 NODES / 15 TRACES / ROUTED 15
ascend:  back to "SKYNETOS"                     returned=true
[router] 7 auto-routed, 0 fell back      <- root
[router] 15 auto-routed, 0 fell back     <- inside MinecraftOS
[router] 7 auto-routed, 0 fell back      <- back at root
node drag moved 1 node(s): u1_jarvis 28,17 -> 32,19
[router] 7 auto-routed, 0 fell back      <- re-routed BECAUSE the node moved
```

All four mod clusters render as silkscreen zones. Zero traces fell back to the direct run on any
of the five boards. `test/router.test.ts` additionally proves, on the real board data, that no
routed trace cuts through a component it does not terminate at.

Done in this milestone: room descent and return with a navigation stack, the 8-step iris wipe,
per-room theming of the board *and* the DOM chrome, the A* auto-router with a turn penalty, and
the minimap with a live viewport box and click-to-jump.

Deliberately not done, and not blocking: **trace bundling** with a ribbon clamp (docs/01), and the
**palette-swap shader** (docs/02 Theme keys) — the shader has nothing to swap until an atlas
exists, so it belongs with M5's art rather than here. Room themes currently reach the board by
recolouring at build time, which is correct for geometry and placeholders.

## M3 — Agent nodes and real sessions (3 days) — **DONE 2026-09-09**, one part deferred
`agent.code`, SessionManager with all four launch modes, session id capture + `--resume`, session dock, `service.process`, embedded xterm tab.

**Exit:** clicking the `CC-STALKER` chip opens Windows Terminal in `C:/dev/TheStalker` with Claude Code resumed on that project's prior conversation. Closing and reclicking resumes the same session.

**Met, with one honest gap.** The resume mechanism is proved end to end through the real database:

```
first launch:  resumed=false  conversation=51059e3a  flag=--session-id
second launch: resumed=true   conversation=51059e3a  flag=--resume
SAME CONVERSATION ACROSS LAUNCHES: true
```

and on the NEXT run of the app, from a cold start, the first launch already read `51059e3a` back
out of `skynet.db` and used `--resume`. That is exactly "closing and reclicking resumes the same
session", across a full process restart.

The IPC guards were exercised through the real bridge too: `session:start` on a non-agent node,
`service:start` on a non-service node, and `resumeCommand` before any launch all refuse with a
legible message rather than throwing.

**What is NOT automated:** actually spawning `claude`. Doing that in a headless test would open a
terminal and start a real conversation in a real repo, consuming usage for a test nobody asked
for. The argument list, quoting, working directory and Windows-Terminal fallback are unit-tested
exactly (`test/sessions.test.ts`), and the spawn itself is three lines. **Clicking the chip once
is the remaining verification, and it is William's to make.**

**Deferred:** the `embedded` xterm tab. `node-pty` has no working node-gyp build on this machine,
nothing imports it, and the exit criterion does not need it — `popout` is the mode that matters.
The chip refuses `embedded` with a legible message rather than silently opening a popout instead.

## M4 — Files, artifacts, drag-out (2 days)
`file.document`, `file.exe`, `file.artifact` with glob resolution, chokidar watchers, `webContents.startDrag`, staleness detection, drop-in ingestion from Explorer.

**Exit:** the Stalker artifact cartridge shows `thestalker-0.4.2.jar · 11m ago`, and you can drag it from SkynetOS straight into your mods folder. The novel node opens the manuscript in Word.

## M5 — Life: telemetry, heat, animation, characters (3 days)
TelemetryBus, heat model, glow steps, packet sprites, the four agent states, occupant characters, activity feed, alerts + buzzer, PSU monitor.

**Exit:** run an agent for ten minutes; its chip warms to ~38°C SIM, its traces glow one step brighter, packets flow to the artifact when the jar rebuilds, and the room cools down over the next quarter hour.

## M6 — Edit Board mode (3 days)
Palette drawer, placement with snap + collision, node wizard with target verification, trace drawing, undo/redo, JSON diff preview, snapshots, templates, first-run repo scan, health check.

**Exit:** you add a fifth mod cluster — agent + repo + artifact + traces + CurseForge link — in under a minute, without touching a text editor, and the resulting git diff is clean and readable.

## M7 — JARVIS (4 days)
`skynet-mcp` server with the full tool surface, Codex scaffolding + FTS index, embedded claude.ai WebContentsView on `persist:jarvis`, headless Hands runner, board-diff approval flow, agent-edit policy per room.

**Exit:** you tell JARVIS "add a node for the TimeServed jar and wire it to its agent" and a reviewable diff appears; you accept; the board updates. `codex_search` returns real hits from your project files.

## M8 — Supervision + scheduling (2 days) — **scheduling part-done 2026-09-11**
`task.scheduled` nodes, the supervision loop with its hard limits, nightly journal + handoff generation, Windows toasts.

**Done:**
- a scheduler (`src/main/services/scheduler.ts`, rules in `packages/shared/schedule.ts`,
  five-field cron in `packages/shared/cron.ts`) that runs `task.scheduled` nodes while the app is
  open;
- catch-up once within `catchUpHours`, one run per slot, a daily cap, never elevated;
- `agent.run`, a fresh session on an agent with a brief;
- `journal.write`, the Obsidian journal note;
- MORNING MAINTENANCE (8 am: JARVIS Prime tidies, keeps this roadmap and advances one item);
- the nightly journal at 22:00;
- [x] **Windows toasts, 2026-09-23** (morning maintenance): `{"type":"notify","message":"…"}` shows an
  Electron `Notification` titled with the task's designator and name, so the deductionos `notify`
  task (T1, 19:00) now does what it says. Rules in `resolveTaskAction`/`planDispatch`, held by
  `test/schedule.test.ts` "reads a notify action as its message" and "shows a notify action as a
  toast". The toast itself is main-process (`scheduler.ts`) and **has not been seen on screen**: a
  dev copy borrows electron.exe's App User Model ID, which Windows may still file oddly. Press Run
  now on T1 after a restart to check.

**Not done:**
- the supervision loop over live sessions (docs/04), which needs headless `claude -p` sessions;
- `jarvis.headless` actions, kept but inert;
- the toast's `level` (`info` on T1) is read by nothing yet; an in-app copy in the notification
  centre would need a main→renderer push channel, which is a preload change and a restart.

**Exit:** leave two agents running, go to work, come back to a journal entry describing what each did, what JARVIS unblocked, and what needs your decision.

## M9 — Remote: SkynetOS from the iPhone — **R1–R3 built 2026-09-11, off by default; not yet tried on a real phone**
William: "remotely operate the program via my iphone as long as both my desktop and iphone has an internet connection and the program is already running." Then: "remotely controllable via a mac desktop, windows desktop, ipad, or iphone … would need to be able to remotely control a lot of the program's elements." Design and security model: `docs/08-REMOTE.md`.

**Built:**
- The desktop renderer itself, served to any browser by `remote-server.ts` (bound to 127.0.0.1) with a `window.skynet` shim that forwards every call over a WebSocket. Every device gets the whole board, not a cut-down view.
- The `REMOTE_METHODS` allowlist and the `remote` actor. Destructive commands and desktop dialogs are refused from a remote device.
- Pairing: a one-time code and QR code, valid for 5 minutes. Devices get 256-bit tokens, stored hashed and revocable. Repeated failures turn remote off. An audit log records every call.
- LOOK → REMOTE on the desktop: the switch, PAIR A DEVICE, the device list, and Tailscale detection with PUBLISH TO MY TAILNET behind a confirm.
- The compact layout for phones and tablets: bottom sheets, 44 px touch targets and safe areas. On the board: pinch to zoom, long-press for the menu, double-tap to open.

**Verified:**
- Unit tests and an integration test.
- The smoke run renders the board over the bridge in phone-sized and tablet-sized windows.

**State of this PC, read 2026-09-21:** Tailscale is installed and signed in, MagicDNS and HTTPS
certificates are on, William's iPhone is on the tailnet and
online, and nothing is published yet (`tailscale serve status`: no config). What is left is three
presses in LOOK → SYSTEM → REMOTE, all user-only: Allow remote devices, PUBLISH TO MY TAILNET, PAIR A
DEVICE. An iPad needs the Tailscale app and the same sign-in first.

**Sessions on the phone (2026-09-21):** an `agent.code` node set to "Reachable from my phone"
(`remoteControl`) starts with Claude Code's Remote Control, so the Claude app reads and drives it.
That covers R4's purpose without SkynetOS streaming a terminal. Built and unit-tested; not tried.

**The keyboard-side guide (2026-09-23):** `docs/guides/remote-setup-tailscale.md`, every button and
status line quoted from the code, section 0 the state of this PC that day. **Fixed the same day:** a
bad device token now counts toward the ten-in-ten-minutes lockout, as docs/07 and docs/08 always
said (`remote-server.ts`, `test/remote-server.test.ts` "turns remote off after ten wrong tokens in a
row"). Security path: William's eye wanted before it is relied on.

**Not yet:**
- A real iPhone over Tailscale.
- R4 as designed (sessions streamed to the phone by SkynetOS itself).
- R5 (a native wrapper).
- Deleting from the phone.
- The REMOTE panel in the Settings panel (`Ctrl+,`), which today shows System without it
  (`BoardLook.tsx:265`, `SettingsPanel.tsx:98`); and a token handoff for an iOS Home Screen web app,
  whose localStorage is separate from Safari's, so the icon will most likely ask to pair a second
  time (predicted, unverified).

**Exit:** on mobile data, summon JARVIS onto a node from the phone, watch the terminal open on the desktop, and read the away report while it works.

---

## Known issues and requested overhauls (logged 2026-09-11)

From William, in his words where it matters. Not scheduled yet; each one needs a slice of its own.

1. **The rotation widget does not rotate visual components.** The quarter-turn control in the node
   editor rotates `decor.part` atlas sprites and baked backdrops, but a component's drawn package
   (chip, drive, cartridge…) ignores it. Either rotate the placeholder art in `component-art.ts`
   (a pixel permutation, so exact) or hide the control on kinds it cannot affect. Hiding is the
   cheap honest fix; rotating is the real one.
   - [x] **Hidden on every kind it cannot turn** (2026-09-15). The control was only ever offered
     on `decor.part` and `decor.image` (`6bc6beb`); `test/node-fields.test.ts` "offers the rotation
     control only on kinds whose pixels it turns" now holds it there for every kind.
   - [ ] Rotating the component packages themselves, in `component-art.ts`.
2. **The node properties panel needs an intuitive, simpler layout.** "More elements need to be
   nested in dropdowns that have section headers so that the user can more quickly open a
   dropdown to navigate to a section." First pass done 2026-09-11: the editor groups its fields
   into collapsible sections (Binding, Session, Appearance, Text, Effects). Still wanted: fewer
   fields visible by default, and a search.
3. **More text styles, fonts and sizes.** "I want more font options and sizes — you can use the
   fonts in my TruthQuestRetro game." Board silkscreen is Departure Mono at 11/22 only, because
   only its exact sizes are pixel-clean. Each added font needs its own exact sizes found, a
   `font` field with a per-font size list, and a licence check even for William's own game assets.
   Check `C:/dev/TruthQuestRetro/content/` for the pixel fonts before choosing.
4. **Usage calibration.** "If it can be calibrated it should show an indicator (calibrate usage
   monitor) and the user can input information the program needs." First pass done 2026-09-11:
   see docs/DECISIONS.md for what the calibration takes and what it still cannot know.
   - [x] **Weekly pools** (2026-09-27): plan fixed at Max 20x, both weekly caps (ALL, FABLE) from
     William's claude.ai/usage readings, reset Monday 20:00 America/Denver, carried forward by local
     usage between readings. `packages/shared/usage-week.ts`; DECISIONS 2026-09-27. Not yet seen
     on screen: the running instance predates it.
5. **Usage across machines.** Claude's limits are per ACCOUNT; each SkynetOS sees only its own
   machine's transcripts. On 2026-09-11 the one recorded five-hour limit hit (2026-09-08) had no
   local usage in its window at all: the work that reached it ran on another desktop. Every meter
   figure is this machine's share. The fix is a small per-machine ledger of hourly weighted totals
   that the other machines read and add in. The repo is the obvious transport, but it is public,
   so the ledger should go somewhere private (a synced folder William chooses), not `codex/`.
6. **Away (sleep) mode.** Built 2026-09-11. It is not yet seen on screen, and no real away run has
   been started: a run spends usage. What remains:
   - watch one real `plan` run end to end;
   - check that the `Edit(SkynetOS/codex/**)` allow rules match on Windows paths as intended;
   - decide whether away should also pause couriers and effects;
   - let the report open the journal note in Obsidian.
   See docs/DECISIONS.md "Away mode".

Found by morning maintenance, not fixed (2026-09-15):

7. **FIXED 2026-09-26** (performance pass, fork K): `useChromeLayout` measures on ResizeObserver,
   MutationObserver and store changes, coalesced to one rAF; the layout audit ran 58 states with 0
   overlaps and 0 off-screen after the change. As logged:
   **The chrome re-measures itself every 400 ms** (`src/renderer/ui/useChromeLayout.ts`, the
   `setInterval(soon, 400)`). Each tick reads `scrollWidth` on the HUD and help, which forces a
   layout, and `samePlan` then discards the result almost every time. A `ResizeObserver` on the
   breadcrumb, HUD and help, plus the existing `resize` listener, would do the same work only when
   something changed. Small, but it touches the planner every panel depends on, so it wants a
   layout-audit run (`npm run smoke:shots`) beside it, not an unattended pass.
8. **Exports nobody imports** in `packages/shared/`: `MAX_LOOKBACK_MS` (cron.ts), `FACE_BRIEF_REL`
   (face-brief.ts), `FRAME_BLURB` (frames.ts), `MATRIX_KINDS` and `hashString` (matrix.ts),
   `FABLE_MODEL` and `OPUS_MODEL` (model-availability.ts), `OBSIDIAN_TAG` and `styleTag`
   (obsidian.ts), `TILE_MIN_PX` and `clampLookNumber` (look.ts), `angleBetween` and `DEFAULT_HFOV`
   (hand-geometry.ts), `AVATAR_DOCK_GAP` and `SPEAKING_WINDOW_MS` (avatar-window.ts). Some are used
   inside their own file and only the `export` is spare; some may be dead. Each needs a reader to
   say which before it goes, and `ema` (adaptive.ts) went on 2026-09-15 as the one that was plainly
   dead.
   - [x] **Each one read, 2026-09-19.** Fourteen of the fifteen are live inside their own file, and
     several are the default of an exported function's parameter (`AVATAR_DOCK_GAP`,
     `SPEAKING_WINDOW_MS`, `FACE_BRIEF_REL`, `DEFAULT_HFOV`), so the `export` is an honest part of
     the API and stays. The fifteenth, `FRAME_BLURB`, had no reader at all: it was written "for the
     editor's tooltip" and the editor never showed it. It does now (`optionHelp` in
     `packages/shared/node-fields.ts`, held by `test/node-fields.test.ts` "says what each frame
     does"). Evidence: a word-boundary count of every `export` in `packages/shared/` across
     `packages/`, `src/`, `test/` and `tools/`, 556 names.
   - [x] **`REMOTE_DEFAULT_PORT` has its reader, 2026-09-19.** The same count found three names
     the 2026-09-15 list missed, declared and never mentioned again. This one was the port 47821
     written twice, once as the constant and once as a literal in `src/main/services/settings.ts`,
     which now imports it. `npm run verify` green.
   - [ ] **Two left, each William's call:** `isChannel` (`packages/shared/ipc.ts:942`), the unused
     sibling of `isAgentMethod` and `isRemoteMethod`; and `FEATURE_NAMES`
     (`packages/shared/pose-model.ts:62`), six labels for the pose feature vector that nothing
     prints. The gesture monitor could show them beside the probabilities, or they go.

Found by morning maintenance, not fixed (2026-09-19):

9. **FIXED 2026-09-21** (`DeviceStore.revoke` never throws and records `lastRevokeError`;
   `revokeDevice` disconnects in a `finally` and reports the unsaved list; the REMOTE panel shows it;
   `test/remote-devices.test.ts` "revokes in memory even when the list cannot be saved"). As logged:
   **A failed save leaves a revoked device half revoked** (`src/main/services/remote.ts:214`,
   `revokeDevice`, with `DeviceStore.revoke` in `src/main/services/remote-devices.ts:77`). The store
   drops the device from memory, then writes the file; if the write throws, `revokeDevice` throws
   before `server?.disconnect(id)`. The device's open socket stays up, and because
   `remote-devices.json` still lists it, its token works again after the next restart. The fix is
   small (disconnect first, and restore the in-memory list or report when the write fails), but it
   is the security path of docs/07 "Remote devices", so it wants William's eye and a test in
   `test/remote-devices.test.ts`, not an unattended edit. Since 2026-09-19 the panel at least says
   so when the call rejects, where before it said nothing.
10. **No renderer component can be unit-tested.** `vitest.config.ts` runs `environment: 'node'`
    and there is no DOM library in the repo, so a fix inside a `.tsx` handler (the REMOTE panel's
    on 2026-09-19, the drag badges' rAF placement on 2026-09-15) is proved only by typecheck and by
    eye. Adding jsdom or happy-dom is a new dependency, which a maintenance run may not add. Until
    then the rule that has worked: move the logic into a pure helper in `packages/shared/` or
    beside the component, and test that.

Found by morning maintenance, not fixed (2026-09-23). All renderer, so none has a unit test (10):

11. **FIXED 2026-09-26** (morning maintenance): `mail` starts `null`, `refresh` keeps a failed read
    as `readError`, and the list shows READING codex/mailbox/…, then COULD NOT READ codex/mailbox/
    with the reason and how to retry, before it ever says NOTHING WAITING; the gesture catalogue got
    the same two states in place of "No gestures yet." while `library` was still `null`. No test
    (renderer, item 10); `npm run verify` green. As logged: **The mailbox says "NOTHING WAITING."
    before it has read anything, and when the read fails**
    (`src/renderer/ui/Mailbox.tsx`, `refresh` at line 34, the list at line 136). `mail` starts as
    `[]` and `refresh` has no catch. Start it `null`, keep the failure, and render READING… or
    COULD NOT READ codex/mailbox/ before the empty message. Same shape in
    `src/renderer/ui/GestureCatalogue.tsx` line 192: "No gestures yet." while `library` is still
    `null`, though built-in gestures always exist.
12. **FIXED 2026-09-26** (`Mailbox.tsx` `copy`, the `AboutBox` shape: a clipboard write that throws
    now toasts COULD NOT REACH THE CLIPBOARD and names the file to copy by hand). As logged:
    **"Copy for the Face" has no failure path** (`Mailbox.tsx` line 73). A clipboard write that
    throws is uncaught and the panel says nothing. `AboutBox.tsx` lines 71–78 already handle the
    same call; copy that.
13. **FIXED 2026-09-26** (UX pass, fork M): on `ok:false` the inputs reset from `status` and the
    toast says the old values are back. As logged: **A failed away-mode save leaves the typed
    value on screen** (`src/renderer/ui/AwayScreen.tsx` lines 331–334). On `ok: false` the After
    minutes and Model inputs keep what was typed, so it looks saved.
14. **FIXED 2026-09-26** (`chipTitle` in `packages/shared/ui-copy.ts`, `test/ui-copy.test.ts`). As
    logged: **The MANUAL chip's tooltip drops its instruction when manual control has failed**
    (`src/renderer/App.tsx` lines 466–474).
15. **FIXED 2026-09-26** (`failureLine` in `packages/shared/ui-copy.ts`; all six sites plus
    `FableCores.tsx:84`, which the list missed). As logged: **Bare fallbacks.** `'COULD NOT SAVE'`,
    `'could not stop'`, `'NO CODE'` appear when `result.error` is missing: `useBoardStore.ts` 844
    and 857, `GestureCatalogue.tsx` 107, `PlanDialog.tsx` 56, `RemotePanel.tsx` 74,
    `DragBadges.tsx` 138.
    The same pass gave every panel one title strip (`PanelHead.tsx`), one status box
    (`StateBox.tsx`), a 2 px signal focus ring on every control, and `prefers-reduced-motion` for
    the chrome. Left for another pass: the explorer window's own Win-3.1 strip, the vision-train
    wizard, and a control-by-control tooltip audit.
16. **FIXED 2026-09-26** (morning maintenance's roadmap step: the five words changed, nothing else;
    `npm run verify` green, 113 files, 1,751 tests). The `suffixSize()` ternary that returns 11 both
    ways is left as it is: it is behaviour, and the header comment above it explains the choice.
    As logged: **Five comments name things that do not exist** (found 2026-09-23, after the run's
    bound; each a one-word fix): `src/main/services/shell-opener.ts:279` says `trusted()`, the function is
    `trustedByUser()`; `packages/shared/vision.ts:7` says `src/renderer/vision.tsx`, the file is
    `vision.ts`; `src/main/services/watchers.ts:46` says `test/watchers.test.ts`, the tests are in
    `test/artifacts.test.ts`; `packages/shared/room-title.ts:18` says `SUFFIX_SIZE`, it is
    `suffixSize()`, whose ternary at line 48 returns 11 both ways; `packages/shared/usage.ts:20` says
    `remainingTime`, the field is `remainingHours`.
17. **FIXED 2026-09-26** (`packages/shared/id-slug.ts` `idSlug`, imported by all three;
    `normaliseRoot` in `settings.ts` is now `normalisePath` under its old name, and
    `session-manager.ts` no longer pre-replaces the backslashes it was about to replace. Test:
    `test/id-slug.test.ts`, 4 cases, the last holding that a phantom id and a node id are built from
    the same slug). As logged: **The same helper three times.** The id slug
    (`name.toLowerCase().replace(/[^a-z0-9]+/g, '_')…`)
    is in `packages/shared/phantoms.ts:177`, `src/main/services/ingest.ts:32` and
    `src/main/services/node-factory.ts:63`; and `normaliseRoot` (`settings.ts:430`) has the same body
    as `normalisePath` (`packages/shared/usage.ts:290`), with `session-manager.ts:95` replacing
    backslashes once more before calling it. One export each, imported by the rest.
18. **Exports "for tests" that no test uses**, and eight more with no reader at all, in
    `src/main/services/`: `resetHistory` (command-bus.ts:513), `clearDispatchHistory`
    (mail-dispatch.ts:183), `clearWhichCache` (which.ts:73), `smokeServerCount` (remote.ts:287);
    then `chatWindowOpen`, `conversationMtime`, `sessionsForNode`, `reloadGestureStore`,
    `listArchive`, `serviceFor`, `briefingActive`, `reloadSettings`. Removing code is William's
    call (docs/07); the alternative is the test each comment promises. Also `test/layout.test.ts:74`
    and `:82` return silently when a MinecraftOS node is missing, so a board edit could leave them
    asserting nothing; `expect(zone).toBeDefined()` would hold them.
    - [x] **The two layout tests now fail when their node is gone** (2026-09-26): each `return`
      became a `throw` that names the node. The twelve exports are still William's call.
    - [x] **`clearWhichCache` has the test its comment promised** (2026-10-03, morning
      maintenance's roadmap step): `test/which.test.ts`, 6 cases against real directories on a PATH
      the test sets and puts back. It is also the first test `which()` itself has had: any case,
      first PATH directory wins, an unreadable or empty entry is skipped, a quoted entry is read, a
      miss is null, and a remembered miss stands until `clearWhichCache()`. `npm run verify` green,
      154 files, 2,387 tests. Eleven exports left, still William's call.

Found by morning maintenance, not fixed (2026-09-26):

19. **`test/watch-plan.test.ts` "survives `gradlew clean`" tripped its 8 s deadline once in six lone
    runs** of `npm run verify` this morning (`reasons` was still `[]` at line 151; the rerun passed
    in 3.1 s). The handoff's landmine says it fails only when three verifies run at once; it does not.
    The wait is real filesystem time on a watcher, so the fix is either a longer deadline for that one
    step or a wait on the re-plan event rather than a poll. Not loosened here.
    - 2026-10-03: no trip in six lone runs of `npm run verify` that day. Still open; six clean
      runs do not settle a one-in-six fault.

Found by morning maintenance (2026-10-03):

20. **FIXED 2026-10-03.** `src/renderer/ui/useVisibleInterval.ts` was written in the 2026-09-26
    audit to stop the panels polling in a minimised or hidden window, and nothing imported it: every
    poll its header listed still ran unseen. Now used by `UsageMeter.tsx` (20 s, a scan of every
    conversation file), `FinanceBlock.tsx` and `ScheduleBlock.tsx` (30 s) and `RemotePanel.tsx`
    (4 s); each still reads once on mount, and once at the moment the window is shown again. The
    hook's behaviour is now `startVisibleInterval`, a plain function, held by
    `test/visible-interval.test.ts` (6 cases, fake timers). Not seen on screen.
21. **FIXED 2026-10-03.** `src/renderer/ui/UsageMeter.tsx`: a `usage:summary` call that REJECTED
    (main threw, or a phone's socket dropped) left no meter and no word, with an unhandled
    rejection. Before the first good read it now shows USAGE with the reason and IT TRIES AGAIN
    EVERY 20 S. After a good read a failed poll keeps the last figures. No test (renderer, item 10);
    `npm run verify` green. Not seen on screen.
22. **Four more timers run while the window is hidden.** `src/renderer/App.tsx:206`
    (`refreshUsageRoutes` every 30 s: a second scan of every conversation file, feeding couriers
    nobody can see), `src/renderer/ui/FableCores.tsx:64` (15 s), `src/renderer/ui/CalendarBlock.tsx:43`
    (60 s) and `src/renderer/ui/JarvisDock.tsx:93` (the quote, every 24 s). Each is a one-line move
    to `useVisibleInterval`. App.tsx first: it is the costly one.
23. **Reads with no failure path.** `src/renderer/ui/CalendarBlock.tsx:55` says COULD NOT READ THE
    CALENDAR and the reason, but reads only once, so it stays wrong until main pushes or the
    inspector is reopened, and does not say so. `src/renderer/ui/AwayScreen.tsx:205`, `:239` and
    `:323` and `src/renderer/ui/FableCores.tsx:59` call `.then` with no `.catch`: a rejection is
    unhandled and the panel shows nothing.
24. **FIXED 2026-10-03.** `test/explorer.test.ts` "refuses a junction whose real path leaves the
    root" returned silently when no junction could be made, so it could pass on nothing. It now
    calls `ctx.skip()`, and such a machine reports 1 skipped rather than 1 passed. On this PC the
    junction is made and the test runs (16 passed, 0 skipped); the skip path itself was read in the
    installed vitest 2.1.9 runner, not run.

---

## M10 — The installed program — **first installer built 2026-09-21, not yet installed by William**
William: "building skynetOS into an Exe / self contained program I can pin to my taskbar ... ensure
the workflow for updates to the program are also put into place." Design and workflow:
`docs/09-RELEASE.md`. Security rows: docs/07 "Program updates".

**Built:**
- The program and the data are separate. An install never reads boards from its own folder; its
  home is the repo on a machine that has it (`packages/shared/home.ts`, `services/home.ts`).
- `npm run pack`, `dist`, `release`, `install:local`, `release:publish`. A pixel icon drawn by
  `tools/make-icon.mjs`. `build-info.json` in every install. `release/SkynetOS-0.1.0-x64.exe`.
- Updates from GitHub Releases through electron-updater, installed on close, per user, no
  administrator prompt. ABOUT shows the build, the data home and the update state.
- Start with Windows points at the exe when pressed in the installed copy.
- Manual control's MediaPipe files ship as program resources, and the vision page is served out
  of `app.asar`.

**Verified:** the packed exe, through the smoke harness, beside a live dev copy: home
`C:/dev/SkynetOS (built-from)`, all five boards, the full screenshot set.

**Not yet:**
- William running the installer, pinning it, and reading ABOUT.
- An update over an older install; an update from a real GitHub release (`npm run release:publish`
  is William's to run).
- Voice and manual control from the installed copy.
- Code signing. Until then SmartScreen warns once, and updates are checked by hash, not publisher.

**Exit:** SkynetOS on the taskbar; `npm run release` then one command updates it; the other desktop
updates itself from a published release; no board edit is ever lost to an update.

## M11 — FinanceOS — **room and ledger backend built 2026-09-23, no real numbers yet**
William: "a new OS room called FinanceOS, within which I will link the websites for my financial
institutions … a finance monitoring system that shows … meters that depict my bank balances and
credit card bill, things like spending and earning rate, critical messages like bills unpaid, and …
a location for me to work with you to develop ways to make money and curb my debt which is growing."

- [x] **FinanceOS room, ledger model, report tool and inspector meters** (2026-09-23;
  `test/finance.test.ts` 32 cases, `board/financeos/room.board.json` 27 nodes, D5 on root). Every
  figure comes from `private/finance/report.json`; nothing reads a bank. The room's theme is
  graphite with a cyan signal (`palette.ts`, docs/02). Not seen on screen.
- [ ] **A `monitor.finance` node kind** that draws the account meters on the board face, as
  `monitor.system` draws the PSU. The inspector block on the LEDGER node (`FinanceBlock.tsx`) is
  the interim, and is untested (item 10).
- [ ] **Live data.** Plaid or another aggregator is a paid dependency and a credential store; CSV
  export into `private/finance/imports/` is the chosen path until William asks otherwise. The
  institution links J1–J4 are provisional until he fills them; the mail survey's candidates are in
  `private/finance/institutions.md`.
- [ ] **William's first numbers:** copy `ledger.template.json` to `ledger.json`, replace every
  number, `npm run finance:report`, select LEDGER. Then tick Enabled on T1 (weekly review, Sunday
  18:00) and T2 (BILLS DUE toast, Monday 09:00) when wanted.

**Exit:** open FinanceOS and know, without clicking, what is due this week, what is owed, and
whether the month is running ahead or behind.

## M12 — Mail: one hub, an urgency scale, a daily digest — **designed 2026-09-23, nothing scheduled yet**
William: "connect you to read and manage my email inboxes … sort through all past emails … categorize
incoming emails and create an urgency scale … an all-around inbox I can link all accounts to."
Design: `docs/10-EMAIL.md` (Gmail as the hub, the other accounts forwarded in). Rules and the scale:
`codex/briefs/email-triage.md` (P0 NOW · P1 THIS WEEK · P2 LATER · P3 NOISE; nine categories; label
and digest unattended, everything else his click).

**Done 2026-09-23:** a read-only survey of the Gmail inbox (in `private/email/`, never in the repo):
about 10,000 threads, read to zero, roughly nine tenths promotions and notifications, 1 P0, 11 P1 and
5 P2 items found; the financial senders it reveals, for the FinanceOS room.

**Blocked, William's side, in order:**
1. Re-authorise the Gmail connector with the modify scope (docs/10 step 8); today `create_label`
   answers "Insufficient scope", so no label exists and the 26-thread plan in `private/email/` waits.
2. Forward the hotmail account (and any other) into Gmail (docs/10 steps 1–7).
3. Confirm that a session SkynetOS launches on a chip carries the Gmail connector (`claude mcp list`
   inside one); until then the 07:30 `task.scheduled` in the brief cannot be placed honestly.

**Exit:** a morning digest in the notification centre naming what needs him, and nothing in his
inbox older than a week that he has not decided about.

## M13 — JARVIS Voice: the hologram, speech, voice profiles, desktop control — **slice 1 built 2026-09-24, unseen**
William: "a launch-on-boot fully voice controlled mini program … open after effects on one and
firefox on two … see it move the mouse … a small square window … a blue hologram … talk back … a
'train' button … agentic." Then: his own voice as the dataset. Design: `docs/11-JARVIS-VOICE.md`.
Rules: docs/07 § JARVIS Voice.

- [x] **M13.1 The window, speech, the recorder, desktop commands by rule** (2026-09-24). Evidence:
  `test/hologram.test.ts` (11), `test/speech.test.ts` (14), `test/desktop.test.ts` (24),
  `test/intent.test.ts` (+3), `test/jarvis-voice-contract.test.ts` (5); `npm run speech:probe`
  spoke a line with Microsoft David in 8 s; `npm run desktop:probe` listed 20 windows read-only.
  **Not seen on screen, and no plan has run against the desktop:** the first one is with William
  watching. A LOOK → System switch "JARVIS Voice window" opens it.
- [x] **M13.2 A synthesis server for voice profiles** (2026-09-24, heard). `tools/speech-server.py`
  (F5-TTS, reference-clip synthesis, 127.0.0.1:47832), `npm run speech:install` (Python 3.10 venv,
  torch 2.11.0+cu128 on the RTX 5070, f5-tts 1.1.22), `npm run speech:serve`, `npm run
  profile:import`. Evidence: William's 380 AIFF clips imported as profile `jarvis` (358 in, 22 too
  short, all transcribed by whisper, 122 usable as a reference); a test line synthesised in his
  voice (400 KB WAV, 8 s) and played through the speakers; `settings.json` now `speech.backend:
  server`, `profile: jarvis`. Found by doing: torchaudio 2.9+ decodes through torchcodec, which
  wants FFmpeg; the server reads its own WAVs with soundfile instead. Still open: **USE THIS VOICE**
  and SkynetOS's own start of the server, unseen in the app; the fine-tuned voice (shape 2).
- [x] **Later 2026-09-24: the profile is heard, and JARVIS talks back** (from `handoff.md` "JARVIS
  Voice — 2026-09-24" items 8–11, not yet on this roadmap). William's 380 AIFF clips imported and
  synthesised aloud in his own voice; `settings.json` now `speech.backend: server`, `profile:
  jarvis`. An unrecognised sentence now goes to headless `claude -p` (Haiku, no tools) for a spoken
  two-sentence reply, then the microphone reopens once without the wake phrase for a follow-up
  sentence (`converse.ts`, `voice.ts` `listenAgain`, `test/converse.test.ts` 11,
  `test/voice-service.test.ts` +6). The old 2.2 s hand-off that typed unrecognised sentences into
  the Face's own conversation is gone — only "ask the face …" reaches it now. The VOICE button now
  opens the hologram window directly, and its five buttons fit the 240 px square without clipping.
  **Not heard live**, per `handoff.md` and the 2026-09-24T23:31 mail to the Face.
- [x] **M13.3 The planner** (2026-09-27; docs/11 § Slice 2). A desktop request the rules do not
  match ("open my most recent project in After Effects", "do the notepad test but in Word") goes,
  with DESK on and `desktop.planner` not off, through the user-only `desktop:plan` to headless
  `claude -p` (converse.ts's shape: no tools, no MCP servers, 30 s, `desktop.plannerModel`), with
  the windows, monitors, catalogue, the planner's own log and up to three saved actions as worked
  examples (summary lines only, coordinates scrubbed), under 6,000 characters. `normalisePlan`
  passes six step kinds (`launch`, `focus`, `place`, the new `uiaClick` by UI Automation name,
  `keys`, `wait` ≤ 3 s) and runs nothing if it dropped anything; the line is spoken from main, then
  `runPlan` runs it; `%APPDATA%/SkynetOS/desktop/planner.log.jsonl`. `packages/shared/planner.ts`,
  `src/main/services/planner.ts`, `test/planner.test.ts` (18); `npm run typecheck` clean. No
  screenshot (the design's `--allowedTools Read` was dropped: the planner has no tools). **Not run:
  no `claude -p` plan has been asked for and no plan has run against the desktop**; the first is
  with William watching.
- [x] **M13.4 Action recording** (2026-09-26, TRAIN ACTION in the DESK panel). The helper's watch
  mode records clicks with their UI Automation target, wheel and keys while the light is on, pauses
  itself on sign-in windows, saves to `userData/desktop/recordings/`, and replays through three
  adaptation tiers (element by name, window-relative, screen). `packages/shared/actions.ts`,
  `services/action-recorder.ts`, `test/actions.test.ts` (14). **No recording or replay has been
  run**; the first is with William watching. Recordings are also the worked examples M13.3 wants.
- [x] **M13.5 A tray icon** (2026-09-27), so the minimised window has a second home. The JARVIS
  orb in the hologram's six blues, 16/32 px (`npm run icon:tray` → `assets/tray/`); left click brings
  the board back; the menu opens the board or JARVIS Voice, switches Voice, Desk control and Start
  with Windows, and quits. `tray.minimizeToTray` (default off). `src/main/services/tray.ts`,
  `packages/shared/tray.ts`, `test/tray.test.ts` (13). No new channel. Not yet seen on the taskbar.
  The 240 px question is closed by M13.6: the window is 480 px, and full height in DESK mode.
- [x] **M13.6 The globe** (2026-09-26): a hand-written WebGL2 renderer (`src/renderer/hologram/`),
  480 px, a gridded short-depth sphere with wisps, driven by `speech:levels` (eight bands →
  horizontal distortion, rms → vertical) and `voice:levels`; LISTENING brightens the whole picture;
  recent files and programs orbit as icons and sit pinned at permanent coordinates
  (`globe-atlas.ts`, `userData/globe-atlas.json`); what Claude Code touches is summoned to the
  centre and drawn as paper, a typed terminal, a wireframe or a folder (`activity-feed.ts`,
  `holo-content.ts`, `holo-scene.ts`); CLOSE closes, DESK moves it to monitor one at full height.
  Tests: `hologram-levels` 18, `hologram-controls` 6, `globe-atlas` 34, `activity-events` 11,
  `holo-content` 10. **Not seen on screen: the first `npm run boot` is the shader compile.**
- [x] **M13.7 Every control by voice** (2026-09-26): `hologram-control.ts` ids on every control,
  spoken forms for each (`test/intent.test.ts` walks the list), "stop" variants, "shut yourself
  down" (the program only), dictation on `Ctrl+Alt+D`, saved actions by name.
- [ ] **M13.8 The fine-tuned voice** (begun 2026-09-26): `npm run speech:finetune -- prepare|train|
  status|prune|apply|eval jarvis`; a 1,500-update F5-TTS fine-tune on 117 clips (7.8 min) started
  on the RTX 5070; `tools/speech-server.py` loads a profile's `finetune` checkpoint and scores
  reference clips. Tick when `apply` has run and William has heard it. Next if timbre is still
  short: an RVC (Applio) layer, the survey's route 2.
- [ ] **M13.9 The Iron Man globe, the rest of it**: a real scroll for long documents with a page
  cache on disk, code diffs from Edit tool inputs rather than a file re-read, 3D model textures,
  a session picker when several sessions run, and the planner (M13.3) driving desktop actions
  from the recorded examples.

**Exit:** SkynetOS starts with Windows, the square is bottom-right, and "Jarvis, open after effects
on one and firefox on two" does exactly that while the sphere talks him through it in his own
recorded voice.

### Built 2026-09-11: boot, replace-on-launch, start with Windows

- `npm run boot` builds and starts a refreshed SkynetOS. A copy already open hands over to it
  (newest wins; `src/main/services/instance.ts`).
- "Start SkynetOS with Windows" is a switch in the LOOK panel's SYSTEM section, or
  `npm run autostart:on|off|status`. It is per machine and per user.
- Not yet run for real: the hand-over between two live copies, and a sign-in start. See handoff.md.

---

## Deliberately out of scope for v1
Multi-machine sync · multi-user · plugin marketplace · macOS/Linux · a visual scripting layer. Each is a fine v2 idea and a great way to never ship v1.

(A "mobile companion" stood on this list until 2026-09-11, when William asked for it. It is M9 above, designed in docs/08, and scheduled after M8 rather than excluded.)

## Sequencing advice
M0–M4 is the useful core; if you only ever build that, you have a launcher you'll open daily. M5 is what makes it fun. M6 is what makes it yours. M7–M8 are what make it SkynetOS.
