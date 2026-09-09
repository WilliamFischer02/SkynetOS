# 1-Bit Pack (1.2)

- **Author:** Kenney — <https://kenney.nl>
- **URL:** <https://kenney.nl/assets/1-bit-pack>
- **License:** CC0 1.0 Universal. Personal, educational and commercial use. Credit appreciated, not required. Full text in `LICENSE.txt`.
- **Pack creation date:** 2021-11-09
- **Downloaded:** 2026-09-09
- **Commercial use / stream-safe:** yes, unconditionally.

## Role in SkynetOS

**This is the base pack.** Its silhouette grammar — 1px outline, hard corners, no interior
shading, everything readable at 16px — is the grammar every other pack must conform to or be
rejected from. See `docs/DECISIONS.md`, 2026-09-09 "Kenney 1-Bit monochrome is the base grammar".

## Sheet layout — VERIFIED against the PNGs on 2026-09-09

Measured, not assumed. Method: decode the PNG, find fully-transparent seam rows/columns, and
confirm the only exact tiling of the sheet dimensions. `Tilesheet.txt` shipped in the pack agrees.

| Sheet | Pixels | Cell | Margin | Spacing | Grid | Colours |
|---|---|---|---|---|---|---|
| `Tilesheet/monochrome-transparent.png` | 832×373 | 16×16 | 0,0 | **1,1** | 49 × 22 | transparent + `#F9FAFB` (2 total) |
| `Tilesheet/monochrome-transparent_packed.png` | 784×352 | 16×16 | 0,0 | **0,0** | 49 × 22 | same |
| `Tilesheet/colored-transparent.png` | 832×373 | 16×16 | 0,0 | **1,1** | 49 × 22 | 8 total |
| `Tilesheet/colored-transparent_packed.png` | 784×352 | 16×16 | 0,0 | **0,0** | 49 × 22 | 8 total |
| `Tilemap/tileset_legacy.png` | 543×543 | 16×16 | 0,0 | 1,1 | 32 × 32 | legacy layout, different cell order — **do not use** |

Seam evidence for the spaced sheets: empty rows land at y = 16, 33, 50, 67 … = 16 + 17k, exactly
as `cell 16 + spacing 1` predicts. Empty columns follow the same 17px stride.

The `_packed` variants are the **same 49 × 22 tile order with the gutters removed**. Either works;
the manifest uses the spaced one because a mis-set spacing value fails loudly (sprites come out
sliced) instead of quietly drifting.

`monochrome.png` and `monochrome_packed.png` are the opaque-background versions. Not used —
the transparent variants are what the baker wants.

## Why the monochrome sheet and not the coloured one

`monochrome-transparent.png` contains exactly **two** colours: fully transparent, and
`rgb(249,250,251)`. Every opaque pixel is the same value, so a layer-level `tint` in
`assets/sprites/manifest.json` forces the whole cell to one palette token. That is
palette-clean by construction — it cannot fail `npm run validate:assets`. The coloured sheet
needs an 8-entry remap table for no visual benefit once everything is recoloured anyway.

**Note:** the source white is `rgb(249,250,251)`, **not** `#FFFFFF`. Any remap table written
against `255,255,255` will throw at bake time. `assets/palettes/remap/kenney-1-bit-pack.json`
records the real value.

## What is actually in the sheet (honest assessment)

It is a roguelike/RPG pack: terrain, characters, weapons, furniture, interior fittings, UI frames,
and a full ASCII font at rows 17–19. **There are no circuit-board components in it.** The
electronics grammar of SkynetOS has to be *built* out of interior and structural cells, not found.

Regions worth mining, from the rendered contact sheet
(`node tools/sheet-contact.mjs k1bit out.png --zoom 6 --range 0,6,22,16`):

| Region | Contains | Likely SkynetOS use |
|---|---|---|
| cols 13–20, rows 13–15 | dotted/dashed runs, corner brackets, long bars with terminated ends | `trace.*` — straights, elbows, ribbon clamps |
| col 10, row 6 | checkerboard/dither block | `overlay.heat_*` dither halo, `substrate.ground_pour` |
| col 13, row 6 | regular dot grid | `trace.via_field`, pad arrays |
| cols 11–12, row 6 | horizontal slat blocks | heat-sink fins, `component.psu_monitor` |
| cols 14–16, row 7 | rectangles with side and top tabs | DIP/QFP package bodies + pin legs |
| cols 3–4, row 13 | fringed vertical columns | pin legs, connector fingers |
| col 10, row 12 | ring with a dark centre | `trace.via` |
| rows 17–19, cols 27+ | 0–9 and A–Z | fallback silkscreen glyphs if Departure Mono is ever unavailable |

Components this pack **cannot** produce convincingly, and which are therefore staying as
placeholder rectangles until William draws them: the HDD platter + actuator arm, the M.2 room
shield can with engraving, and the JARVIS CPU. Recorded in `docs/DECISIONS.md`.
