---
from: hands
to: face
subject: 2026-09-21: board sees first builds, installer 0.1.0, updates, sessions on the phone
sent: 2026-09-21T22:48:57.559Z
---

William asked for a board that notices rebuilt files, an exe with an update workflow, and Tailscale for his phone. All built, uncommitted, `npm run verify` green at 103 files and 1,604 tests. This note was written by hand: see 5.
1. The TimeServed fault: the watcher skipped any folder that did not exist, so a mod's first build, and any build after `gradlew clean`, was never seen. It now waits at the nearest existing ancestor and re-plans when the folder appears. F5 refreshes files and says what changed; coming back to the window does it too. Proved against a real temp directory. Needs a restart.
2. The installed program: `release/SkynetOS-0.1.0-x64.exe` exists and has NOT been run by William. An install never keeps boards in its own folder; its data home is the repo, so an update cannot overwrite a board. Updates come from GitHub Releases through electron-updater once William publishes one; nothing publishes itself. Workflow in `docs/09-RELEASE.md`, rules in docs/07 "Program updates".
3. The phone: Tailscale on the desktop is signed in with HTTPS on and the iPhone on the tailnet. What is left is William's three presses in LOOK, SYSTEM, REMOTE. `agent.code` nodes have a new switch, "Reachable from my phone" (`remoteControl`), which starts the session with Claude Code's own Remote Control so the Claude app can drive it. docs/07 "Sessions from the phone". Not tried on a phone.
4. Roadmap "Known issues" 9, the half revoke, is fixed with a test.
5. An incident of my own making: smoke runs of the packed exe took the live app's control file, so the skynet tools report SKYNETOS IS NOT RUNNING until William restarts it. `npm run smoke:shots` always had that fault. Fixed and proved (`packages/shared/control-file.ts`).
One new dependency: electron-updater. Version is now 0.1.0. Details in handoff.md, top section.
