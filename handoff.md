# Handoff

**Updated:** (build agent overwrites this at the end of every session)

## State
Repo is documentation, seeded board data, and the asset pipeline. No application code exists yet.

## Done
- Full spec in `docs/01`–`docs/07`
- `schema/board.schema.json` + 5 seeded board files, all passing `validate-board.mjs`
- Asset pipeline: `assets/vendor/` convention, `assets/sprites/manifest.json` with worked kitbash
  examples, `tools/bake-assets.mjs`, purity validator rewritten to check the baked atlas
- Palette locked in `assets/palettes/skynet.gpl`, including the three reserved theme keys

## Next
Start M0 in `docs/06-ROADMAP.md`: Electron + Vite + React + TS skeleton, Pixi canvas, integer zoom,
`npm run verify` wired end to end.

## Landmines
- `validate-board.mjs` needs `ajv/dist/2020.js`, not `ajv` — the schema is draft 2020-12.
- The cell coordinates in `manifest.json` are illustrative placeholders. Verify every sheet's real
  grid (cell size, margin, spacing) against the PNG and record it in that pack's `SOURCE.md` before
  trusting any coordinate.
- `assets/atlas/` is git-ignored. Anyone cloning the repo must run `npm run assets:bake` before the
  app has art. `npm run verify` does it automatically.
- Build M0–M4 against placeholder rectangles. Do not let art block architecture.
