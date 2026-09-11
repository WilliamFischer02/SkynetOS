import { existsSync, globSync } from 'node:fs';
import { pathExists, pathInfo, type PathInfo } from './which.js';
import { isAbsolute, join, normalize, resolve as resolvePath, dirname, basename } from 'node:path';
import { app } from 'electron';
import type { BoardNode } from '@shared/types.js';
import { primaryTargetField, type FieldControl } from '@shared/node-fields.js';
import { looksLikePlaceholder, validateUrl, type TargetInfo } from '@shared/targets.js';
import { normaliseRoot, trustedRoots } from './settings.js';

/**
 * Resolves a node's target to something concrete, or explains exactly why it cannot.
 *
 * This is the service behind three things at once: the broken-hardware render state, the
 * inspector's "resolved target" line, and the node wizard's "verify before committing" check.
 * All three need the same answer, so there is one implementation of it.
 */

/** `%APPDATA%`, `%USERPROFILE%`, `$HOME` and a leading `~`. */
export function expandPath(raw: string): string {
  let out = raw.trim().replace(/\\/g, '/');
  if (out.startsWith('~/') || out === '~') {
    out = join(app.getPath('home'), out.slice(1)).replace(/\\/g, '/');
  }
  out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name: string) => {
    const value = process.env[name] ?? process.env[name.toUpperCase()];
    return value ? value.replace(/\\/g, '/') : whole;
  });
  return out;
}

export function isInsideTrustedRoot(absPath: string): boolean {
  const target = normaliseRoot(absPath);
  return trustedRoots().some((root) => target === root || target.startsWith(root + '/'));
}

/**
 * What is at this path.
 *
 * Delegates to `services/which.ts`, which knows the thing this file kept getting wrong: `stat`
 * throws EACCES on a Windows App Execution Alias, so every Store app — Notepad, Paint, Terminal,
 * PowerShell — resolved as missing and drew a broken footprint for a program that launches fine.
 */
function statInfo(absPath: string): PathInfo | null {
  return pathInfo(absPath);
}

function resolveFsTarget(raw: string, expect: 'file' | 'directory' | 'either'): TargetInfo {
  const expanded = expandPath(raw);
  if (!expanded) return { state: 'unset', raw, resolved: null, detail: 'NO TARGET SET' };
  if (looksLikePlaceholder(expanded)) {
    return { state: 'invalid', raw, resolved: null, detail: `PLACEHOLDER NOT REPLACED — ${expanded}` };
  }
  // docs/07: path traversal is rejected.
  if (expanded.includes('..')) {
    return { state: 'invalid', raw, resolved: null, detail: `PATH CONTAINS ".." — TRAVERSAL NOT ALLOWED — ${expanded}` };
  }
  if (!isAbsolute(expanded)) {
    return { state: 'invalid', raw, resolved: null, detail: `PATH IS NOT ABSOLUTE — ${expanded}` };
  }

  const abs = normalize(expanded).replace(/\\/g, '/');
  // `pathExists`, not `existsSync`: the latter is stat under the covers, and stat is exactly what
  // an App Execution Alias refuses. See the note at the foot of services/which.ts.
  if (!pathExists(abs)) {
    return { state: 'missing', raw, resolved: abs, detail: `TARGET NOT FOUND — ${abs}` };
  }
  const info = statInfo(abs);
  if (!info) {
    return { state: 'unknown', raw, resolved: abs, detail: `CANNOT READ TARGET — ${abs}` };
  }
  if (expect === 'directory' && info.kind !== 'directory') {
    return { state: 'invalid', raw, resolved: abs, detail: `EXPECTED A DIRECTORY, FOUND A FILE — ${abs}` };
  }
  if (expect === 'file' && info.kind !== 'file') {
    return { state: 'invalid', raw, resolved: abs, detail: `EXPECTED A FILE, FOUND A DIRECTORY — ${abs}` };
  }
  if (!isInsideTrustedRoot(abs)) {
    return {
      state: 'outside-dev-root',
      raw,
      resolved: abs,
      detail: `OUTSIDE EVERY DEV ROOT — CONFIRMED ON EVERY ACTIVATION — ${abs}`,
      ...info
    };
  }
  return { state: 'ok', raw, resolved: abs, detail: null, ...info };
}

/**
 * Glob resolution: newest match wins, minus the excludes. This is how "always point at the
 * newest jar" works. Uses Node's built-in fs.globSync — no dependency, and it is the same
 * matcher for the pattern and for the excludes.
 */
export function resolveGlob(
  pattern: string,
  exclude: string[] = [],
  versionPattern?: string
): TargetInfo {
  const expanded = expandPath(pattern);
  if (!expanded) return { state: 'unset', raw: pattern, resolved: null, detail: 'NO GLOB SET' };
  if (!expanded.includes('*')) {
    return { state: 'invalid', raw: pattern, resolved: null, detail: `GLOB HAS NO WILDCARD — ${expanded}` };
  }
  if (expanded.includes('..')) {
    return { state: 'invalid', raw: pattern, resolved: null, detail: `GLOB CONTAINS ".." — TRAVERSAL NOT ALLOWED — ${expanded}` };
  }

  // Split into a concrete directory and a pattern, so a missing build directory is reported as
  // itself rather than as "no matches" — a materially different problem to diagnose.
  const dir = dirname(expanded);
  const filePattern = basename(expanded);
  if (!existsSync(dir)) {
    return { state: 'missing', raw: pattern, resolved: null, detail: `GLOB DIRECTORY NOT FOUND — ${dir}` };
  }

  let matches: string[];
  try {
    matches = [...globSync(filePattern, { cwd: dir })].map((m) => join(dir, String(m)).replace(/\\/g, '/'));
  } catch (err) {
    return { state: 'unknown', raw: pattern, resolved: null, detail: `GLOB FAILED — ${(err as Error).message}` };
  }

  if (exclude.length) {
    const excluded = new Set<string>();
    for (const ex of exclude) {
      try {
        for (const m of globSync(ex.trim(), { cwd: dir })) excluded.add(join(dir, String(m)).replace(/\\/g, '/'));
      } catch { /* a malformed exclude excludes nothing; the glob itself still reports */ }
    }
    matches = matches.filter((m) => !excluded.has(m));
  }

  if (!matches.length) {
    return { state: 'missing', raw: pattern, resolved: null, detail: `NO FILE MATCHES — ${expanded}`, matchCount: 0 };
  }

  const ranked = matches
    .map((file) => ({ file, info: statInfo(file) }))
    .filter((m): m is { file: string; info: NonNullable<ReturnType<typeof statInfo>> } => m.info !== null)
    .sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);

  const winner = ranked[0];
  if (!winner) {
    return { state: 'unknown', raw: pattern, resolved: null, detail: `MATCHES FOUND BUT UNREADABLE — ${expanded}`, matchCount: matches.length };
  }

  let versionLabel: string | undefined;
  if (versionPattern) {
    try {
      versionLabel = new RegExp(versionPattern).exec(winner.file)?.[1];
    } catch {
      versionLabel = undefined;
    }
  }

  const outside = !isInsideTrustedRoot(winner.file);
  return {
    state: outside ? 'outside-dev-root' : 'ok',
    raw: pattern,
    resolved: winner.file,
    detail: outside ? `OUTSIDE EVERY DEV ROOT — ${winner.file}` : null,
    kind: 'file',
    sizeBytes: winner.info.sizeBytes,
    mtimeMs: winner.info.mtimeMs,
    matchCount: matches.length,
    ...(versionLabel ? { versionLabel } : {})
  };
}

function resolveUrlTarget(raw: string): TargetInfo {
  if (!raw.trim()) return { state: 'unset', raw, resolved: null, detail: 'NO URL SET' };
  if (looksLikePlaceholder(raw)) {
    return { state: 'invalid', raw, resolved: null, detail: `PLACEHOLDER NOT REPLACED — ${raw}` };
  }
  const check = validateUrl(raw);
  if (!check.ok) return { state: 'invalid', raw, resolved: null, detail: check.reason };
  // Shape only. Reachability is not tested — see packages/shared/targets.ts for why.
  return { state: 'ok', raw, resolved: check.normalised, detail: null, kind: 'url' };
}

function boardRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'board') : join(app.getAppPath(), 'board');
}

function resolveBoardFile(raw: string): TargetInfo {
  if (!raw.trim()) return { state: 'unset', raw, resolved: null, detail: 'NO BOARD FILE SET' };
  if (raw.includes('..')) {
    return { state: 'invalid', raw, resolved: null, detail: `BOARD FILE CONTAINS ".." — NOT ALLOWED — ${raw}` };
  }
  const abs = resolvePath(boardRoot(), raw).replace(/\\/g, '/');
  if (!abs.toLowerCase().startsWith(boardRoot().replace(/\\/g, '/').toLowerCase())) {
    return { state: 'invalid', raw, resolved: abs, detail: `BOARD FILE ESCAPES board/ — ${abs}` };
  }
  if (!existsSync(abs)) {
    return { state: 'missing', raw, resolved: abs, detail: `BOARD FILE NOT FOUND — ${abs}` };
  }
  return { state: 'ok', raw, resolved: abs, detail: null, kind: 'file' };
}

/** Resolve one value for one control type. Used by the picker's Verify button. */
export function resolveValue(control: FieldControl, value: string, node?: BoardNode): TargetInfo {
  switch (control) {
    case 'path-dir': return resolveFsTarget(value, 'directory');
    case 'path-file': return resolveFsTarget(value, 'file');
    case 'glob': return resolveGlob(value, node?.exclude ?? [], node?.versionPattern);
    case 'url': return resolveUrlTarget(value);
    case 'board-file': return resolveBoardFile(value);
    default: return { state: 'none', raw: value, resolved: null, detail: null };
  }
}

/** Resolve a node's primary target — the thing a click acts on. */
export function resolveNodeTarget(node: BoardNode): TargetInfo {
  // The NODE, not just its kind: a file.document is bound by `path` or by `url`, and which one it
  // is depends on which one is filled in. See primaryTargetField.
  const field = primaryTargetField(node.kind, node);
  if (!field) return { state: 'none', raw: null, resolved: null, detail: null };
  const raw = node[field.key];
  if (typeof raw !== 'string') {
    return { state: 'unset', raw: null, resolved: null, detail: `NO ${field.label.toUpperCase()} SET` };
  }
  return resolveValue(field.control, raw, node);
}
