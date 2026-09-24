---
name: obsidian
updated: 2026-09-11
status: active
purpose: The Obsidian knowledge profile. Inlined into the briefing of every Obsidian-aware session (tagged `obsidian`, or bound to a path inside a vault). See packages/shared/obsidian.ts.
---

# Obsidian — knowledge profile

William works in Obsidian and wants to build plugins for it, "to create further representations of
my notes, projects and thoughts." Any agent reading this is working in or near one of his vaults.
Everything below is how Obsidian actually behaves. When a detail here and the vault disagree, the
vault wins: read its `.obsidian/` first.

## 0. The rules that override everything else

- **Never delete a note, attachment or folder.** Obsidian's own trash is `.trash/` inside the
  vault; SkynetOS does not use it either. "Clean up" means move, with William's approval.
- **Never overwrite a note wholesale.** Edit in place and keep what you did not mean to change,
  frontmatter above all. New content goes in a new note or under a new heading.
- **Never rename or move a note from outside Obsidian if other notes link to it.** Outside the
  app nothing updates the links. Obsidian updates them only when the rename happens inside it
  (`fileManager.renameFile` in a plugin). Ask first, or leave a note saying what should move.
- **Never edit `.obsidian/workspace*.json`, a plugin's `data.json`, or `.smart-env/`** while
  Obsidian may be open. The app rewrites them from memory and your edit is lost, or worse, merged.
- **Personal notes are personal.** Read only what the task needs. Never quote a note's content
  into anything outside the vault: the SkynetOS repo and its codex are public.

## 1. Anatomy of a vault

A vault is just a folder of Markdown files. It is a vault because it contains `.obsidian/`:

| Path | What it holds |
|---|---|
| `.obsidian/app.json` | Editor and file settings: `attachmentFolderPath`, `alwaysUpdateLinks`, `newLinkFormat`, `useMarkdownLinks`, `promptDelete` |
| `.obsidian/core-plugins.json` | Which built-in plugins are on (daily-notes, templates, canvas, bases, properties, sync…) |
| `.obsidian/community-plugins.json` | Ids of enabled community plugins |
| `.obsidian/plugins/<id>/` | `manifest.json`, `main.js`, `styles.css`, and the plugin's settings in `data.json` |
| `.obsidian/daily-notes.json` | `folder`, `format` (moment.js; default `YYYY-MM-DD`), `template`, `autorun` |
| `.obsidian/templates.json` | Core Templates: `folder`, `dateFormat`, `timeFormat` |
| `.obsidian/types.json` | Vault-wide property types, e.g. `{"types": {"due": "date"}}` |
| `.obsidian/workspace.json` | Open panes and layout. The app owns it; never hand-edit it |
| `.obsidian/snippets/*.css`, `themes/` | CSS snippets and installed themes |

Obsidian watches the folder. A file written from outside appears in the app within a second or
two, and a note edited outside while it is open in an editor pane can collide with the app's
autosave (it writes about two seconds after the last keystroke). Prefer creating new files.
Otherwise write the whole file once, atomically, and not into the note William has open.

## 2. Properties (YAML frontmatter)

The block between the first two `---` lines. The Properties view types each key:

| Type | YAML | Example |
|---|---|---|
| Text | string | `status: draft` |
| List | block or flow list | `projects:` then `  - SkynetOS` |
| Number | number | `tokens: 812000` |
| Checkbox | boolean | `done: false` |
| Date | `YYYY-MM-DD`, unquoted | `date: 2026-09-11` |
| Date & time | `YYYY-MM-DDTHH:mm[:ss]`, unquoted | `created: 2026-09-11T22:04:00` |

- The keys Obsidian itself reads: **`tags`**, **`aliases`** and **`cssclasses`**, all lists. The
  singular forms `tag`, `alias` and `cssclass` are deprecated.
- A type is per KEY across the whole vault (`types.json`), so the same key must always carry the
  same kind of value.
- Quote a string that YAML would misread: `"yes"`, `"12:30"`, anything starting with `#`, `[`, `{`,
  `*`, `&`, `!`, `|`, `>`, `%` or `@`, and anything containing `: `.
- Edit frontmatter as data, never with a regex over text. In a plugin use
  `app.fileManager.processFrontMatter(file, fm => { … })`. Outside, parse the YAML, change the key,
  and write it back with every other key unchanged.

## 3. Tags

- **Inline** `#tag` anywhere in the body. **In frontmatter**, `tags:` as a list, without the `#`.
- **Nested**: `#project/skynetos`. Searching `tag:#project` also finds the children.
- **Allowed characters**: letters of any script, digits, `_`, `-`, and `/` (for nesting only). No
  spaces. At least one non-digit (`#1984` is not a tag; `#y1984` is).
- **Case-insensitive** for matching; the tag pane shows the first spelling it met. So `Writing` and
  `writing` are one tag written two ways. Match the vault's existing spelling.
- A `#` inside inline code or a code fence is not a tag, and neither is a heading (`# Title`).
- **Tag awareness**: before adding a tag, look at the vault's existing vocabulary (the tag pane,
  or scan its notes) and reuse an existing tag over minting a near-duplicate. Follow the vault's
  style: flat CamelCase, kebab-case, or nested.

## 4. Links, embeds, callouts

- `[[Note]]`, `[[Note#Heading]]`, `[[Note#^block-id]]`, `[[Note|shown text]]`. A block id is
  `^block-id` at the end of the paragraph.
- **Embeds**: `![[Note]]`, `![[Note#Heading]]`, `![[image.png|300]]` (width), `![[file.pdf#page=3]]`.
- Links resolve by the shortest unique name unless `newLinkFormat` says otherwise. A link to a
  note that does not exist is legal and shows as "unresolved".
- **Callouts**: `> [!note] Title` then `>` lines. The types are:
  - note, abstract/summary/tldr, info, todo, tip/hint/important;
  - success/check/done, question/help/faq, warning/caution/attention;
  - failure/fail/missing, danger/error, bug, example, quote/cite.
  `> [!tip]-` starts folded and `> [!tip]+` foldable but open.

## 5. The plugins that change what a note means

**Dataview** (installed in SolidState):

- **Queries**, in a code block tagged `dataview`:
  ````
  ```dataview
  TABLE file.mtime AS "Modified", status
  FROM #Writing AND "02 Professional"
  WHERE status != "done"
  SORT file.mtime DESC
  LIMIT 20
  ```
  ````
- **Query types:** `LIST`, `TABLE`, `TASK` and `CALENDAR`.
- **Inline fields:** `key:: value` on its own line, or `[key:: value]` and `(key:: value)` mid-line.
- **Implicit fields:** `file.name`, `file.path`, `file.folder`, `file.ctime`, `file.mtime`,
  `file.tags` (with parents expanded), `file.etags`, `file.inlinks`, `file.outlinks`, and
  `file.day` (a date parsed from the file name).
- **Inline query:** `` `= this.file.name` ``. **DataviewJS:** `dv.pages('#tag')` and `dv.table()`.

**Templater** (installed):

- `<% tp.date.now("YYYY-MM-DD") %>`, `<% tp.file.title %>` and `<% tp.frontmatter.status %>`.
- JavaScript runs in `<%* … %>`.
- It runs when a template is inserted, not when a file appears from outside, unless "trigger on
  file creation" is on.
- Core Templates is simpler: `{{date:YYYY-MM-DD}}`, `{{time}}` and `{{title}}`.

**Daily notes** (core): `daily-notes.json` decides the folder, name format and template. Periodic
Notes (community) adds weekly, monthly and yearly notes, e.g. `gggg-[W]ww`.

**Also in SolidState:**

- **Linter** can rewrite YAML when a note is saved.
- **Tag Wrangler** renames tags vault-wide, which is the safe way to merge two spellings.
- **Tasks** gives `- [ ]` lines dates and recurrence.
- **Kanban** boards are Markdown files with their own frontmatter; leave it alone.
- **Obsidian Git** makes vault backup commits.
- **Smart Connections** keeps embeddings in `.smart-env/`.
- **Excalidraw** drawings live in `Excalidraw/`.
- **QuickAdd** and **Homepage** are also installed.

## 6. Canvas, Bases, URI

- **Canvas** (`.canvas`) is JSON Canvas, an open format:
  - top level: `{"nodes": [...], "edges": [...]}`;
  - a node: `{id, type: "text"|"file"|"link"|"group", x, y, width, height, color?}`, plus `text`, `file`, `url` or `label` by type;
  - an edge: `{id, fromNode, fromSide?, toNode, toSide?, fromEnd?, toEnd?, color?, label?}`;
  - `color` is `"1"`–`"6"` or a hex.
  Keep ids unique and never drop nodes you did not add.
- **Bases** (`.base`, a core plugin): YAML that defines filters and table or card views over note
  properties. It is newer than most documentation. Check the installed Obsidian version and an
  existing `.base` file before writing one.
- **Obsidian URI**: `obsidian://open?vault=<name>&file=<path>`,
  `obsidian://new?vault=<name>&file=<path>&content=<text>`, and `obsidian://search?vault=&query=`.
  Everything must be URL-encoded. It is how SkynetOS could hand a note to the app rather than open
  the file raw.

## 7. Sync and conflicts

All three of William's vaults sit in OneDrive, and the Obsidian Sync core plugin is enabled too.
Two sync systems on one folder is how conflict copies are born. OneDrive leaves them as
`name-DESKTOP-XXXXXXX.ext` or `name - Copy.ext`, and SolidState's `.obsidian/` already has several.
Never "fix" a conflict copy by deleting either side; report it and let William choose. Write files
whole and let OneDrive settle; many small rapid writes to one file invite conflicts.

## 8. Plugin development

- **Start from `obsidianmd/obsidian-sample-plugin`:**
  - `manifest.json` holds `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `authorUrl` and `isDesktopOnly`;
  - `main.ts` is bundled by esbuild (`esbuild.config.mjs`) to a CommonJS `main.js`, with `obsidian`, `electron`, `@codemirror/*` and `@lezer/*` external;
  - `styles.css`, and `versions.json` mapping each plugin version to its minAppVersion;
  - `npm run dev` watches, and `npm run build` typechecks and bundles.
  The repo lives under `C:/dev`, never inside a vault.
- **Dev loop:**
  1. Keep a separate DEV vault.
  2. Junction the repo into it: `mklink /J "<dev vault>\.obsidian\plugins\<id>" "C:\dev\<repo>"`.
  3. Turn off Restricted mode and enable the plugin.
  4. Install pjeby's **Hot-Reload** plugin, which reloads yours whenever `main.js` changes; the plugin folder needs a `.hotreload` file or a `.git` folder.
  5. Ctrl+Shift+I opens the devtools console.
  Never develop against SolidState.
- **The Plugin class:**
  ```ts
  export default class MyPlugin extends Plugin {
    settings: MySettings;
    async onload() {
      this.settings = Object.assign({}, DEFAULTS, await this.loadData());
      this.addCommand({ id: 'do-thing', name: 'Do the thing', editorCallback: (editor, view) => { /* … */ } });
      this.addRibbonIcon('network', 'Open graph view', () => this.activateView());
      this.registerView(VIEW_TYPE, (leaf) => new MyView(leaf, this));
      this.registerMarkdownCodeBlockProcessor('skynet', (source, el, ctx) => { /* render */ });
      this.registerMarkdownPostProcessor((el, ctx) => { /* decorate rendered notes */ });
      this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => { /* … */ }));
      this.addSettingTab(new MySettingTab(this.app, this));
    }
    onunload() { /* everything registered with register* is cleaned up automatically */ }
  }
  ```
- **Views**: `class MyView extends ItemView` with `getViewType()`, `getDisplayText()`, `onOpen()`
  (render into `this.contentEl`) and `onClose()`. Open one with
  `workspace.getRightLeaf(false)?.setViewState({ type, active: true })` and `workspace.revealLeaf()`.
- **The APIs that matter:**
  - `app.vault.getMarkdownFiles()`, `cachedRead(file)` and `create(path, text)`;
  - `app.vault.process(file, fn)` for atomic read-modify-write, preferred over `modify`;
  - `app.fileManager.processFrontMatter(file, fn)`;
  - `app.fileManager.renameFile(file, path)`, which updates links (`vault.rename` does not);
  - `app.metadataCache.getFileCache(file)` for frontmatter, tags, links, headings, blocks and sections;
  - `getAllTags(cache)`, `metadataCache.resolvedLinks` and `unresolvedLinks`, and `getFirstLinkpathDest(link, sourcePath)`;
  - `workspace.getActiveViewOfType(MarkdownView)` and `workspace.onLayoutReady(cb)`;
  - editor extensions are CodeMirror 6, through `registerEditorExtension`.
- **Settings**: a `PluginSettingTab` whose `display()` builds
  `new Setting(containerEl).setName(…).setDesc(…).addText(t => t.setValue(…).onChange(async v => { …; await this.plugin.saveData(this.plugin.settings); }))`.
  They are stored in the plugin's `data.json`.
- **Rules the review enforces:**
  - use `this.app`, not the global `app`;
  - never `innerHTML` user content; use `createEl`/`createDiv`;
  - no default hotkeys; sentence case in the UI;
  - clean up everything, which `register*` does;
  - `isDesktopOnly: true` whenever Node or Electron APIs (`fs`, `child_process`) are used.
- **Release:**
  1. A GitHub release whose tag is exactly the version (`1.0.0`, no `v`), with `main.js`, `manifest.json` and `styles.css` as assets.
  2. First release only: a PR to `obsidianmd/obsidian-releases` adding `{id, name, author, description, repo}` to `community-plugins.json`.
  3. Beta testers install from the GitHub repo with **BRAT**.

## 9. William's vaults (on William-Desktop, 2026-09-11)

| Vault | Notes | Role |
|---|---|---|
| `%USERPROFILE%/OneDrive/Documents/SolidState Sync` | ~220 | The main one. Folders `00 Inbox` (attachments land here), `01 Personal`, `02 Professional`, `03 Research`, `04 Resources`; templates in `04 Resources/NOTE TEMPLATES` |
| `%USERPROFILE%/OneDrive/Documents/WilliamCloud` | ~35 | Older (2024): `Spaces/`, several canvases |
| `%USERPROFILE%/OneDrive/Documents/Obsidian Vault` | 1 | The starter vault; only `Welcome.md` |

SolidState's conventions:

- **Tags** are flat CamelCase (`Writing`, `Career`, `LifeGoals`) in the frontmatter list form.
- **The template's keys** are `aliases`, `tags` and `URL`.
- **Daily notes** go to `01 Personal/-a- JOURNAL`. That folder holds his own numbered, titled
  personal entries, so SkynetOS's journal writes into a `SkynetOS/` subfolder of it and never
  among them.

## 10. Calibration

| Situation | Wrong | Right |
|---|---|---|
| Asked to tag a note | Adds `#writing` beside an existing `Writing` | Reuses `Writing`, in the frontmatter list, the vault's way |
| Asked to rename a note | Renames the file on disk | "Renaming this breaks 14 links; rename it in Obsidian, or shall I list them?" |
| Adding a property | Rewrites the YAML block from a template, dropping `URL` | Adds one key; every other key and its order is untouched |
| A conflict copy appears | Deletes the `-DESKTOP-` duplicate | Diffs the two, reports which is newer, asks |
| Asked for a plugin | Edits files inside `SolidState Sync/.obsidian/plugins` | A repo in `C:/dev`, junctioned into a dev vault, Hot-Reload on |
| Writing a date property | `date: "September 11"` | `date: 2026-09-11` |
| A Dataview query returns nothing | Rewrites the notes to match the query | Checks `FROM` (tag vs folder), then the field's type in `types.json` |
