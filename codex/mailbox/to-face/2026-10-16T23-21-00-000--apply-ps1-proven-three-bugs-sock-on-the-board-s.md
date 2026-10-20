---
from: hands
to: face
subject: apply.ps1 proven, three bugs, Sock on the board, six tasks switched on, mail redesigned
sent: 2026-10-16T23:21:00.000Z
---

William present, evening session. He cleared the Word recovery pane and saved, which unblocked the last link in the Word line editor.

apply.ps1 is proven against a live Word document on a throwaway copy: 2 edits in as 4 tracked revisions, 1 anchored comment, 0 skipped, timestamped backup first, TrackRevisions restored, markup toggle verified both directions. The first attempt failed and was worth more than the one that passed — it exposed three bugs, all fixed: the disk reader undercounted the manuscript by 35 paragraphs (a self-closing empty-paragraph tag eaten by the opener branch of its regex), export.ps1's count guard refused every real document so the live-Word read path had never once been used, and apply.ps1 could attach a comment to the wrong paragraph when its anchor was missing. The "find must match exactly once in that paragraph" rule is what kept a numbering bug that large harmless.

Board: f_sock_in_my_drawer (F8) added to root under WRITING & PUBLICATION, reads edge to STORYOS, bound to the real file. Written to board JSON directly because SkynetOS was closed — no undo entry, no snapshot; validate:board, board:overlap and verify all green after.

Scheduler: five tasks had never run once because they were disabled, and a sixth carried an action type the runtime refuses outright, failing weekly since 2026-09-28. William asked for all six. Verified by running planDispatch over all nine tasks on all seven boards: nine dispatch, zero refuse. Two caveats stand — the scheduler only ticks while SkynetOS is open and the app is closed, and the StoryOS manuscript nodes still point at REPLACE_ME paths.

Mail: the 2026-09-23 hub design is superseded. Two APIs over one taxonomy, and the agent may now file mail rather than only label it — two rows of the rules table widened, the rest unchanged and still binding. C:/dev/jarvis-mail holds both OAuth layers; nothing is authenticated and nothing has touched a live account. Secrets go under private/, gitignored.

He also asked about scheduled work "redirected to running CI tests locally on my laptop". Searched every repo under C:/dev: twelve workflows, all on GitHub-hosted runners, no self-hosted runner service, no actions-runner install, no Windows scheduled task, and the only git hook on this machine bakes FACE-BOOT.md and deliberately runs no tests. The laptop is not on the tailnet, so if that configuration exists it is on the laptop and not visible from here. Told him so rather than invent a cause.

Verify green: 154 files, 2,387 tests. Nothing committed.

Needs William: the two mail app registrations (his consent, not mine to ask for), SkynetOS left open so the scheduler can tick, and the first real editor pass over Dirty Plush.
