import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { Board, BoardNode } from '@shared/types.js';
import type { ArtifactInfo } from '@shared/ipc.js';
import { resolveGlob } from './target-resolver.js';

const execFileAsync = promisify(execFile);

/**
 * `file.artifact` — the newest matching build output, and whether it is stale.
 *
 * Resolution itself lives in target-resolver.resolveGlob (newest mtime wins, minus the excludes).
 * What this module adds is the part that makes a cartridge worth looking at: the version label
 * parsed out of the filename, and whether the thing you would drag out is actually current.
 *
 * ── What "stale" means here ───────────────────────────────────────────────────────────────────
 * docs/03: a `STALE` badge "if the producing agent has committed since the artifact was built".
 * That is a real, checkable claim rather than a guess about time — and the board already knows
 * who produces what, because a `produces` edge says so. So: follow the incoming `produces` edge
 * back to its source node, take that node's repo, ask git when it last committed, and compare
 * against the artifact's mtime. Committed after the build ⇒ the jar on disk is behind the source.
 *
 * If there is no `produces` edge, or the source has no repo, staleness is simply unknown — which
 * is reported as unknown rather than guessed as fresh.
 */

/** Parse the version out of a filename using the node's regex. One capture group. */
export function parseVersion(fileName: string, versionPattern?: string): string | undefined {
  if (!versionPattern) return undefined;
  try {
    return new RegExp(versionPattern).exec(fileName)?.[1];
  } catch {
    // A malformed regex in board data must not take the board down with it.
    return undefined;
  }
}

/**
 * The node that produces this artifact, per the board's own `produces` edges.
 * Exported and pure so the staleness rule is testable without a repo.
 */
export function producerOf(board: Board, artifactNodeId: string): BoardNode | undefined {
  const edge = board.edges.find((e) => e.to === artifactNodeId && e.kind === 'produces');
  if (!edge) return undefined;
  return board.nodes.find((n) => n.id === edge.from);
}

/** The repo directory to ask git about, for a producer node. */
export function producerRepo(board: Board, artifactNodeId: string): string | undefined {
  const producer = producerOf(board, artifactNodeId);
  if (!producer) return undefined;
  // An agent chip declares `cwd`; a repo drive declares `path`. Either is a working tree.
  const dir = producer.cwd ?? producer.path;
  if (dir) return dir;

  // An agent that produces a jar usually does it in a repo that is ALSO on the board, wired by
  // its own `produces` edge. Follow one more hop before giving up.
  const nested = board.edges.find((e) => e.from === producer.id && e.kind === 'produces');
  const repoNode = nested && board.nodes.find((n) => n.id === nested.to && n.kind === 'store.repo');
  return repoNode?.path;
}

/** ISO timestamp of the last commit in a working tree, or null if it is not a repo. */
export async function lastCommitTime(repoDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoDir.replace(/\//g, '\\'), 'log', '-1', '--format=%cI'],
      { timeout: 5000, windowsHide: true }
    );
    const iso = stdout.trim();
    return iso || null;
  } catch {
    // Not a repo, git missing, or a detached/empty history. All the same answer: cannot tell.
    return null;
  }
}

export async function resolveArtifact(board: Board, node: BoardNode): Promise<ArtifactInfo> {
  const target = resolveGlob(node.glob ?? '', node.exclude ?? [], node.versionPattern);

  if (!target.resolved) {
    return {
      nodeId: node.id,
      target,
      fileName: null,
      version: null,
      stale: 'unknown',
      producerId: producerOf(board, node.id)?.id ?? null,
      lastCommit: null
    };
  }

  const fileName = basename(target.resolved);
  const version = target.versionLabel ?? parseVersion(fileName, node.versionPattern) ?? null;

  const repo = producerRepo(board, node.id);
  const lastCommit = repo ? await lastCommitTime(repo) : null;

  let stale: ArtifactInfo['stale'] = 'unknown';
  if (lastCommit && target.mtimeMs !== undefined) {
    stale = Date.parse(lastCommit) > target.mtimeMs ? 'stale' : 'fresh';
  }

  return {
    nodeId: node.id,
    target,
    fileName,
    version,
    stale,
    producerId: producerOf(board, node.id)?.id ?? null,
    lastCommit
  };
}

/** Resolve every artifact on a board. Runs the git calls in parallel — they are independent. */
export async function resolveBoardArtifacts(board: Board): Promise<ArtifactInfo[]> {
  return Promise.all(
    board.nodes.filter((n) => n.kind === 'file.artifact').map((n) => resolveArtifact(board, n))
  );
}
