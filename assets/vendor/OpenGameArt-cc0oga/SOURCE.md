# OpenGameArt — CC0 / OGA-BY pixel art collection

> **Corrected 2026-09-09.** The previous contents credited the whole folder to a single author,
> "PiranhaFang". That is the name of the OpenGameArt *collection*, not the artist. `LICENSE.TXT`
> lists **168 separate works by many different authors**, and the ten sheets actually present
> here are by five of them. Per-file attribution is below.

- **Collection URL:** <https://opengameart.org/content/cc0oga-by-pixel-art>
- **Downloaded:** 2026-09-09
- **Commercial use / stream-safe:** yes for every file used, all CC0. See the caveats.

> **Filename note:** the license file here is `LICENSE.TXT`, not `LICENSE.txt`. Same
> case-sensitivity caveat as the rgsdev pack — see that pack's `SOURCE.md`.

## License audit — per file, traced to its block in LICENSE.TXT

| Sheet | Author | License | Original work |
|---|---|---|---|
| `scifitiles-sheet.png` | Buch | CC0 | [Sci-fi Interior tiles](https://opengameart.org/content/sci-fi-interior-tiles) |
| `colony.png`, `colony-db32.png` | Buch | CC0 | [Colony sim assets](https://opengameart.org/content/colony-sim-assets) |
| `megacommando.png` | surt | CC0 | [More NES-like Tiles](https://opengameart.org/content/more-nes-like-tiles) |
| `darknes.png` | surt | CC0 | [DarkNES](https://opengameart.org/content/darknes) |
| `nesmup.png` | surt | CC0 | [NESmup](https://opengameart.org/content/nesmup) |
| `roblocks.png` | surt | CC0 | [RoBlocks](https://opengameart.org/content/roblocks) |
| `spacermale.png` | zwonky | CC0 | [Spacers](https://opengameart.org/content/spacers) |
| `cyclop.png` | zwonky | CC0 | [Cyclobot](https://opengameart.org/content/cyclobot) |
### Two untraceable files were DELETED, 2026-09-09

`2015-02-24 (retro platformer)[tilesheet]1.png` and `...2.png` had **no matching entry in
`LICENSE.TXT`**. Their filenames were browser download timestamps, so the link back to the
original work was gone. Every other file in the folder matches a license block by its original
filename.

The collection as a whole contains **5 OGA-BY entries** among its 168 works. OGA-BY requires
attribution — a meaningfully different obligation from CC0. None of the eight traced files fall
under those five, but an untraceable file could not be shown to be outside them either, and this
project is going on stream.

**William authorised deletion on 2026-09-09 and both files were removed.** The quarantine list in
`tools/validate-assets.mjs` is kept as a tripwire: if either filename ever reappears in this
folder, the build fails rather than silently shipping it.

## Sheet layout — VERIFIED against the PNGs on 2026-09-09

| Sheet | Pixels | Cell | Grid | Colours | Alpha |
|---|---|---|---|---|---|
| `scifitiles-sheet.png` | 448×192 | 16×16 | 28 × 12 | 30 | has transparency |
| `roblocks.png` | 800×640 | 16×16 | 50 × 40 | 17 | has transparency |
| `darknes.png` | 1024×640 | 16×16 | 64 × 40 | 21 | **none** — opaque black ground |
| `nesmup.png` | 704×512 | 16×16 | 44 × 32 | 64 | **none** — opaque `#BED6FD` ground |
| `megacommando.png` | 1024×1280 | 16×16 | 64 × 80 | 13 | **none** — opaque black ground |
| `colony.png`, `colony-db32.png` | 417×328 | **no grid** | — | 25 | has transparency |
| `spacermale.png` | 112×64 | 16×16 | 7 × 4 | — | has transparency |
| `cyclop.png` | 96×16 | 16×16 | 6 × 1 | — | has transparency |

`colony.png` at 417×328 divides evenly by nothing — it is a loose sprite sheet, not a tile grid.
Any use needs explicit per-sprite `rect` values, not `cell` coordinates.

The three opaque sheets would need their background colour keyed out before slicing. The baker
has no key-out step and is not getting one for these.

## Role in SkynetOS

**Effectively none.** `docs/05-ASSETS.md` lists this collection for "sci-fi interior and
industrial tiles: vents, panels, cabling", and `scifitiles-sheet.png` is the sheet it means.
Rendering it (`node tools/sheet-contact.mjs assets/vendor/OpenGameArt-cc0oga/Tilesheet/scifitiles-sheet.png out.png --zoom 4`)
shows why it does not work here:

- It is floor plating and wall panels with hazard stripes, at 30 colours with interior shading
  and 2px outlines — a completely different silhouette grammar from the 1-bit base pack.
- Only cells `[4,7]` and `[5,7]`, two small wall consoles, read as electronics at all, and they
  are 16×16 details rather than component bodies.
- Bringing it into the same board as the base pack would produce exactly the ransom-note effect
  `docs/05-ASSETS.md` §Kitbash conventions warns about.

Kept for the license trail and in case a later component needs one specific detail cell. Nothing
from this pack is currently referenced by the manifest.
