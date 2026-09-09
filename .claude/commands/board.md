---
description: Modify board JSON safely
---
Requested change: $ARGUMENTS

1. Snapshot: copy affected board files to board/.snapshots/<timestamp>/
2. Make the change. Obey docs/02-VISUAL-LANGUAGE.md for placement: 16px grid, no footprint overlaps, sane trace routing.
3. Run `npm run validate:board`. Fix anything it reports.
4. Show me the git diff of the board files.
5. Wait for my approval before committing. Never delete a node without me saying the word delete in this exchange.
