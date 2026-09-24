---
updated: 2026-09-23
status: ACTIVE — M0–M4 done, most of M5–M8 done, M9 built-off, M10 installer built-unrun, M11 FinanceOS built no real numbers yet, M12 Mail designed and surveyed only. Updated by an away-mode pass: the file had drifted two days behind handoff.md, missing the entire 2026-09-23 away-hour (FinanceOS, Mail, prime/).
purpose: What JARVIS needs to know about SkynetOS itself (the program you're running in) to route sessions and track state. See docs/06-ROADMAP.md for the authoritative milestone detail; this file tracks state only.
---

# SkynetOS

The program this codex belongs to: a Windows desktop app rendering an overhead pixel-art
motherboard where every visual component binds to a real agent, repo, folder or file on this
machine. Repo: `C:/dev/SkynetOS`. `CLAUDE.md` is the build contract; `docs/01` through `docs/08`
are normative. `handoff.md` at repo root is rewritten every session — read it first, it is more
current than this file.

## State as of the last handoff (2026-09-12, U3 JARVIS-PRIME)

`npm run verify` green: 97 files, 1,529 tests. **Nothing committed** — William has not asked.
Built this session: voice control end to end (wake grammar, whisper-server, hidden capture
window), two-hand gesture cursor placement with zoom-about-point, a Windows 3.1 cursor sprite
set, THE MATRIX (`G` — a software-rasterised globe of visit history), and a breadcrumb layout
fix. **None of it has been tried with a real microphone or camera.** The session before rebuilt
gesture recognition from geometry up (pose model, hand synthesis, MediaPipe GestureRecognizer).

Before that: an overnight batch (forks A–Q) landed three large uncommitted batches — wires,
the prompt node, the monitor widget, Fable fallback, effects, drive auditor, usage calibration,
copy/paste, Summon JARVIS, the LOOK panel, phantom recommendations, the research explorer, the
corner prompt to the Face, PROMPT → NODE, OBSIDIUS, and the whole Remote (M9) build. `npm run
verify` was green at 1,233 tests after that batch. Almost none of it has been clicked by a human.

**Morning maintenance, 2026-09-15 and 2026-09-19** (unattended, uncommitted): drag badges de-overlap,
frame tooltips in the node editor, schedule errors that end in an action, the REMOTE panel surviving a
rejected call. `npm run verify` green at 98 files, 1,544 tests on 2026-09-19. Open from those runs:
docs/06 "Known issues" 7 to 10, of which 9 (`revokeDevice` half revokes on a failed save) is a
docs/07 security path waiting for William.

**2026-09-21 (U3, uncommitted):** the board now sees a mod's first build and a build after
`gradlew clean` (the watcher waits for a missing `build/libs`), and F5 refreshes files. SkynetOS has an
installer: `release/SkynetOS-0.1.0-x64.exe`, version 0.1.0, not yet run by William. An installed copy
keeps its data in the repo, never in the install folder, and updates itself from GitHub Releases once
William publishes one. `agent.code` nodes can opt in to Claude Code's Remote Control
(`remoteControl`). Tailscale on William-Desktop is ready; the REMOTE switches are his to press.
`npm run verify` green at 103 files, 1,604 tests. See `docs/09-RELEASE.md` and handoff.md.

## The away hour — 2026-09-23 (U3 JARVIS-PRIME, William at work; not yet in the "Next" list below)

Nothing committed, nothing deleted, no dialog raised, no account logged into, no mail sent or
moved. Full detail in `handoff.md` "The away hour — 2026-09-23"; summary here so this file stops
lagging it:

- **FinanceOS (M11) built**: `board/financeos/room.board.json` (27 nodes, reached via D5 on
  root), the ledger model (`packages/shared/finance.ts`, `test/finance.test.ts` 32 cases),
  `npm run finance:report`, a finance-advisor persona (`codex/personas/finance-advisor.md`). No
  `ledger.json` exists yet — numbers are William's to fill from the template. Unbuilt: a
  `monitor.finance` node kind for board-face meters; live bank data deliberately rejected for now.
- **Mail (M12) designed and surveyed, nothing scheduled**: `docs/10-EMAIL.md`,
  `codex/briefs/email-triage.md` (P0–P3 scale). Gmail inbox surveyed read-only: ~10,000 threads,
  1 P0, 11 P1, 5 P2 found (`private/finance/` and `private/email/` hold the real detail — never in
  the repo, never in this file). No label created: the connector is read-only until William
  re-authorises with the modify scope.
- **`prime/`**: JARVIS Prime's own persistent workspace — `README.md`, `toolbox.md`,
  `playbooks/`, `learning/`, `log.md`, plus `npm run board:overlap` and `npm run board:snapshot`.
- **Security fix wanting William's eye**: `remote-server.ts` now counts a bad device token toward
  the ten-in-ten-minutes lockout, as docs/07 always specified. Test added, verify green.
- **Tailscale guide for William's side**: `docs/guides/remote-setup-tailscale.md`.

## Next

Per `handoff.md`'s own "For William, in order", the 2026-09-23 away-hour queue now sits ahead of
the older items below:

0. **`npm run boot`, then work through `docs/guides/remote-setup-tailscale.md` sections 2–4**
   (three presses and a QR scan) — everything main-process from today (toast, `finance:status`,
   the remote lockout) needs the restart first.
0a. **Fill FinanceOS with real numbers**: copy `private/finance/ledger.template.json` to
    `ledger.json`, replace every figure, `npm run finance:report`, open LEDGER.
0b. **Read `private/email/survey-2026-09-23.md`** (1 P0, 11 P1), then re-authorise the Gmail
    connector with the modify scope (docs/10 step 8) so labelling can run.
0c. **Decide which institutions go on the public FinanceOS board** (J1–J4 are provisional) and
    whether hotmail forwards into Gmail.

1. **Restart SkynetOS and put the 2026-09-12 voice/gesture/MATRIX work in front of William** —
   it is entirely main-process and untested outside smoke captures. Concrete click-list is
   handoff.md items 0 and 0(earlier).
2. **The overnight batch's click-through list (items 1a–1h in handoff.md)** is still mostly
   unrun: the prompt node against real claude.ai, the Fable countdown, a drive auditor on a
   spare drive, PROMPT → NODE, Summon JARVIS, the corner prompt, phantoms tick/cross, and the
   journal note into Obsidian.
3. **Prove standing orders end to end** with the Face's first real `standing:` brief — not yet
   run (handoff.md item 2).
4. **William's five logged overhauls** (docs/06 "Known issues"): rotation not affecting
   component art, node-editor layout, more fonts (check `TruthQuestRetro/content/` for
   pixel-clean assets), usage calibration (first pass done), cross-machine usage ledger.
5. **Remote (M9) on a real iPhone** — built, off by default, never tried outside this machine.

## Landmines

See handoff.md's own "Landmines" section — it is long and current as of 2026-09-12 (voice/gesture
timing quirks, `%SKYNET%`-prefixed paths, replace-on-launch needing one restart, parallel-agent
board-file races, the public-repo boundary on DirtyPlush/FACE-BOOT/mailbox). Read it fresh each
session rather than trusting a summary here — it changes every session.

## This away-mode session (2026-09-12, JARVIS Prime, PLAN level)

**SkynetOS was not running** — no control file at
`%APPDATA%/SkynetOS/control.json`. Every board/phantom/mailbox MCP tool refused with "SKYNETOS IS
NOT RUNNING." No phantom recommendations could be proposed this pass as a result — that is a
recommendation in itself (see the journal entry), not a limitation of this session's judgment.

## This away-mode session (2026-09-13, JARVIS Prime, PLAN level)

**SkynetOS was not running, again** — same control-file check, same refusal on every MCP tool.
Two away-mode passes in a row have now found the program closed; see docs/06-ROADMAP.md "Right
now" for the standing recommendation to start SkynetOS (or schedule it) before an away-mode pass
begins, since one otherwise cannot leave board recommendations at all. This pass audited the
codex's thirteen `projects/*.md` files against each repo's real `CLAUDE.md`/handoff and found no
drift — the 2026-09-11/12 passes had already brought every "Next" section current.
