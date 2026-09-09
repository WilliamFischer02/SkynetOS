# Free CC0 Top Down Tileset Template Pixel Art

- **Author:** Raphael Gonçalves (RGS_Dev) — twitter/instagram `@rgs_dev`
- **URL:** <https://rgsdev.itch.io/free-cc0-top-down-tileset-template-pixel-art>
- **License:** CC0 1.0 Universal. "You can use any way you want, even commercially. Credits is not needed." Full text in `License.txt`.
- **Downloaded:** 2026-09-09
- **Commercial use / stream-safe:** yes, unconditionally.

> **Filename note:** the license file here is `License.txt`, not `LICENSE.txt`. It passes
> `npm run validate:assets` on this machine only because NTFS is case-insensitive. On a
> case-sensitive checkout (CI, WSL, a Linux runner) the check would fail. `validate-assets.mjs`
> was changed to match case-insensitively rather than renaming a vendor file.

## Sheet layout — VERIFIED against the PNGs on 2026-09-09

| Sheet | Pixels | Cell | Margin | Spacing | Grid | Colours |
|---|---|---|---|---|---|---|
| `Tilesheet/tileset_full.png` | 256×400 | 16×16 | 0,0 | 0,0 | 16 × 25 | 31 |
| `Tilesheet/tileset_gray.png` | 256×80 | 16×16 | 0,0 | 0,0 | 16 × 5 | 19 |
| `Tilesheet/tileset_blue.png` | 256×80 | 16×16 | 0,0 | 0,0 | 16 × 5 | ~19 |
| `Tilesheet/tileset_brown.png` | 256×80 | 16×16 | 0,0 | 0,0 | 16 × 5 | ~19 |
| `Tilesheet/tileset_green.png` | 256×80 | 16×16 | 0,0 | 0,0 | 16 × 5 | ~19 |
| `Tilesheet/tileset_purple.png` | 256×80 | 16×16 | 0,0 | 0,0 | 16 × 5 | ~19 |

All six are 8-bit RGBA, no gutters, exact tiling. `tileset_full.png` is the five colour variants
stacked vertically (5 × 5 rows = 25). The five single-colour sheets are slices of it, so use
`tileset_gray.png` and ignore the rest — one colourway is enough once everything is remapped.

## Role in SkynetOS

Narrow but real: **substrate texture only.**

The floor tiles at cols 0–5 rows 0–4 and the large speckled slab at cols 10–12 rows 0–2 carry a
subtle 2–3 value speckle at exactly the density `substrate.mask_speckle_a` / `_b` want. Remapped
to the room's two mask tones, that gives the board a fibreglass-weave read instead of flat fill.

Everything else in the pack is dungeon walls, chests, potions, a sword and a coin. Off-grammar
and off-topic; not used.

This pack needs a remap table (`assets/palettes/remap/`) before it can be baked — unlike the
1-bit base pack, a flat tint would erase the speckle that is the only reason to use it. That
table does not exist yet; substrate speckle is an M2 concern (procedural substrate per room).
