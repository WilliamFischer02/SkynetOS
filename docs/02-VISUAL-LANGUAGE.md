# 02 — Visual language

## The concept in one line

A real PCB has exactly three visual layers: **solder mask** (the board), **exposed copper** (the traces and pads), and **silkscreen** (the printed white labels). That is the tri-tone. Every room recolors only the solder mask and adds one **signal** accent for live activity. Copper and silkscreen never change, which is what makes the whole app read as one board.

## Palette

Fixed across the entire app:

| Token | Hex | Use |
|---|---|---|
| `copper` | `#C08A3E` | traces, pads, pin legs, connector fingers |
| `copper-dark` | `#7A5423` | trace shadow, 1px bevel under components, via holes |
| `silk` | `#E9E4D6` | engraved labels, component outlines, reference designators |

Per-room, exactly two values — a dark mask and a light mask (the mask is shaded, not flat) — plus one signal:

| Room | mask-dark | mask-light | signal |
|---|---|---|---|
| **SKYNET** (root) | `#0E1A14` | `#16261D` | `#7FE0B0` |
| **MinecraftOS** | `#14261A` | `#1D3524` | `#A8E85C` |
| **DeductionOS** | `#201A12` | `#2E2619` | `#FFD866` |
| **StoryOS** | `#1B1420` | `#271C2E` | `#A87BD6` |
| **GameOS** | `#101C26` | `#182734` | `#4FA8D8` |
| **FinanceOS** | `#1A1B22` | `#26272F` | `#5CDCD0` |

### Relation colour

*(Added 2026-09-09.)* Connected rooms and clusters share colour, so a relationship is visible
rather than remembered.

An **edge** or a **`group.zone`** may name another board in a `relation` field. That trace's inner
strand, or that zone's outline, is then drawn in the **named room's signal colour** instead of the
current room's. A wire leaving JARVIS toward the GameOS drive carries GameOS blue; descend into
GameOS and the room is that colour. A zone in one room whose work belongs to another is outlined
in that other room's colour.

A board may also declare `relatedBoards: ["gameos"]`. That is purely declarative — it records the
affinity for the renderer and for JARVIS's cross-project view, and drives no drawing on its own.

Two properties make this cheap:

- **It costs the sprite colour budget nothing.** Traces and zone outlines are drawn as geometry
  from the palette, not as atlas sprites, so the six-colours-per-frame cap is untouched.
- **It degrades safely.** A relation naming a room that was renamed or deleted falls back to the
  current room's signal. A dangling relation is a dull wire, never a crash.

Plus three global status colors, used only on LEDs and never on large areas:

`ok #57C25A` · `warn #E0A22E` · `fault #D2453B`

So any one sprite uses at most: 2 mask + 2 copper + 1 silk + 1 signal = **6 colors, hard cap**. The validator enforces it. That cap is the single biggest reason the art will read as authored pixel art rather than generated mush.

> **Two consequences of the cap, added 2026-09-09 (M0). Both bite at M5, not before.**
>
> 1. **The budget has zero slack, so a sprite gets signal OR a status LED, never both.** The sum
>    above already spends all six. An agent chip that shows a signal-coloured active glow *and* an
>    `ok`/`warn`/`fault` LED is a seventh colour and `npm run validate:assets` will fail it. The way
>    out is to spend one of the two mask tones or the copper shadow on that frame — decide it per
>    sprite, deliberately, rather than discovering it when the bake breaks.
> 2. **No room signal may equal a status colour.** *(Fixed 2026-09-09.)* MinecraftOS signal was
>    `#57C25A`, identical to `ok`; DeductionOS signal was `#E0A22E`, identical to `warn`. In those
>    rooms a live-activity pixel and a status pixel were indistinguishable. They are now `#A8E85C`
>    and `#FFD866`, both a wide Manhattan distance clear of `ok`, `warn` and `fault`.
>    `test/palette.test.ts` enforces a minimum separation of 100, so a future palette edit that
>    reintroduces a collision fails `npm run verify` instead of shipping.

## Where the pixels come from

Sprites are **baked**, not hand-placed into the repo: downloaded packs in `assets/vendor/` are sliced, recolored to the palette above, composited, and packed into `assets/atlas/` by `npm run assets:bake`. The app loads only the atlas. Full pipeline in `docs/05-ASSETS.md`.

Two things that follow directly from this and affect how you build the renderer:

- **Theme keys.** Sprites bake three reserved key colors — `#FF00CC` (mask-dark), `#FF0099` (mask-light), `#FF00FF` (signal) — which a 3-entry exact-match palette shader swaps for the current room's theme at draw time. One atlas serves every room. The swap is exact-match only: no blending, no tinting math, no interpolation.
- **Placeholders.** Any sprite key with no manifest entry draws as a flat `@mask-light` rectangle at the node's footprint with its reference designator in silkscreen. M0–M4 are built and usable with zero finished art. Never a broken-image icon, never a crash.

### Node face images

*(Added 2026-09-09.)* Any node may carry an `image`: a path to any picture on disk. It is not
pasted onto the board — it is **re-drawn in the board's own material**.

`src/main/services/mosaic.ts` downsamples it to the node's exact footprint, reduces it to a
luminance ramp, and dithers it onto the room's six palette colours with a 4×4 Bayer matrix. The
six are the room's `mask-dark`, `mask-light`, `copper-dark`, `copper`, `signal` and `silk`, sorted
dark to light — which *is* the ramp. The result satisfies every anti-mush rule by construction:
six exact palette colours, binary alpha, integer dimensions, dither instead of blur. It reads as
a screen-printed component marking rather than a sticker.

Verified: with two face images on screen, a colour census of the rendered board found **7 unique
colours, every one an exact `skynet.gpl` entry**, with no intermediate values.

The source file is never copied or modified. The board stores only the path, so it stays small
and diffable, and a moved image renders the node broken like any other unresolved target. The
mosaic is cached in `%APPDATA%/SkynetOS/thumbs/` keyed by path, mtime, size, footprint and theme —
so the same picture in MinecraftOS and StoryOS are two different mosaics, and editing the source
regenerates it.

Reference designators are printed **with the node's name**: `U1 JARVIS`, not `U1`. The label wraps
on spaces, after hyphens, and at camelCase boundaries, so `TruthQuestRetro` prints as
`S1 TRUTH / QUEST / RETRO` on a 4×3 drive rather than being dropped. When nothing fits, the
designator is what survives — it is how you refer to the node when talking to an agent.

## Grid & sizes

- Base tile: **16×16 px** at 1x. All art authored at 1x.
- Node footprints, in tiles: `1×1` (passive component), `2×2` (small chip / file), `3×3` (agent chip), `4×3` (drive), `6×4` (room drive / big agent), `8×6` (JARVIS).
- Traces run on the 8px half-grid so they can pass between adjacent components. A pinned wire end
  (`fromAnchor` / `toAnchor`) snaps to the same half-grid along the node's side.
- **Dashed and dotted traces are whole-pixel filled rectangles**, cut on the CPU by distance along
  the route (`wire-geometry.ts`). Dashed is 4 on / 3 off, dotted 1 on / 2 off, both in multiples of
  the run width, and the pattern carries on round a corner instead of restarting at it. Pixi's
  dashed strokes are never used: a stroked dash is antialiased and lands on fractional pixels.
- Silkscreen text: **Departure Mono** at 11px or 22px only (SIL OFL, <https://departuremono.com/>). Never in between — the font is pixel-perfect only at multiples of 11.

## Component vocabulary

| Thing | Looks like | Notes |
|---|---|---|
| Claude Code agent | **DIP/QFP microchip** with pin legs, silkscreen part number = agent name, one status LED | Package size scales with how much it's used |
| Claude web agent (JARVIS-class) | **QFP chip with a heat spreader lid** and an antenna trace | Visually senior to a DIP |
| JARVIS | **Large socketed CPU** on the root board, gold pad array, own decoupling caps and VRM cluster | Only one exists |
| Repo / folder | **Open HDD** — platter, actuator arm, silkscreen label plate | Arm parks over a different platter angle depending on git dirty state |
| Room (`NameOS`) | **SSD / M.2 module** with engraved `NAMEOS` on the shield can | Click descends into the room |
| Document file | **EPROM chip with a paper label** | `.docx`, `.md`, `.pdf` |
| Executable | **Push-button switch** with a translucent cap | Click = launch, cap lights while the process lives |
| Build artifact (`.jar`, `.exe` output) | **Removable cartridge in a socket** | The drag-out handle is the cartridge itself |
| URL / cloud folder | **RJ45 jack / antenna** | Opens in browser |
| Service / dev server | **Voltage regulator** with a running-lights strip | Shows port, up/down |
| Scheduler | **Crystal oscillator** with a tick animation | Cron-style jobs |
| Health monitor | **PSU block** with 3 gauges | Real CPU/RAM/disk, unlike the cosmetic chip temps |
| Note / label | **Silkscreen text only** | No component, just print on the board |
| Trace | Copper run, 1–4 px wide, solid, dashed or dotted, with a 0–3 px black outline | Width = importance, not throughput |
| Bundle | Several traces routed in parallel with a ribbon clamp | Collapses visual noise |
| Via | Copper ring with a dark centre | Where a trace leaves the room to a parent board |

## Animation

Everything is frame-based sprite animation on a **6fps or 12fps** timeline. No tweening, no easing curves, no interpolated positions. Pixel art moves in whole pixels.

**Agent chips** — 4 states, 4 frames each unless noted:
- `idle` — a slow 2-frame LED breathe, 1 frame every 500ms
- `thinking` — a 4-frame cycle of light chasing around the chip's pin legs
- `working` — 6-frame, faster chase + 2px of dithered heat shimmer above the package (dither, never blur)
- `fault` — 2-frame red LED blink at 2Hz, plus a hairline crack overlay on the package

**Little character animations** (your ask): each agent chip has an optional **8×8 sprite "occupant"** that pops up from the package during `working` — a tiny hard-hat figure that hammers, a figure that drags a file to the socket when an artifact is produced, a figure asleep with a `z` during long idle. 4-frame loops, 3 characters shipped at M5, more can be added as pure asset drops with no code change (they're declared in `assets/sprites/manifest.json`).

**Traces** — a `packet` is a 3×3 signal-colored blob that travels the trace path at 1 tile per 100ms when its source node emits an event. Direction indicates data flow. Packets are pooled and capped at 40 on screen; excess events increment heat without spawning a sprite.

**Heat** — 4 discrete glow steps, implemented as **palette swap plus a Bayer 4×4 dithered halo mask**, never a blur filter. A temp readout (`36.2°C SIM`) appears in silkscreen beside a node only above glow step 2, and only in the inspector otherwise.

**Room transition** — a hard-edged 8-step iris wipe in mask-dark, 400ms total.

**Reduced motion** — a settings toggle drops all idle animation, packets, and shimmer; state is then conveyed by LED color alone.

## Anti-mush rules (hard requirements)

These exist because the number one failure mode of a project like this is art that looks smeared and generated. All of it is machine-checkable, and `npm run validate:assets` fails the build on violation.

1. **Alpha is binary.** Every pixel is `alpha == 0` or `alpha == 255`. No feathered edges.
2. **Palette lock.** Every pixel must exactly match a hex in `assets/palettes/skynet.gpl`. Max 6 unique colors per sprite.
3. **Authored at 1x.** Source sprite dimensions must be multiples of 8. Never upscale source art and re-save.
4. **Integer scaling only, above 1x.** Working zoom ∈ {1,2,3,4,5,6,7,8}. Camera x/y rounded to device pixels each frame. `roundPixels: true`.

   > **Widened 2026-09-11** at William's request for "more finite zoom levels". The integers
   > run to **8x**, for reading a node's pixels up close, and a third overview level, **1/8**,
   > joins the two below. Still only exact factors: a whole number maps each world pixel to an
   > N×N block, and a power-of-two fraction samples every Nth pixel. Keys 1 to 8 jump straight to
   > that zoom; the wheel and `-`/`=` step through all eleven levels.

   > **Amended 2026-09-11.** Two overview levels sit below 1x: **1/2** and **1/4**, for seeing a
   > whole tripled board at once (key `0` picks the closest one that fits). They are exact binary
   > fractions, still nearest-neighbour, still on whole device pixels, so every pixel on screen is
   > still an exact palette colour with binary alpha, and the sampling phase is fixed, so panning
   > does not shimmer (test/camera.test.ts). What they give up is completeness: a downscale drops
   > pixels, so a 1px trace can vanish and silkscreen is illegible. They are for seeing layout, not
   > for reading it. An arbitrary fraction (0.75, "fit exactly") remains a bug.
5. **Nearest-neighbour everywhere.** Pixi `scaleMode: 'nearest'`, CSS `image-rendering: pixelated` on any DOM that shows sprites, mipmaps off.
6. **No blur/bloom/drop-shadow filters.** Not in Pixi, not in CSS. Glow is achieved with palette ramps and dither masks.

   > **The room look, added 2026-09-11: one deliberate, user-chosen exception to rule 2.** A room
   > may set `look.hue` / `saturation` / `brightness` / `contrast`, applied as a CSS colour filter
   > on the board canvas only. These are per-pixel colour matrices: nothing blurs, nothing moves,
   > nothing is resampled, so rules 1 and 3–7 still hold. What does not hold while one is set is
   > the palette lock. A hue-rotated copper is not copper. William asked for exactly that; it is
   > off by default, and a room with no look carries no filter at all. The look's vignette is NOT
   > an exception: it is an ordered dither of one palette colour at integer scale, and its tiled
   > floor goes through the same palette dither as a backdrop. See docs/DECISIONS.md 2026-09-11.

   > **The animated JARVIS-face logo, added 2026-09-11: a second user-chosen exception to rule 2.**
   > A node whose `logoSource` is `avatar-live` shows William's avatar frames in their OWN colours,
   > not dithered onto the room's palette, as the face window composes them: mask-dark ground, a
   > 1 px copper-dark edge, the face, its float, blinks and mouth, in the node's logo box. Every
   > other rule holds. Alpha stays binary (the validator already requires it of the frames), the
   > float moves in whole pixels, and the face is drawn nearest-neighbour in world space at the
   > largest whole-number scale that fits the box. A box smaller than one frame takes every 2nd,
   > 3rd, … pixel, an exact decimation like the overview zooms, never a smoothed resample.
   > William asked for the face "as a logo graphic", in the face window's own look. It is opt-in
   > per node, and `avatar`, the still face, stays dithered like any other logo. **GIF wallpapers
   > and logos are NOT an exception:** every frame goes through the same palette dither as a
   > still. See docs/DECISIONS.md 2026-09-11.
7. **No rotation off 90°.** Sprites rotate only in 90° steps. Diagonals are pre-drawn, never rotated.
8. **Text is bitmap.** Departure Mono at 11/22px, or a Pixi BitmapFont. No sub-pixel antialiasing (`-webkit-font-smoothing: none`).
9. **The window is not fractionally scaled.** On launch, read `screen.getPrimaryDisplay().scaleFactor` and call `webContents.setZoomFactor(1 / scaleFactor)`. Electron computes the renderer's `devicePixelRatio` as `osScaleFactor × zoomFactor`, so this drives it to exactly **1**: one CSS pixel becomes one device pixel and every integer camera zoom is exact at any OS scaling. Re-apply on the window's `moved` event, because a second monitor can have a different scale factor. Log the values.

   > **Consequence for the DOM chrome, added 2026-09-09.** Forcing `devicePixelRatio` to 1 means
   > one CSS pixel is one *device* pixel, so on a 200% display all the HTML chrome came out at
   > half its intended physical size — 11px silkscreen rendered 11 device pixels tall instead of
   > 22. Correct, and unreadable. The chrome therefore carries its own **integer** scale
   > (`--ui-scale`, set from the same OS scale factor the board cancels); every chrome dimension
   > is a whole multiple of it and every font size a whole multiple of 11px.
   >
   > Rule 8's `-webkit-font-smoothing: none` is also a **no-op on Windows** — Chromium renders
   > text through DirectWrite and ignores it. A screenshot census found real LCD colour fringes
   > in the HUD. The working controls are the Chromium switches `--disable-lcd-text` and
   > `--disable-font-subpixel-positioning`, set in `src/main/index.ts` before any window exists.
   > After that: **zero colour fringes** anywhere, measured. Glyph edges in the chrome still
   > carry greyscale antialias blends, which the browser's text stack owns and we do not — so
   > the palette-purity guarantee is scoped to the **canvas**, where it is verified pixel by
   > pixel. Board silkscreen is thresholded to binary alpha in `renderSilkText` precisely so it
   > never depends on any of this.

   > **Corrected 2026-09-09 (M0).** This rule used to say "snap to the nearest workable integer" zoom. That is not always possible: at Windows' 125%, `1.25 × N` is a whole number only for N ∈ {4, 8, 12}, so zoom 2 and zoom 3 — two of the three documented zoom levels — have no workable snap at all. Cancelling the OS scale instead of constraining the zoom fixes every scale factor with one line. Confirmed in the M0 smoke capture: on this machine, at OS scaling **200%**, `devicePixelRatio` reads 1 and the rendered board contains exactly four colours, all exact palette entries, at zoom 2x, 3x and 4x.
10. **Screenshot diff test.** A Playwright test renders a fixture board and pixel-diffs it against a golden PNG at 0% tolerance. Any accidental filter or resample breaks it loudly.

## Chrome icons

The chrome's controls carry a pixel icon beside their words (`src/renderer/ui/Icon.tsx`).

- **How they are drawn.** Each is a 9x9 bitmap written as text rows, drawn as whole-pixel SVG rects
  with `shapeRendering="crispEdges"` and `fill="currentColor"`, at `9 × --p`. An icon takes the
  colour of the text beside it, stays sharp at every chrome scale, and brings no colour of its own
  into the palette.
- **They never stand alone.** An icon is `aria-hidden` and is never the only label: its button keeps
  its word. An icon-only button (the HUD's find, bell and gear; the minimap's controls) carries a
  `title` and an `aria-label` instead.
- **One glyph per meaning, reused.** `stop` is Kill and Stop everywhere; `close` is every close.
- **Adding one.** Add its rows. `test/icons.test.ts` checks that every icon is 9x9, has at least 5
  lit pixels, and duplicates no other.

## The chrome's layout manager

The docked chrome must never cover itself: the breadcrumb, HUD, usage meter, left stack, minimap,
toasts, LOOK and the help line. `ui/chrome-layout.ts` decides; `ui/useChromeLayout.ts` measures and
applies. The rules:

- **The HUD keeps to one line.** It goes compact, with a +N list, rather than wrapping into the row
  below.
- **What gives way, lowest priority first:**
  1. the help line;
  2. the minimap, to its button, shown in warn;
  3. the usage meter, to its header;
  4. the session dock, to its header.
- **Toasts and LOOK make room.** Toasts stack above whatever holds the bottom-right corner, and LOOK
  stops above it.
- **The user's own fold or hide always holds**, and each panel has one.
- **Every offset stays a whole pixel.** Offsets the planner computes are whole pixels, and the
  inspector's width is rounded down to a multiple of `--p` when a narrow window shrinks it.

A new docked panel belongs in `planChrome`'s inputs and in the smoke layout probe's `CHROME` list
(`src/main/index.ts`). Then `npm run smoke:shots` shows whether it collides with anything.

### THE MATRIX

*(Added 2026-09-12.)* THE MATRIX (`G`, or the MATRIX button beside MANUAL) is a 3D globe, and it keeps every
rule above by drawing the 3D itself rather than asking Canvas2D or WebGL to. `src/renderer/matrix/MatrixView.tsx`
rasterises its polygons and lines into a buffer of about 280 rows, writing only exact colours: the room's
`mask-dark`, `mask-light` and `signal`, and `silk` for the file in the middle. Coverage is binary and shading
is a 4×4 Bayer dither. The buffer is shown at a whole number of device pixels per pixel with
`image-rendering: pixelated`. Canvas2D's own paths antialias their edges, which would put pixels on screen that
are in no palette; WebGL would need the same fight with its filtering. The words over the globe are DOM chrome
text and held to the chrome's standard, on the ground colour so the dither behind them does not eat them.

## Writing on the board

Copy on the board is engraved industrial labelling, not UI marketing copy.

- Room shields: `MINECRAFTOS`, `DEDUCTIONOS` — engraved, uppercase, that is the one place uppercase is correct.
- Chip part numbers: `CC-STALKER`, `CC-PACEKEEPER`, `JARVIS-01`.
- Reference designators next to components, like a real board: `U4`, `J2`, `D7`. They're assigned automatically per room and are a genuinely useful way to refer to a node in conversation with an agent ("what's U4 doing").
- Buttons in the DOM chrome say what happens: `Launch session`, `Open in Explorer`, `Reveal newest jar`. Not `Submit`, not `Go`.
- Empty room: `NO COMPONENTS PLACED — PRESS E TO EDIT BOARD`. Failure on a node: `TARGET NOT FOUND — C:/dev/TheStalker/build/libs/*.jar`. State what's wrong and where, in the board's voice.
