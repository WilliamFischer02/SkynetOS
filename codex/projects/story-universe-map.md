---
updated: 2026-09-11
status: ACTIVE — Obsidian community plugin. NOT previously in the codex index (found during an away-mode survey; JARVIS had no board visibility into this repo before today).
purpose: What JARVIS needs to know about Story Universe Map to route sessions and track state.
---

# Story Universe Map

Obsidian community plugin: renders the notes in a folder (characters, stories, places, groups) as an
interactive force-graph map, sized by connectivity, coloured by note kind, with hover-to-preview
connecting sentences. Repo: `C:/dev/story-universe-map`. Standard Obsidian sample-plugin scaffold
(TypeScript → esbuild → `main.js`), `eslint-plugin-obsidianmd` wired into CI.

Its dev/test vault is `C:/dev/obsidian-dev-vault` (Sample Universe + Second Universe fixture notes,
hot-reload plugin installed) — not a separate project, just this plugin's harness. Use the
`obsidian-plugin-dev` skill for build/release work on this repo.

## Next (inferred — no `docs/handoff.md` or state doc found)

1. First session here should establish a handoff doc; `AGENTS.md` is generic sample-plugin
   boilerplate, not this project's actual state.
2. Confirm current build/lint/test status (`npm run build`, `npm run lint`) and whether it has
   passed an `eslint-plugin-obsidianmd` + community-directory review yet, per the skill's scope.
