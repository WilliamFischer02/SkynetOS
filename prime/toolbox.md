---
updated: 2026-09-23
purpose: What JARVIS Prime can reach from a session, and where things live. Read before searching.
---

# Toolbox

## The skynet MCP server (`tools/skynet-mcp.mjs`, needs SkynetOS running)

Every call goes through `callAsAgent` in `src/main/ipc.ts` against `AGENT_METHODS`. The server has
no authority of its own. When SkynetOS is closed, or its `control.json` was replaced by a smoke run,
every tool answers SKYNETOS IS NOT RUNNING; restart the app.

| Tool | Use | Notes |
|---|---|---|
| `board_list`, `board_read`, `board_resolve` | Read rooms, nodes, resolved targets | Always allowed |
| `node_create`, `node_update`, `node_move`, `node_fields` | Place and edit nodes | Snapshot first, diff shown; rooms default to `require-approval`, which raises a dialog. Unattended: edit the JSON on disk instead (playbook) |
| `node_delete`, `edge_delete` | — | Always a dialog; never unattended |
| `edge_create` | Wire nodes | |
| `phantom_list`, `phantom_propose`, `phantom_withdraw` | Recommended nodes, ~4 per room, a fifth is refused | Withdraw only my own |
| `mailbox_read`, `mailbox_send`, `mailbox_archive` | The wire to the Face | `mailbox_send` side `to-face`, signed `hands` since 2026-09-11 |
| `session_list`, `session_start`, `session_stop` | Sessions on agent nodes | Never elevated; a scheduled run's sessions are capped |
| `terminal_open`, `open_target` | Open a terminal or a node's target | User-visible; use sparingly unattended |
| `classify_path`, `system_info`, `history` | Path class, machine, undo history | Read-only |
| `usage_routes`, `usage_summary` | Claude usage as this machine sees it | Per machine, not per account (docs/06 item 5) |

## Connectors in this Claude Code session (claude.ai, not SkynetOS)

Loaded through `ToolSearch("select:…")`, one call, comma-separated. Present on 2026-09-23:

- **Gmail** (`mcp__claude_ai_Gmail__*`): search, read, labels, drafts, trash, send. Rules for what
  I may do with it: `codex/briefs/email-triage.md` and `docs/10-EMAIL.md`. Unattended: read and
  label only.
- **Google Calendar, Google Drive**: read and write William's calendar and files. Not yet used.
- **Claude Docs**: living documents on claude.ai.
- **Microsoft 365** (`mcp__plugin_sales_microsoft-365__authenticate`): present, NOT authenticated.
  The road to Outlook.com mail.
- **Browser (Claude in Chrome)**: drives William's Chrome. Useful for reading a page he is looking
  at; not for logging into anything of his.
- Neon, Supabase, Vercel, Webflow (site ops for goobscott-productions.com), Indeed, and the plugin
  packs (sales, marketing, legal…). Present; irrelevant to most SkynetOS work.

Whether a session SkynetOS launches on a chip carries these connectors is **unverified**: they are
Claude Code's own configuration, not the board's. Check `claude mcp list` in such a session.

## npm scripts that matter

| Script | What |
|---|---|
| `verify` | typecheck, validate:board, paths:check, assets:bake, validate:assets, vitest. Green or nothing ships |
| `validate:board`, `paths:check`, `paths:portable` | Boards against the schema; portable `%SKYNET%`/`%USERPROFILE%` paths; rewrite absolute ones |
| `board:overlap` | `prime/tools/board-overlap.ts`: mounted nodes that overlap or leave the grid, every board |
| `board:snapshot -- <label>` | `prime/tools/board-snapshot.ts`: copy `board/` to `board/.snapshots/<stamp>-<label>/` before an on-disk edit |
| `finance:report` | `tools/finance-report.ts`: the ledger summary from `private/finance/` (2026-09-23, see docs/06) |
| `smoke:shots` | Screenshots only, safe beside a running app. `smoke` is NOT: it edits the real board |
| `face:bake` | Rebuild `FACE-BOOT.md` for the Face |
| `boot` | Build and start a refreshed SkynetOS; the open copy hands over |
| `dev` | electron-vite with HMR for the renderer. Main-process changes need a restart |
| `pack`, `release`, `install:local` | The installed program, docs/09 |

## Where things live

| Thing | Path |
|---|---|
| Board JSON, one file per room | `board/root.board.json`, `board/<room>/room.board.json` |
| Schema | `schema/board.schema.json`; types in `packages/shared/types.ts` |
| Pure logic, tested | `packages/shared/*.ts` ↔ `test/*.test.ts` |
| Main process services | `src/main/services/*.ts`; the IPC allowlists in `packages/shared/ipc.ts` |
| Renderer | `src/renderer/ui/*.tsx` (not unit-testable: no DOM in vitest) |
| Runtime state | `%APPDATA%/SkynetOS/`: `settings.json` (no write channel), `skynet.db`, `control.json`, `launch/` (every launch script and pid), `scheduler-state.json`, `remote-audit.log` |
| Briefs for scheduled runs | `codex/briefs/*.md` |
| Personas | `codex/personas/*.md` |
| The Face's mail | `codex/mailbox/to-face/`, `to-hands/`, `archive/` |
| Private data (gitignored) | `private/finance/`, `private/email/`, `private/prime/` |
| My memory across sessions (Claude Code's, outside the repo) | `%USERPROFILE%/.claude/projects/C--dev/memory/` |
