# 05 — Assets

## The pipeline

```
assets/vendor/<pack>/…            downloaded sheets, never edited, never shipped
        │
        │  assets/sprites/manifest.json   ← cell coordinates, tints, kitbash recipes
        │  assets/palettes/remap/*.json   ← per-pack color translation
        ▼
  npm run assets:bake               tools/bake-assets.mjs
        │   slice cells → flip/rotate in 90° steps → force binary alpha →
        │   recolor to the locked palette → composite layers → shelf-pack
        ▼
assets/atlas/skynet.png + .json     the ONLY art the app loads (git-ignored, regenerated)
        │
        ▼
  npm run validate:assets           purity check runs on the BAKED output
```

Three consequences worth internalizing:

1. **Vendor art never ships as-is.** Every pixel that reaches the screen has been recolored to the SkynetOS palette. That is what makes a kitbash from three different packs look like one coherent board instead of a ransom note.
2. **The purity rules still hold**, because they're enforced after baking, not before. Vendor sheets are exempt from the palette and alpha checks — they're source material, not shipped art.
3. **Swapping a kitbash for hand-drawn art is a one-line manifest change.** Nothing in the app code knows or cares where a sprite key got its pixels.

## Where files go

| Directory | What | Git | Purity-checked |
|---|---|---|---|
| `assets/vendor/<author>-<pack>/` | Downloaded packs, exactly as unzipped, plus `LICENSE.txt` + `SOURCE.md` | committed | no — license trail only |
| `assets/sprites/manifest.json` | Every sprite key and where its pixels come from | committed | n/a |
| `assets/sprites/authored/` | Your own hand-drawn PNGs, added over time | committed | yes |
| `assets/palettes/skynet.gpl` | The locked palette | committed | n/a |
| `assets/palettes/remap/<pack>.json` | Source-color → palette-token tables | committed | n/a |
| `assets/atlas/` | Baked output | **ignored** | yes |

Full folder rules and the `SOURCE.md` template are in `assets/vendor/README.md`. The validator fails the build if a vendor pack is missing its license file. This is going on stream; that check costs 30 seconds per pack and settles the question permanently.

## The manifest

Three source kinds per sprite key:

- **`sheet`** — one cell straight out of a vendor sheet, tinted to a palette token.
- **`composite`** — a kitbash. Several cells stacked with `at` offsets, `flipX`/`flipY`, 90° `rotate`, and a per-layer `tint`. Multiple `frames` give animation.
- **`file`** — a hand-authored PNG from `authored/`. The escape hatch.

Worked examples of all three are in `assets/sprites/manifest.json`, including the highest-leverage trick in the pipeline: **four mirrored copies of one 16×16 cell make a 48×48 chip package.** Most components here are symmetrical rectangles, which is exactly what kitbashing is good at.

## Theme keys

Rooms are different colors, but there is one atlas. Solved with three reserved key colors baked into the sprites and swapped at draw time by a tiny exact-match palette shader — no blending, no tint math, no purity violation:

| Token | Baked as | Becomes at draw time |
|---|---|---|
| `@mask-dark` | `#FF00CC` | the room's `theme.maskDark` |
| `@mask-light` | `#FF0099` | the room's `theme.maskLight` |
| `@signal` | `#FF00FF` | the room's `theme.signal` |

Use a theme key for anything that should take on the room's identity — package bodies, substrate, active-state glow. Use a literal token (`copper`, `copper-dark`, `silk`, `ok`, `warn`, `fault`) for anything that must look identical in every room. That split is the whole visual system in one decision.

## Kitbash conventions

Mixing packs is where this goes wrong. Three rules keep it coherent:

1. **Pick one silhouette grammar and stick to it.** Kenney's 1-Bit pack has a specific outline weight and corner treatment. Whatever you pick as the base sets the grammar; cells from other packs get used only where they match it, or get edited until they do.
2. **Everything lands on the 16px grid.** A cell placed at `at: [7, 3]` will read as wrong next to everything else. Offsets are multiples of 8, ideally 16 — except small detail layers like LEDs.
3. **One-bit sources are your friend.** A monochrome cell tinted to a single token is guaranteed palette-clean and guaranteed to sit in the tri-tone. Colored sheets need a remap table: more work, less benefit. Reach for the monochrome sheets first.

## Placeholder policy

Until the manifest is filled in, **any missing sprite key renders as a flat `@mask-light` rectangle at the node's footprint with its reference designator in silkscreen.** Legible, obviously unfinished, never a crash, never a broken-image icon. This is what lets M0–M4 be built and used before a single sprite exists. The full list of required keys is at the bottom of `manifest.json`.

## Sources (for reference and future packs)

| Source | License | Good for |
|---|---|---|
| [Kenney — 1-Bit Pack](https://kenney.nl/assets/1-bit-pack) | CC0 | 1000+ 16px cells. The monochrome sheet is the ideal kitbash base. |
| [Kenney — UI Pack: Sci-Fi](https://kenney.nl/assets/ui-pack-sci-fi) | CC0 | Panels, buttons, bars for the DOM chrome around the canvas. |
| [Kenney — all assets](https://kenney.nl/assets) | CC0 | Filter by Pixel. Also UI sound effects for the optional relay-click audio. |
| [OpenGameArt — CC0/OGA-BY pixel art](https://opengameart.org/content/cc0oga-by-pixel-art) | CC0 / OGA-BY | Sci-fi interior and industrial tiles: vents, panels, cabling. |
| [RGS_Dev — CC0 top-down template](https://rgsdev.itch.io/free-cc0-top-down-tileset-template-pixel-art) | CC0 | Substrate and tiling reference. |
| [itch.io — CC0 assets](https://itch.io/game-assets/assets-cc0) | CC0 | Search "circuit", "factory", "industrial", "16x16". |
| [Departure Mono](https://departuremono.com/) | SIL OFL | **Locked.** All silkscreen text. Ship the OFL file in `assets/fonts/`. |

Never source from Minecraft, Marvel Rivals, or any commercial game, including traced reference.

## When to stop kitbashing and draw

Draw a component when it needs a silhouette no combination of cells produces — the HDD platter and actuator arm, the M.2 shield can, the JARVIS CPU — or when a kitbash needs more than about eight layers. Eight is roughly where authoring in Aseprite becomes faster than fighting the manifest.

Tools for that day: **Aseprite** ($20) with `skynet.gpl` loaded as a locked palette, or **LibreSprite**/**Piskel** free. Author at 1x, export to `assets/sprites/authored/`, flip the manifest entry to `{"type":"file","path":"authored/…"}`, run `npm run verify`. Done.
