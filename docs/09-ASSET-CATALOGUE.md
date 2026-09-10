# 09 — Asset catalogue

**Generated. Do not edit by hand — run `npm run assets:catalogue`.**

Every sheet on this disk, measured. `docs/05-ASSETS.md` describes the pipeline and
`assets/sprites/manifest.json` declares what the app draws; this says what there IS to
draw from. Nothing here is copied from a vendor README — a README describes the pack
that was published, not the file sitting in `assets/vendor/`.

## The packs, and their licences

| Pack | Licence line | SOURCE.md |
|---|---|---|
| `FreeTopDownTilesetPixelArt-CC0` | Free CC0 Top Down Tileset Template Pixel Art | yes |
| `kenney_1-bit-pack` | - **License:** CC0 1.0 Universal. Personal, educational and commercial use. Credit appreciated, not  | yes |
| `kenney_ui-pack-space-expansion` | > and linked <https://opengameart.org/content/cc0oga-by-pixel-art>. That was a copy-paste of the | yes |
| `OpenGameArt-cc0oga` | OpenGameArt — CC0 / OGA-BY pixel art collection | yes |

## Sheets

`cells` is the grid; `used` is how many of them contain any non-transparent pixel — the
number that decides whether a sheet is a resource or a mostly-empty grid. A grid marked
INFERRED was guessed from the image dimensions and has NOT been verified: do not cut a
kitbash from one until it has been measured and recorded in the manifest.

| Sheet | Manifest key | Size | Grid | Cells | Used | Colours | Ink |
|---|---|---|---|---|---|---|---|
| `FreeTopDownTilesetPixelArt-CC0/Tilesheet/tileset_blue.png` | — | 256×80 | 16×16 *(INFERRED)* | 80 | 72 | 19 | 68.5% |
| `FreeTopDownTilesetPixelArt-CC0/Tilesheet/tileset_brown.png` | — | 256×80 | 16×16 *(INFERRED)* | 80 | 72 | 18 | 68.5% |
| `FreeTopDownTilesetPixelArt-CC0/Tilesheet/tileset_full.png` | — | 256×400 | 16×16 *(INFERRED)* | 400 | 360 | 30 | 68.5% |
| `FreeTopDownTilesetPixelArt-CC0/Tilesheet/tileset_gray.png` | `rgs_gray` | 256×80 | 16×16  | 80 | 72 | 18 | 68.5% |
| `FreeTopDownTilesetPixelArt-CC0/Tilesheet/tileset_green.png` | — | 256×80 | 16×16 *(INFERRED)* | 80 | 72 | 20 | 68.5% |
| `FreeTopDownTilesetPixelArt-CC0/Tilesheet/tileset_purple.png` | — | 256×80 | 16×16 *(INFERRED)* | 80 | 72 | 19 | 68.5% |
| `kenney_1-bit-pack/Tilemap/tileset_legacy.png` | — | 543×543 | 16×16 +1 *(INFERRED)* | 1024 | 1024 | 8 | 88.9% |
| `kenney_1-bit-pack/Tilesheet/colored_packed.png` | — | 784×352 | 16×16 *(INFERRED)* | 1078 | 1078 | 8 | 100.0% |
| `kenney_1-bit-pack/Tilesheet/colored-transparent_packed.png` | — | 784×352 | 16×16 *(INFERRED)* | 1078 | 1077 | 7 | 30.2% |
| `kenney_1-bit-pack/Tilesheet/colored-transparent.png` | `k1bit_color` | 832×373 | 16×16 +1  | 1078 | 1077 | 7 | 26.9% |
| `kenney_1-bit-pack/Tilesheet/colored.png` | — | 832×373 | 16×16 +1 *(INFERRED)* | 1078 | 1078 | 8 | 88.9% |
| `kenney_1-bit-pack/Tilesheet/monochrome_packed.png` | — | 784×352 | 16×16 *(INFERRED)* | 1078 | 1078 | 2 | 100.0% |
| `kenney_1-bit-pack/Tilesheet/monochrome-transparent_packed.png` | — | 784×352 | 16×16 *(INFERRED)* | 1078 | 1077 | 1 | 30.2% |
| `kenney_1-bit-pack/Tilesheet/monochrome-transparent.png` | `k1bit` | 832×373 | 16×16 +1  | 1078 | 1077 | 1 | 26.9% |
| `kenney_1-bit-pack/Tilesheet/monochrome.png` | — | 832×373 | 16×16 +1 *(INFERRED)* | 1078 | 1078 | 2 | 88.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_blade_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 97 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_blade_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 91 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_blade_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 97 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_blade_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 91 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_large_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 60 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_large_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 54 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_large_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 60 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_large_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 54 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_notch_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 87 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_notch_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 81 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_notch_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 87 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_notch_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 81 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_small_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 60 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_small_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 54 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_small_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 60 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double/button_square_header_small_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 54 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/button_rectangle_depth.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 57 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/button_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 40 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/button_square_depth.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 57 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/button_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 40 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass_notch_bl.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 39 | 97.2% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass_notch_br.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 41 | 97.2% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass_notch_tl.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 39 | 97.2% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass_notch_tr.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 40 | 97.2% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass_notches_top.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 38 | 95.0% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass_notches.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 35 | 90.5% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 40 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass_tab_blade.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 15 | 56 | 78.0% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass_tab.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 12 | 42 | 74.5% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_glass.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 34 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 34 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 32 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 34 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double/panel_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 32 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_blade_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 98 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_blade_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 92 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_blade_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 98 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_blade_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 92 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_large_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 60 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_large_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 54 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_large_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 60 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_large_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 54 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_notch_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 88 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_notch_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 82 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_notch_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 88 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_notch_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 82 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_small_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 60 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_small_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 54 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_small_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 60 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double/button_square_header_small_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 54 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_blade_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 93 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_blade_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 87 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_blade_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 93 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_blade_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 87 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_large_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 59 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_large_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 53 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_large_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 59 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_large_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 53 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_notch_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 85 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_notch_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 79 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_notch_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 85 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_notch_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 79 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_small_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 59 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_small_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 53 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_small_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 59 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double/button_square_header_small_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 53 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_blade_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 98 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_blade_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 92 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_blade_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 98 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_blade_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 92 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_large_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 60 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_large_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 54 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_large_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 60 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_large_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 54 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_notch_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 88 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_notch_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 82 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_notch_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 88 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_notch_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 82 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_small_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 60 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_small_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 54 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_small_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 60 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double/button_square_header_small_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 54 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_blade_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 98 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_blade_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 92 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_blade_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 98 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_blade_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 92 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_large_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 60 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_large_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 54 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_large_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 60 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_large_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 54 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_notch_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 88 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_notch_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 82 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_notch_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 88 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_notch_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 82 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_small_rectangle_screws.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 60 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_small_rectangle.png` | — | 384×128 | 32×32 *(INFERRED)* | 48 | 48 | 54 | 99.9% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_small_square_screws.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 60 | 99.6% |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double/button_square_header_small_square.png` | — | 128×128 | 32×32 *(INFERRED)* | 16 | 16 | 54 | 99.6% |
| `OpenGameArt-cc0oga/Tilesheet/darknes.png` | — | 1024×640 | 32×32 *(INFERRED)* | 640 | 640 | 20 | 100.0% |
| `OpenGameArt-cc0oga/Tilesheet/megacommando.png` | — | 1024×1280 | 32×32 *(INFERRED)* | 1280 | 1280 | 13 | 100.0% |
| `OpenGameArt-cc0oga/Tilesheet/nesmup.png` | — | 704×512 | 32×32 *(INFERRED)* | 352 | 352 | 64 | 100.0% |
| `OpenGameArt-cc0oga/Tilesheet/roblocks.png` | — | 800×640 | 32×32 *(INFERRED)* | 500 | 332 | 16 | 41.9% |
| `OpenGameArt-cc0oga/Tilesheet/scifitiles-sheet.png` | — | 448×192 | 32×32 *(INFERRED)* | 84 | 80 | 29 | 93.4% |

## Loose sprites

Individual PNGs rather than sheets — one image per file. Usable, but each one needs its
own manifest entry with `source: file`, so reach for them only when a sheet cell will not
do. Grouped by the directory they live in.

| Directory | Files | Size range | Colours (max) |
|---|---|---|---|
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Default` | 70 | 8×16 – 192×64 | 89 |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Default` | 60 | 8×16 – 192×64 | 65 |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Default` | 60 | 8×16 – 192×64 | 65 |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Default` | 60 | 8×16 – 192×64 | 61 |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Default` | 60 | 8×16 – 192×64 | 65 |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Default` | 60 | 8×16 – 192×64 | 65 |
| `kenney_ui-pack-space-expansion/Tilesheet/Extra/Double` | 52 | 16×32 – 192×60 | 105 |
| `kenney_ui-pack-space-expansion/Tilesheet/Blue/Double` | 44 | 16×32 – 192×60 | 56 |
| `kenney_ui-pack-space-expansion/Tilesheet/Green/Double` | 44 | 16×32 – 192×60 | 53 |
| `kenney_ui-pack-space-expansion/Tilesheet/Grey/Double` | 44 | 16×32 – 192×60 | 54 |
| `kenney_ui-pack-space-expansion/Tilesheet/Red/Double` | 44 | 16×32 – 192×60 | 56 |
| `kenney_ui-pack-space-expansion/Tilesheet/Yellow/Double` | 44 | 16×32 – 192×60 | 55 |
| `OpenGameArt-cc0oga/Tilesheet` | 4 | 96×16 – 417×328 | 24 |

## Verified geometry

What the manifest records about the sheets the app actually cuts from. These are
measurements someone made and wrote down, which is why they are the only grids safe
to kitbash against.

### `rgs_gray` — FreeTopDownTilesetPixelArt-CC0/Tilesheet/tileset_gray.png

256×80, 16×5 cells, 72 of 80 used, 18 colours.

> 2026-09-09 — 256x80, no gutters, exact 16 x 5 grid. 19 colours, 8-bit RGBA.

**Note:** Substrate speckle only, and not before M2. Needs a remap table — a flat tint would erase the speckle that is the only reason to reach for this pack.

### `k1bit_color` — kenney_1-bit-pack/Tilesheet/colored-transparent.png

832×373, 49×22 cells, 1077 of 1078 used, 7 colours.

> 2026-09-09 — 832x373, same 49 x 22 grid and same cell order as k1bit. 8 colours.

**Note:** Unused. Everything gets recoloured anyway, so the 2-colour monochrome sheet is strictly less work. Needs an 8-entry remap table before any layer can reference it without an explicit tint.

### `k1bit` — kenney_1-bit-pack/Tilesheet/monochrome-transparent.png

832×373, 49×22 cells, 1077 of 1078 used, 1 colours.

> 2026-09-09 — measured, not assumed. 832x373 px. Empty seam rows land at y=16,33,50,67,... = 16+17k,
> which is exactly what cell 16 + spacing 1 predicts, and 16/1/0 is the only exact tiling of 832x373.
> Grid is 49 x 22 cells. Agrees with Tilesheet.txt shipped in the pack.
> The sheet holds exactly 2 colours: transparent and rgb(249,250,251). Tint every layer and it is
> palette-clean by construction. See assets/vendor/kenney_1-bit-pack/SOURCE.md.

## Seeing the cells

The catalogue counts; it does not show. To pick coordinates, render a ruled contact
sheet and read them off it — never guess:

```bash
node tools/sheet-contact.mjs k1bit out.png --zoom 6 --range 0,6,22,16
```

