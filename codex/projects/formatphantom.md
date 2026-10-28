---
updated: 2026-10-20
status: ACTIVE — live SaaS, 45 browser tools, product frozen on main since 2026-08-22, mid-reboot
owner-node: none yet (no board presence anywhere; root is 4/4, no open phantom slot)
---

# FormatPhantom (Goob Entertainment Co.)

**Identity.** A privacy-first, browser-only file-conversion web app (formatphantom.com, 45 tools
across image/audio/video/PDF/subtitle/transcript workflows) aimed at creators. Repo:
`C:/dev/FormatPhantom` (GitHub `Goob-Entertainment-Co/FormatPhantom`, private; transferred from the
`WilliamFischer02` account 2026-10-17). Stack: React 19 + TS strict + Vite + Tailwind + React Router 7
on Cloudflare Pages/Workers, Supabase backend, Resend mail, Lemon Squeezy billing (Phase 1 merged —
$3 lifetime premium). CI runs on William's own self-hosted runner.

**Found this pass.** Not in `codex/index.md` or `codex/projects/` before now — a large, long-running,
heavily self-documented repo (its own `.claude/agents/README.md` fleet of scheduled routines, a
`.claude/decisions.md`, `.claude/handoff.md`, `.claude/backlog.md`/`content-queue.md`, 70+ dated daily
scan reports back to 2026-05, deep competitor research on 25+ rival tools) with zero prior board or
codex presence. Same coverage-gap pattern as AE-Phantom_Suite and StatPopperLIVE before it — it runs
its own tracking well enough it never needed SkynetOS. `codex/index.md`'s "most project files don't
exist" warning doesn't apply here; this is the opposite problem, a real project nobody wrote down.

**State, from `reports/2026-10-10-state-of-project.md` (a lead-dev session's own reboot audit):**
technically healthy — typecheck/lint/455 tests/prod build all green, 255 internal links with 0 broken,
correct SEO/JSON-LD/legal pages — but **`main` was frozen 49 days** (since 2026-08-22) with 37
unmerged report-only PRs piled up from a daily scan routine that was rewarded for reporting instead of
shipping. Root causes already diagnosed and the agent fleet rebuilt around steady content + feature
delivery instead (see `.claude/agents/README.md`, "lead-engineer mandate 2026-10-17" per `CLAUDE.md`).
A P1 backlog item: a visitor-reachable HIGH CVE in `pdfjs-dist`, open ~8 weeks, needs a semver-major
bump. AdSense still rejected for "low value content" — the content library (8 guides in June) is the
real bottleneck; the reboot's plan is 17 queued guides taking it to 25 over ~6 weeks.

**No phantom proposed.** `root` is still 4/4 (the same four phantoms unticked since 2026-09-16/25) —
no capacity this pass, and this is a judgment call about which standing recommendation to bump, same
as MagicTrainer's entry before it. Flagged for William's decision: a live SaaS business with real
revenue infrastructure (billing, CVE exposure, a frozen `main`) arguably deserves a root slot over at
least one of the three bare-repo-coverage phantoms there.

## Next
1. William's call: should `ph_formatphantom` bump one of the three standing root phantoms
   (`ph_bitrunners`, `ph_stackassembler`, `ph_story_universe_map`)? All three are coverage-only; this
   project has an open CVE and a monetization deadline behind it.
2. Agent-side, already scheduled per its own docs: the 17-guide content push and the `pdfjs-dist`
   semver-major bump are both already tracked in `.claude/backlog.md`/`content-queue.md` inside the
   repo — nothing for SkynetOS to add there, just to point at.
