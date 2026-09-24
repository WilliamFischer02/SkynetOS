---
updated: 2026-09-11
status: ACTIVE
purpose: What JARVIS needs to work on Dirty Plush, a map of its repo, HUD and research library. State only; the book lives in the vault and the manuscript.
---

# Dirty Plush

An 8-chapter literary mystery, planned as an 8-episode limited series. Narrator: Det. Ray Vega. A
1994 case in "Escondida" (modelled on Escondido) and the Pala backcountry, framed by a 2024 prison
interrogation. The theme: truth and justice are not the same thing. The manuscript is a Word
document in William's OneDrive, bound to the board's DIRTY PLUSH document node. JARVIS does not
edit the manuscript.

## The repo and the HUD

- **Repo:** `DirtyPlush` (github.com/WilliamFischer02/DirtyPlush, **public**), cloned beside SkynetOS
  under the dev root.
- **What it is:** the *Writer's Panel*, a static React 18 + Vite 6 + Tailwind v4 app with five tabs:
  Setting Map, Timeline & Structure, Characters & Themes, Profile, and Resources. The binding
  internal contract is `docs/CONTRACT.md` in that repo; read it before changing the app.
- **The HUD:** the deployed build at `dirty-plush.vercel.app`, the board's "DIRTY PLUSH (HUD)" link
  node. It is behind a four-digit passcode gate that the README itself calls "a doorway, not a lock":
  it ships inside the bundle. **Never copy the passcode into the codex, mail or FACE-BOOT.** Both
  repos are public.
- **Local dev:** `npm install && npm run dev` in the repo, then http://localhost:5173.

## The vault (the book's data)

The panel reads and writes an Obsidian vault of plain files. `vault-sample/` in the repo is the
seed copy; William's real vault is wherever he connected it.

```
writers-panel-config.json   settings (manuscript links, optional Maps key)
arcs.csv                    one row per character arc
characters/*.md             one note per character (YAML properties + Markdown body)
timeline/events.json        the dual 1994 case / 2024 frame timeline
structure/beats.json        beats and chapters
map/locations.geojson       pins and regions, with period details
resources/resources.json    links: novel, case-file, writing
```

Rule of the vault: every researched 1994 value ships flagged **"estimate — verify"**. JARVIS follows
the same rule everywhere.

## The research library: `DirtyPlush/research/`

Populated 2026-09-11. Start at `research/README.md`.

| Folder | What is in it |
|---|---|
| `90s-escondido/documentation/` | 1990 census counts, DOF 1991–2000 population estimates, FBI *Crime in the US 1994* |
| `90s-escondido/resources/pala-mission-habs/` | HABS survey of Mission San Antonio de Pala |
| `california-detective-training-materials/` | NIJ scene, death and eyewitness guides; POST workbooks (git-ignored); Penal Code §§187–199 (current text); BJS 1993 police and 1988 murder statistics |
| `geography/maps/` | USGS topo quads: Escondido, Valley Center, Pala, Pechanga, Boucher Hill (1996–97), and Oceanside 1:100k (1982). Git-ignored for size. |
| `documents/weather-reports/` | Escondido daily weather Nov 1992–Dec 1995, NWS climate of San Diego, and the USGS Jan 1993 floods report. Its INDEX has the weather on every timeline date. |

## How JARVIS adds to it

1. **Download only through the tool:**
   `node tools/fetch-research.mjs <url> <DirtyPlush>/research/<folder> --license "..." --note "why it matters"`
   (SkynetOS repo; `npm run research:fetch -- ...`). It writes the file and its `SOURCES.json` line,
   refuses overwrites, and refuses an HTML page saved under a data name.
2. **Then add a row to that folder's `INDEX.md`:** file, what it is, why it matters to the book,
   source, licence, and whether it is a period source or later ("estimate — verify").
3. **Licence decides git.** Public domain or open licence: commit it (under 20 MB). No redistribution
   licence: add it to `research/.gitignore`. Over 20 MB: git-ignore it too, unless William has set up
   Git LFS.
4. **On another machine,** `node tools/fetch-research.mjs --restore <DirtyPlush>/research` re-downloads
   every recorded file that is missing and checks its sha256.
5. **Never delete** a research file. Flag a bad one in its INDEX; William removes it. One exists now:
   `documents/weather-reports/ncei-storm-events-…csv` is an HTML shell, not data.
6. **New research goes in the vault only by William's hand,** or on his explicit request.
   `resources/resources.json` is his.

## Open threads

- 1994 aerial photographs (USGS NAPP/DOQ): public domain, but need a free EarthExplorer login.
- 1990 Census SF1 detail for Escondido (race, Hispanic origin): needs a free Census API key.
- Period newspapers (the Times-Advocate): microfilm at the Escondido Public Library Pioneer Room.
- The research folder is not committed. Committing and pushing is William's call.
