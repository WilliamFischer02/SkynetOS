---
updated: 2026-10-01
status: v1.0.0 BUILT AND TAGGED 2026-09-25 — ready to ship to William, zero board/codex presence until this pass
owner-node: none yet (no board presence anywhere)
---

# MagicTrainer

**Identity.** A Windows desktop app (Tauri 2 + React 19 + TS) that reads William's real MTG
collection/decks, detects the strategies and combos inside them, and animates the winning line as
card trajectories across a game board against scripted opponent tracks — a visualizer/trainer, not
a rules engine or simulator (that's StackAssembler's lane; the boundary is explicit in
`docs/PROJECT_BRIEF.md`). Owner: William Fischer, Goob Entertainment Co. Repo: `C:/dev/MagicTrainer`
(github.com/WilliamFischer02/MagicTrainer). Started 2026-09-24.

**Found this pass.** Not in `codex/index.md` or `codex/projects/` before now — a real,
fully-built repo with `CLAUDE.md`, `docs/HANDOFF.md`, `docs/ROADMAP.md`, agent config, subagents
and skills, with zero board node and zero codex entry. Discovered by a plain directory listing of
`C:/dev` turning up a repo no prior pass had catalogued.

## State (from `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/QUESTIONS_FOR_WILLIAM.md`, read 2026-10-01)

**Phases 0–4 all done. v1.0.0 tagged 2026-09-25.** `main` green: 195 Vitest, 32 cargo tests, tsc,
eslint (0 dependency-direction violations), cargo clippy, 6 Playwright E2E tests driving the
**built** app over WebView2 DevTools (including a 2x DPI capture). Built artifacts exist now:
`MagicTrainer_1.0.0_x64_en-US.msi` (6.7 MB) and an NSIS setup (3.8 MB), unsigned, under
`app/src-tauri/target/release/bundle/`.

What it does today: imports ManaBox/TCGPlayer/Moxfield CSV and plain/Arena/MTGO decklist text;
Deck Builder (curve, mana, role coverage, detected archetypes/combos with rationale, near-miss
upgrades, Card Kingdom budget links); Deck Trainer (animated playline on a 7-zone board, CR-cited
step panel, break points, scrubber, 7 opponent tracks); first-run onboarding downloads Scryfall
bulk data (109 MB) with an offline fallback; production CSP; local crash log.

All 14 of William's "accept all" provisional decisions (Q-001…Q-014) were resolved 2026-09-25 —
no open questions block anything.

## Blockers — all William's, not agent work

1. **Ship it.** Copy the MSI/NSIS to William with the SmartScreen note (unsigned installer,
   Q-010). First launch on a clean machine is the one path the dev box couldn't test (it always
   had `data/` already) — the onboarding download needs a real first run.
2. **No board or codex presence anywhere** until this pass — same coverage-gap shape as
   BitRunners/StackAssembler/Story Universe Map (`codex/index.md`'s standing GoobOS note): no
   `goobos` room exists, so a bare `store.repo` node on `root` is the pattern already proven for
   those three. **Root is 4/4 phantoms** (`ph_bitrunners`, `ph_stackassembler`,
   `ph_story_universe_map`, `ph_jarvis_voice`, all unticked since 2026-09-16/25) — no capacity
   this pass. Worth a slot once one opens: this one is a *finished, shippable* v1.0.0, not just a
   repo coverage gap like its three root-board neighbors.

## Next

1. **William: install and run it once** — exercises the untested first-run onboarding path, then
   it's real feedback instead of a tagged build sitting in a release folder.
2. v1.1 backlog (from HANDOFF.md, not urgent): step-panel "consequence" line, mana-value-aware
   turn placement, more playline templates (go-wide-tokens/voltron/storm), collection list view +
   tag filter, real card-back asset, decision-point branching (Q-003).
3. Ops housekeeping: re-measure the board on integrated graphics (D-006 caveat), trim the 900 MB
   dev DB, refresh the CR text pack (98 days old as of 2026-09-25), consider a code-signing cert.
4. **Propose `ph_magictrainer` on `root`** (store.repo, same shape as the other three) the next
   pass that finds a root slot open — tick/cross of any of the four standing ones would free one.
