---
description: Audit for pixel-purity violations across code and assets
---
Audit the whole codebase against docs/02-VISUAL-LANGUAGE.md "Anti-mush rules". Report every hit with file:line.

Search for and flag:
- Any Pixi filter: BlurFilter, BloomFilter, DropShadowFilter, GlowFilter, AlphaFilter used for softening
- CSS: `filter:`, `box-shadow`, `text-shadow`, `opacity` transitions on sprite layers, `backdrop-filter`
- Non-integer values in camera position, zoom, scale, or translate
- `scaleMode` anything other than 'nearest'; mipmaps enabled; `antialias: true` on the Pixi app
- Missing `roundPixels: true`
- Sprite rotation off 90-degree steps
- Hex color literals in source that aren't in assets/palettes/skynet.gpl
- Font sizes for silkscreen text that aren't multiples of 11
- Missing `image-rendering: pixelated` on any DOM element showing sprite art

Then run `npm run validate:assets` and report. Propose fixes; don't apply them until I confirm.
