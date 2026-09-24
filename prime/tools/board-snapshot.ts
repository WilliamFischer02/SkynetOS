import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copy every board file to `board/.snapshots/<stamp>-<label>/` before an on-disk edit.
 *
 * The same shape `snapshot()` in src/main/services/board-store.ts writes before an agent mutation
 * through the command bus, for the edits that do not go through the bus: an unattended session
 * rewriting a room. `npm run board:snapshot -- <label>`. Never deletes anything; the app's own
 * 30-day retention is what prunes the folder.
 */
function main(): void {
  const label = (process.argv[2] ?? 'edit').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'edit';
  const root = join(process.cwd(), 'board');
  if (!existsSync(root)) {
    console.log('NO board/ FOLDER HERE — RUN FROM THE SKYNETOS REPO ROOT');
    process.exitCode = 1;
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(root, '.snapshots', `${stamp}-agent-${label}`);
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(root)) {
    if (entry === '.snapshots') continue;
    cpSync(join(root, entry), join(dest, entry), { recursive: true });
    copied++;
  }
  console.log(`snapshot: ${copied} entries → board/.snapshots/${stamp}-agent-${label}/`);
  console.log('Ctrl+Z will not undo an on-disk edit; this folder and `git checkout board/` will.');
}

main();
