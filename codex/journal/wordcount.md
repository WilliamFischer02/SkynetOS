# Weekly wordcount — StoryOS manuscripts

Written by T1 WEEKLY WORDCOUNT (`board/storyos/room.board.json`, node `t1_wordcount`, cron
`0 20 * * 0`). One section per week, appended, never rewritten: the next run reads the last
section for its baseline.

**Method.** `word/document.xml` is read out of the .docx; text is taken from `<w:t>` runs only,
tracked deletions (`<w:del>`) are dropped, paragraph, tab and break boundaries become spaces, and
the result is split on whitespace. Word's own stored figure (`docProps/app.xml` `<Words>`) is
listed beside it for reference; Word refreshes that only on some saves, so the ledger figure is the
one compared week to week. No Word process is started.

## Week ending 2026-10-25 20:00 (run 2026-10-26 11:22 MDT) — first entry, baseline

| Node | Board path | File counted | Words | Word's figure | Last modified | Delta this week |
|---|---|---|---|---|---|---|
| F1 Something In The Woods.docx | `C:/Users/REPLACE_ME/Documents/Novels/SomethingInTheWoods.docx` (does not exist) | `%USERPROFILE%/OneDrive/Documents/01 DOCUMENTATION/PANIC_NovelRoughDraft.docx` | 5,307 | 4,735 | 2025-06-23 13:12 | 0 |
| F2 Dirty Plush — manuscript | `C:/Users/REPLACE_ME/Documents/Novels/DirtyPlush.docx` (does not exist) | `%USERPROFILE%/OneDrive/Documents/01 DOCUMENTATION/Dirty Plush - Novel 063026.docx` | 8,988 | 7,395 | 2026-10-01 11:32 | 0 |
| F3 Series bible | `C:/Users/REPLACE_ME/Documents/Novels/DirtyPlush-bible.md` (does not exist) | none found | — | — | — | — |

- **Delta is 0 for F1 and F2** because neither file was written between 2026-10-18 20:00 and
  2026-10-25 20:00: file mtime and `dcterms:modified` agree (PANIC 2025-06-23, Dirty Plush
  2026-10-01 11:32, revision 2300). No earlier ledger exists, so there was no prior count to
  subtract; next week's delta is counted from the figures above.
- **All three document nodes still carry REPLACE_ME template paths.** The files counted are the
  ones the room's own phantoms `ph_panic_rough_draft` and `ph_dirty_plush_novel` name (proposed
  2026-09-11, unticked), and `C:/dev/jarvis-editor/config.json` names the same Dirty Plush file.
  No file for the series bible was found under `01 DOCUMENTATION` or `C:/dev/DirtyPlush`.
- Paragraph counts for the record: PANIC 253 `<w:p>` openers; Dirty Plush 409 (the editor's own
  reader, which also counts self-closing empty paragraphs, reported 355 on 2026-10-16 for the same
  file; different rule, not a change).
- The node's notes say this task had failed every week since 2026-09-28 as `jarvis.headless`; this
  is the first run to produce a figure.

**Next for William:** tick `ph_panic_rough_draft` and `ph_dirty_plush_novel` on StoryOS (two
clicks), so F1 and F2 point at the real files and the next run reads the board rather than its
phantoms.
