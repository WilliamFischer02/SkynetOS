---
description: Take a new node kind all the way through the stack
---
Implement node kind `$ARGUMENTS` as one complete vertical slice. Do not start another kind until this one is done.

1. Schema: add the kind and its conditional required fields to schema/board.schema.json
2. Types: add to packages/shared/types.ts, discriminated on `kind`
3. Default footprint and sprite key, per docs/02-VISUAL-LANGUAGE.md and docs/03-NODE-TYPES.md
4. Renderer: draw it, including its live-state chrome (LEDs, labels, heat readout)
5. Resolve: what FileResolver does with its target
6. Click: primary action, plus the right-click menu from docs/03
7. Failure state: what it looks like and says when the target is missing. Design this, don't skip it.
8. Fixture: add one to a board file; `npm run validate:board` passes
9. Test: vitest for resolution logic, Playwright smoke test if it crosses IPC
10. Docs: update docs/03-NODE-TYPES.md if reality diverged from the spec

Report which of the ten are done and which are not. Partial is fine; silent partial is not.
