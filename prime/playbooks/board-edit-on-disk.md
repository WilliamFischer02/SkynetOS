---
updated: 2026-09-23
---

# Playbook: editing a board on disk

When to do this instead of the MCP tools: nobody is at the screen to answer `require-approval`
dialogs, or the edit is dozens of nodes. Precedent: the MinecraftOS mod grid (2026-09-15) and the
room restyle (2026-09-11).

1. `npm run board:snapshot -- <label>`. It copies every board file to
   `board/.snapshots/<stamp>-<label>/`, the shape the command bus uses. Ctrl+Z will NOT undo an
   on-disk edit; this snapshot and `git checkout board/` are the two ways back. Say so in the handoff.
2. Read the target board whole once. Note `grid.width`/`grid.height`, the theme, and the ids in use.
3. Edit with a script or targeted edits. **Never a read-modify-write of a whole file while another
   agent may be editing the same board** (fork C overwrote fork A's board on 2026-09-11). One agent
   per board file at a time.
4. Ids: lower snake case, unique across the board; designators (`U3`, `S4`, `T1`) unique too. A new
   node with no target sets `provisional: true`. Paths portable: `%SKYNET%/…`, `%USERPROFILE%/…`.
5. Mounted kinds occupy `footprintOf(node)`; printed kinds (`note.silk`, `group.zone`, `decor.*`)
   occupy nothing. Place in free space; keep to the 16px grid rules in docs/02.
6. Check: `npm run validate:board`, `npm run paths:check`, `npm run board:overlap`, then `npm run
   verify` (the router test routes the real boards).
7. The running app re-reads a room on its next `board:load`: leaving and re-entering the room shows
   the edit; the root board needs a restart or a reload (`R`).
8. Never remove a node. If one should go, mark it and say so; the delete is William's click.
