---
updated: 2026-09-11
status: ACTIVE — Webflow site ops for goobscott-productions.com. NOT previously in the codex index (found during an away-mode survey; JARVIS had no board visibility into this repo before today).
purpose: What JARVIS needs to know about wfp-site-ops to route sessions and track state.
---

# WFP Site Ops

Ongoing Webflow site management for William Fischer Productions
(`goobscott-productions.com`, portfolio for Goob Entertainment Co.) via the Webflow MCP: pages,
SEO, responsive audits, CMS content. Repo: `C:/dev/wfp-site-ops`. **Never publish to the live
domain without William's explicit "publish" confirmation** — build/verify on the
`goobscott-productions.webflow.io` staging subdomain first, always.

## State as of the last handoff

Active work: the Music page overhaul (started 2026-08-06), built on staging, unpublished. Eras
converted to a vertical timeline with Apple-UI glass cards, Spotify/YouTube pills added and
CMS-bound for the three confirmed eras. A second, separate feature — the Films page (9 cards,
role badges, YouTube thumbnails) — is also built and unpublished.

## Next (`docs/handoff.md`'s own build-phase list)

1. Chess club era's Spotify artist URL is still missing (blocks full pill wiring); SoundCloud and
   Apple Music links were searched for and not found for any era.
2. Restyle remaining era cards to the Apple-UI glass treatment; fix the known mobile cutoff (fixed
   px sizing / overflow / transform-origin not adapting below ~480px, per CLAUDE.md).
3. Build the featured EP card + singles grid with multi-platform deep-link pills (app → web
   fallback via page custom code).
4. Fix broken footer socials (IG/TikTok/YouTube real URLs).
5. Full responsive pass (320/390/768/1024/1440, both orientations) with screenshots to `audits/`,
   per the repo's own responsive audit protocol — before either page goes to staging review.
6. Log every SEO/link change in `docs/seo-log.md` as it happens, not retroactively.

## Landmines

- Before any bulk CMS edit: export affected items to `exports/` as a JSON backup first.
- Design edits need the Designer open + Bridge App connected — check before starting.
- Never delete pages, collections, or fields without asking.
