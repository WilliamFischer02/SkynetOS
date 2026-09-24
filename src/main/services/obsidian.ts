import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardNode } from '@shared/types.js';
import { OBSIDIAN_PROFILE_REL, extractTags, isObsidianAware, obsidianPaths, vaultRootOf } from '@shared/obsidian.js';
import { expandPath, skynetRoot } from './target-resolver.js';

/**
 * Obsidian on disk: which folders are vaults, what a vault's daily-notes settings say, and what
 * tags and note names it already has. Read-only, and no Electron import, so the tests drive it
 * against a temporary folder.
 */

export function hasObsidianDir(dir: string): boolean {
  try {
    return statSync(join(dir, '.obsidian')).isDirectory();
  } catch {
    return false;
  }
}

/** The vault a board path (tokens and all) is in, or null. */
export function findVaultRoot(path: string | undefined | null): string | null {
  if (!path?.trim()) return null;
  return vaultRootOf(expandPath(path), hasObsidianDir);
}

export function nodeIsObsidianAware(node: BoardNode): boolean {
  return isObsidianAware(node, (p) => findVaultRoot(p) !== null);
}

export interface DailyNotesConfig {
  /** Vault-relative, forward slashes. Empty: the vault root. */
  folder: string;
  format: string | null;
  template: string | null;
}

export function readDailyNotesConfig(vault: string): DailyNotesConfig {
  try {
    const raw = JSON.parse(readFileSync(join(vault, '.obsidian', 'daily-notes.json'), 'utf8')) as Record<string, unknown>;
    const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      folder: (text(raw['folder']) ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
      format: text(raw['format']),
      template: text(raw['template'])
    };
  } catch {
    return { folder: '', format: null, template: null };
  }
}

/** The frontmatter keys of the vault's daily-note template, so a written note carries the same ones. */
export function templateKeysOf(vault: string, template: string | null): string[] {
  if (!template) return [];
  const rel = template.replace(/\\/g, '/').replace(/^\/+/, '');
  try {
    const text = readFileSync(join(vault, rel.endsWith('.md') ? rel : `${rel}.md`), 'utf8').replace(/\r\n?/g, '\n');
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    return [...fm.matchAll(/^([^\s:#][^:]*):/gm)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export interface VaultScan {
  /** Every tag in the vault, most-used first. */
  tags: string[];
  /** Note names (file names without `.md`), for linking to what exists. */
  notes: string[];
  files: number;
  /** True when the scan stopped at the file cap: the vocabulary is a large sample, not all of it. */
  truncated: boolean;
}

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', '.smart-env', 'node_modules']);
const MAX_FILES = 4000;
const MAX_BYTES = 1_000_000;
const SCAN_TTL_MS = 10 * 60_000;
const scans = new Map<string, { at: number; scan: VaultScan }>();

/**
 * The vault's tag vocabulary and note names. Bounded (4000 notes, 1 MB each) and cached for ten
 * minutes: a vault changes by the note, and the journal asks once a day.
 */
export function scanVault(vault: string, now = Date.now()): VaultScan {
  const cached = scans.get(vault);
  if (cached && now - cached.at < SCAN_TTL_MS) return cached.scan;

  const counts = new Map<string, { tag: string; n: number }>();
  const notes: string[] = [];
  let files = 0;
  let truncated = false;
  const stack = [vault];

  walk: while (stack.length) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      if (files >= MAX_FILES) { truncated = true; break walk; }
      files++;
      notes.push(entry.name.slice(0, -3));
      const full = join(dir, entry.name);
      try {
        if (statSync(full).size > MAX_BYTES) continue;
        for (const tag of extractTags(readFileSync(full, 'utf8'))) {
          const key = tag.toLowerCase();
          const hit = counts.get(key);
          if (hit) hit.n++;
          else counts.set(key, { tag, n: 1 });
        }
      } catch {
        // An unreadable note costs its tags, not the scan.
      }
    }
  }

  const scan: VaultScan = {
    tags: [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.tag),
    notes,
    files,
    truncated
  };
  scans.set(vault, { at: now, scan });
  return scan;
}

/**
 * The Obsidian section of an aware session's briefing: which vaults it is working in, and the
 * whole knowledge profile inlined.
 *
 * Inlined rather than listed in `readOnLaunch`, because reading is resolved against the session's
 * cwd and refuses anything outside it (docs/07 §Path policy). A vault-rooted agent could never be
 * pointed at a file in this repo. The drive auditor's persona reaches it the same way.
 */
export function obsidianBriefing(node: BoardNode): string | null {
  if (!nodeIsObsidianAware(node)) return null;
  const vaults = [...new Set(obsidianPaths(node).map((p) => findVaultRoot(p)).filter((v): v is string => v !== null))];

  let profile: string | null = null;
  try {
    profile = readFileSync(join(skynetRoot(), OBSIDIAN_PROFILE_REL), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  } catch {
    profile = null;
  }

  const lines = [
    '## OBSIDIAN',
    '',
    'This session works with Obsidian. The knowledge profile below is part of your briefing, and its',
    'section 0 rules are binding: never delete a note, never overwrite one wholesale, never rename a',
    'linked note from outside the app, never touch workspace or plugin data while Obsidian may be open.',
    '',
    vaults.length ? `Vaults in reach: ${vaults.join(' · ')}` : 'No vault is bound to this node; it is tagged `obsidian`.'
  ];
  lines.push('');
  lines.push(profile ?? `The profile (${OBSIDIAN_PROFILE_REL}) was missing when this session launched. Work from the rules above.`);
  return lines.join('\n');
}
