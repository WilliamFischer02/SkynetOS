import { existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { BoardNode, NodeKind } from '@shared/types.js';
import type { IngestSuggestion } from '@shared/ipc.js';
import { DEFAULT_FOOTPRINT } from '@shared/types.js';

/**
 * Drop-in ingestion: drag a file or folder from Explorer into a room and get the right node,
 * pre-filled. docs/03 §14.
 *
 * The point is that adding the fifth mod project should not mean typing four paths. Everything
 * here is a SUGGESTION — it fills in the node wizard, it does not commit anything. The user still
 * sees the form, and the node still goes through the same command bus with the same validation
 * and the same undo as any other edit.
 */

/** Extensions that mean "this is a build output", not just a file that happens to exist. */
const ARTIFACT_EXTENSIONS = new Set(['.jar', '.exe', '.msi', '.zip', '.dll', '.pak', '.apk', '.nupkg']);
const DOCUMENT_EXTENSIONS = new Set(['.docx', '.doc', '.odt', '.rtf', '.md', '.txt', '.pdf', '.pages']);
const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.ps1', '.lnk']);

/** Directory names that mean the parent is a build output directory. */
const BUILD_DIRS = new Set(['libs', 'build', 'dist', 'out', 'target', 'release', 'bin', 'publish']);

function slugId(name: string, kind: NodeKind): string {
  const prefix = kind.startsWith('agent') ? 'u'
    : kind === 'store.repo' || kind === 'store.folder' ? 's'
      : kind === 'file.artifact' ? 'a'
        : kind === 'drive.room' ? 'd'
          : kind === 'link.url' ? 'j'
            : 'f';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'node';
  return `${prefix}_${slug}`;
}

/** A display name from a path: the filename without its extension, or the folder name. */
function displayName(path: string, isDirectory: boolean): string {
  const base = basename(path.replace(/[\\/]+$/, ''));
  return isDirectory ? base : base.replace(new RegExp(`${extname(base).replace('.', '\\.')}$`), '');
}

/**
 * Decide what a dropped path should become.
 *
 * The interesting case is a `.jar` in `build/libs`: that is not a file you want a node pinned to,
 * because the next build produces a different filename and the node would immediately render
 * broken. It should become a `file.artifact` with a glob, which is the whole reason that node
 * kind exists. Same for anything in a recognised build directory.
 */
export function classify(path: string): IngestSuggestion | null {
  const clean = path.replace(/\\/g, '/');
  if (!existsSync(clean)) return null;

  let isDirectory: boolean;
  try {
    isDirectory = statSync(clean).isDirectory();
  } catch {
    return null;
  }

  if (isDirectory) {
    const isRepo = existsSync(join(clean, '.git'));
    const kind: NodeKind = isRepo ? 'store.repo' : 'store.folder';
    const name = displayName(clean, true);
    return {
      path: clean,
      kind,
      name,
      suggestedId: slugId(name, kind),
      fields: { path: clean, openWith: isRepo ? 'vscode' : 'explorer' },
      footprint: DEFAULT_FOOTPRINT[kind],
      reason: isRepo ? 'A git working tree — bound as a repository drive.' : 'A folder — bound as a folder drive.'
    };
  }

  const ext = extname(clean).toLowerCase();
  const parentDir = basename(dirname(clean)).toLowerCase();
  const grandparentDir = basename(dirname(dirname(clean))).toLowerCase();

  // A build output: glob it, do not pin the exact filename.
  if (ARTIFACT_EXTENSIONS.has(ext) && (BUILD_DIRS.has(parentDir) || BUILD_DIRS.has(grandparentDir))) {
    const name = displayName(clean, false).replace(/-\d+(\.\d+)*.*$/, '');
    return {
      path: clean,
      kind: 'file.artifact',
      name: name || displayName(clean, false),
      suggestedId: slugId(name || 'artifact', 'file.artifact'),
      fields: {
        glob: `${dirname(clean)}/*${ext}`,
        exclude: ['*-sources' + ext, '*-dev' + ext],
        versionPattern: `-(\\d+\\.\\d+\\.\\d+)\\${ext}$`
      },
      footprint: DEFAULT_FOOTPRINT['file.artifact'],
      reason: `A build output in ${parentDir}/ — bound as a glob so the node follows the newest build instead of pinning ${basename(clean)}.`
    };
  }

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    const name = displayName(clean, false);
    return {
      path: clean,
      kind: 'file.document',
      name,
      suggestedId: slugId(name, 'file.document'),
      fields: { path: clean, openWith: 'default' },
      footprint: DEFAULT_FOOTPRINT['file.document'],
      reason: 'A document — opens in whatever Windows associates with it.'
    };
  }

  if (EXECUTABLE_EXTENSIONS.has(ext)) {
    const name = displayName(clean, false);
    return {
      path: clean,
      kind: 'file.exe',
      name,
      suggestedId: slugId(name, 'file.exe'),
      // confirmBeforeLaunch stays true: this is a program, and docs/07 defaults to asking.
      fields: { path: clean, confirmBeforeLaunch: true },
      footprint: DEFAULT_FOOTPRINT['file.exe'],
      reason: 'A program — click launches it, with a confirmation showing the resolved path.'
    };
  }

  const name = displayName(clean, false);
  return {
    path: clean,
    kind: 'file.document',
    name,
    suggestedId: slugId(name, 'file.document'),
    fields: { path: clean, openWith: 'default' },
    footprint: DEFAULT_FOOTPRINT['file.document'],
    reason: `No specific rule for ${ext || 'this file type'} — bound as a document, which opens it with its default app.`
  };
}

/** Turn a suggestion into a node, given a free position. The wizard still shows it first. */
export function suggestionToNode(
  suggestion: IngestSuggestion,
  pos: { x: number; y: number },
  existingIds: Set<string>
): BoardNode {
  let id = suggestion.suggestedId;
  let n = 2;
  while (existingIds.has(id)) id = `${suggestion.suggestedId}_${n++}`;

  return {
    id,
    kind: suggestion.kind,
    name: suggestion.name.slice(0, 40),
    pos,
    ...suggestion.fields
  } as BoardNode;
}
