---
updated: 2026-09-11
status: ACTIVE — pre-alpha, real prod deploys. NOT previously in the codex index (found during an away-mode survey; JARVIS had no board visibility into this repo before today).
purpose: What JARVIS needs to know about BitRunners to route sessions and track state.
---

# BitRunners

Open-world multiplayer ASCII social MMO. Web-first, three.js + Colyseus, live at
`bitrunners.app` (Cloudflare Pages) with a Fly.io game server. Repo: `C:/dev/BitRunners`, standalone
CLAUDE.md governs sessions there. Owner communication style: blunt, bottom-line-first, cost-conscious
— see the repo's own CLAUDE.md before any session.

## State as of the last handoff (2026-07-12, mega-batch 3)

Twelve atomic commits (P0–P8 + a hardening pass) landed on `claude/mega3-2026-07-11`, branched off
`main`. All gates green (typecheck, 85/85 tests, build, bundle check). Latest devlog is 0155
(`docs/devlog/`), matching the handoff — no newer work since.

## Next (owner actions blocking merge, per the handoff)

1. **Open the PR** from `main...claude/mega3-2026-07-11` (gh was unauthed in that session, so no
   PR exists yet) — this has been sitting unmerged since 2026-07-12, over two months.
2. **Apply migration 0019** (authored, not applied) — until then plots persist locally only, and
   account sync/plot visits degrade gracefully.
3. **Visual verify** each devlog's steps, highest value: 0151 (voxel editor feel on phone), 0153
   (two-browser plot visit + void moving-remotes regression), 0145 (ASCII resolution on a mid phone).
4. Merging triggers a Fly redeploy — P3/P5/P7C/hardening touch `apps/server` + `packages/shared`
   (no `PROTOCOL_VERSION` bump; appended fields only), so the usual coordinated-deploy window applies.

## Landmines

- Never push to `main` without explicit owner confirmation in-conversation — it's the prod deploy
  branch for both Pages and Fly.
- `docs/lore/_sealed/` is read-only even for agents; never surfaced player-facing.
- Free-text input is permitted only on the proximity-DM surface, behind a moderation stack.
