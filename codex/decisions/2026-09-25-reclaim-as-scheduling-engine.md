---
date: 2026-09-25
status: proposed by the Face; CC-SECRETARY confirms in Phase 5
---
# Reclaim as the scheduling engine; explicit prep chains instead of Reclaim travel time

**Decision.** Reclaim schedules the flexible blocks (habits and tasks) inside hour schemes that forbid anything 23:00–07:30. Fixed anchors (PBS shifts, streams, off days) and their prep chains are written as explicit events on `Work – Shifts`, `Work – Prep Blocks` and `[MAIN]`, because the chain (shower 25, gear 10, drive 5, walk 10) is deterministic and Reclaim's travel-time guesser is not. The official Reclaim MCP (`https://mcp.reclaim.ai`) is the write path; the unofficial `reclaim-mcp` is added only for habit CRUD if the official server lacks it.

**Alternatives rejected.** Building a scheduler inside SkynetOS (a solved problem; Reclaim is already paid for). Relying on Reclaim buffer time for PBS (opaque, and the events need names William can act on). Notifying through Reclaim and Google both (double notifications get dismissed).

**Precondition.** Timezone fix to `America/Denver` on every calendar and in Reclaim, before any import.
