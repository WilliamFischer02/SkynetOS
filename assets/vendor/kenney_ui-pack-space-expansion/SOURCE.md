# UI Pack: Sci-fi (2.0)

> **Corrected 2026-09-09.** The previous contents of this file credited PiranhaFang / OpenGameArt
> and linked <https://opengameart.org/content/cc0oga-by-pixel-art>. That was a copy-paste of the
> `OpenGameArt-cc0oga` pack's SOURCE.md and was wrong for every field. `LICENSE.txt` in this
> folder identifies the pack as Kenney's "UI Pack: Sci-fi (2.0)", created 2024-08-19. A wrong
> attribution on a project that is going on stream is worse than a missing one, so it is called
> out here rather than silently overwritten.

- **Author:** Kenney — <https://kenney.nl>
- **URL:** <https://kenney.nl/assets/ui-pack-sci-fi>
- **License:** CC0 1.0 Universal. Personal, educational and commercial use. Credit appreciated, not required. Full text in `LICENSE.txt`.
- **Pack creation date:** 2024-08-19
- **Downloaded:** 2026-09-09
- **Commercial use / stream-safe:** yes, unconditionally.

## Sheet layout — VERIFIED 2026-09-09

**There is no sheet.** This pack is 740 individual PNGs, one widget per file, with no grid:

```
Tilesheet/<Blue|Green|Grey|Red|Yellow|Extra>/<Default|Double>/<widget>.png
```

`Default` and `Double` are 1x and 2x renderings of the same widgets. Sizes vary per widget;
`Blue/Default/button_square_header_large_square.png` is 64×64, 8-bit palette, **33 colours,
including semi-transparent edge pixels** (e.g. `rgb(21,125,168)` at alpha 159).

Consequences, all of them load-bearing:

1. Manifest entries for this pack use whole-file sources with an explicit `rect`, never `cell`.
   The `cell: {w:0,h:0}` placeholder currently in `manifest.json` is a stand-in for that.
2. The semi-transparent edges violate the binary-alpha rule. The baker drops anything under
   alpha 128, which will visibly chew the rounded corners these widgets are built around.
3. 33 colours against a 6-colour budget means a full remap table per widget, or a flat tint that
   throws away the gloss shading that is the entire point of the pack.

## Role in SkynetOS

**Not board art.** Its grammar — rounded corners, gloss gradients, drop-shadowed bevels, soft
edges — is the opposite of the 1-bit base grammar in `kenney_1-bit-pack`, and `docs/05-ASSETS.md`
§Kitbash conventions rule 1 says cells from other packs get used only where they match the base
grammar. Nothing here matches.

`docs/05-ASSETS.md` lists this pack for "panels, buttons, bars for the **DOM chrome** around the
canvas" — the inspector, the palette drawer, the session dock. That is its only sanctioned use,
and DOM chrome is outside the atlas and outside the purity validator's scope. Nothing from this
pack should ever reach `assets/atlas/`.

Currently unused. Kept for the DOM chrome pass, which is not before M6.
