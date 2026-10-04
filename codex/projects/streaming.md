---
updated: 2026-09-30
status: active — Streamer.bot fixes landed 2026-09-30; Discord, Twitch bio, VOD pipeline, two graphics queued
owner-node: U3 (JARVIS-PRIME) until a STREAM room exists
---

# Streaming (Bingus the Wizard)

**Identity.** William streams as BingusTheWizard on Twitch. Streamer.bot (`C:/dev/StreamerBot`) runs
chat commands, alerts and timers against OBS (collection `STREAM 2026 V3`) over obs-websocket on
127.0.0.1:4455. A local relay (`C:/dev/Stream/stream-tools`, Node, port 8791) draws polls and a popup
announcer into OBS browser sources. Overlays and clips live on `Z:/01_PROJECTS/OBS Overlays/`.

**Log and reference:** `C:/dev/Stream/STREAMERBOT-SETUP.md` (what was fixed, the export ids for editing
`actions.json` by hand, the queue). Both programs must be CLOSED before their files are edited; each
rewrites its file on save.

## State

- 2026-09-30: first-chatter repeat, `Title set: %rawInput%`, and the 10-minute schedule graphic fixed by
  editing `actions.json` and the OBS scene collection (backups beside both). Not yet seen running:
  William reopens both and tests (Streamer.bot → SHOW_Schedule → Test Trigger; timer at 15 s).

## Next

1. Discord bot: auto-role on join, go-live announcements, welcomes (Streamer.bot has a Discord webhook
   sub-action; roles and welcomes need a bot: decide between a small self-hosted bot and an off-the-shelf
   one).
2. Twitch about / description / bio.
3. VOD → YouTube pipeline (limits: YouTube 12 h per video, verified account; Twitch VOD retention).
4. Returning-chatter shoutout graphic (consecutive streams: needs a per-user last-seen store).
5. Chat-phrase sound board and its phrase list.

## Landmines

- `actions.json` sub-action `type` ids are numeric and undocumented; the table in STREAMERBOT-SETUP.md
  was read from a scratch action William made. A wrong id is silently ignored.
- The stream-tools folder contains a stale nested copy (`stream-tools/stream-tools/`, `streamerbot/`);
  not deleted (docs/07).
