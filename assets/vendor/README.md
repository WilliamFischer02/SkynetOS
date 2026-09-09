# assets/vendor — downloaded packs, unmodified

Drop each downloaded pack here in its **own folder**, exactly as it came out of the zip. Never edit
anything in this directory. Never rename the PNGs. This folder is the paper trail.

```
assets/vendor/
  kenney-1-bit-pack/
    LICENSE.txt              <- REQUIRED. Copy it from the download.
    SOURCE.md                <- REQUIRED. See template below.
    Tilesheet/
      monochrome_transparent.png
      colored_transparent.png
    ...
  kenney-ui-pack-sci-fi/
    LICENSE.txt
    SOURCE.md
    ...
  rgsdev-cc0-topdown-template/
    ...
```

## Rules

1. **Every pack folder needs `LICENSE.txt` and `SOURCE.md`.** `npm run validate:assets` fails the
   build if either is missing. You are putting this program on stream — the license trail is not
   optional and it costs 30 seconds per pack.
2. **Folder name = `<author>-<pack-name>`, lowercase, hyphens.** That name becomes the sheet id
   prefix in the manifest.
3. **Nothing in here is ever rendered directly.** The bake step slices cells out of these sheets,
   recolors them to the SkynetOS palette, composites them, and writes `assets/atlas/`. That baked
   output is what the app loads and what the purity validator checks.
4. **Vendor files are exempt from the palette and alpha checks.** They're source material, not
   shipped art.

## SOURCE.md template

```md
# <Pack name>
- Author: <name>
- URL: <download page>
- License: <CC0 1.0 / OFL / other — quote the exact terms if not CC0>
- Downloaded: <YYYY-MM-DD>
- Sheet layout: <cell size, margin, spacing> for each sheet used
- Commercial use / stream-safe: yes / no / conditions
```

## Where things live

| Directory | What | Git | Purity-checked |
|---|---|---|---|
| `assets/vendor/` | Downloaded packs, untouched | committed | no |
| `assets/sprites/manifest.json` | Kitbash recipes: cell → sprite | committed | n/a |
| `assets/sprites/authored/` | Your own hand-drawn PNGs, when you make them | committed | yes |
| `assets/palettes/remap/` | Per-pack color translation tables | committed | n/a |
| `assets/atlas/` | Baked output the app actually loads | **ignored, regenerated** | yes |
