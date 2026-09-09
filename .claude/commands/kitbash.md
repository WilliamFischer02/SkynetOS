---
description: Build a sprite key from vendor sheet cells
---
Produce the sprite key(s): $ARGUMENTS

1. Confirm the sheet's grid. Read `assets/vendor/<pack>/SOURCE.md`. If cell size, margin, or spacing
   isn't recorded there, determine it from the PNG and write it into SOURCE.md before continuing.
   Wrong grid metadata silently produces sliced-in-half sprites and wastes an hour.
2. Identify candidate cells by coordinate. State what each one is ("row 21 col 3 — rounded panel corner").
   If you're guessing, say you're guessing.
3. Write the entry in `assets/sprites/manifest.json`. Prefer mirroring one cell over finding four cells.
   Offsets on multiples of 8. Theme keys for anything room-colored, literal tokens for anything constant.
4. `npm run assets:bake` then `npm run validate:assets`. Both must pass.
5. Report the result plainly: which keys baked, which were skipped and why, and whether the silhouette
   actually reads as the component it's supposed to be. If it doesn't, say so and recommend authoring it
   instead — a bad kitbash is worse than a placeholder rectangle.

Never edit anything under `assets/vendor/`.
