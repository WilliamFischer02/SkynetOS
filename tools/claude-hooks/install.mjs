#!/usr/bin/env node
/**
 * npm run drop:install — put the drop-attach hook and the /drop skill into ~/.claude/.
 *
 * Copies `drop-attach.mjs` to `~/.claude/hooks/`, `skills/drop/SKILL.md` to `~/.claude/skills/drop/`,
 * and merges ONE `UserPromptSubmit` entry into `~/.claude/settings.json`. Idempotent: an entry whose
 * command already names drop-attach.mjs is left alone. Every other key in settings.json is kept, the
 * file is written back with two-space indentation, and a dated `.bak-YYYY-MM-DD` copy is made first.
 *
 * The command uses the absolute, forward-slash path of the hook: Claude Code runs hook commands
 * through a shell, and `%USERPROFILE%` is not expanded on every shell it may use.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const claudeDir = join(home, '.claude');
const hookDst = join(claudeDir, 'hooks', 'drop-attach.mjs');
const skillDst = join(claudeDir, 'skills', 'drop', 'SKILL.md');
const settingsPath = join(claudeDir, 'settings.json');

export function hookCommandFor(hookPath) {
  return `node "${hookPath.replace(/\\/g, '/')}"`;
}

/** Merge the hook into a settings object. Returns whether anything changed. */
export function mergeHook(settings, command) {
  const hooks = (settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};
  const list = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];
  const already = list.some((entry) => Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h?.command === 'string' && /drop-attach\.mjs/.test(h.command)));
  if (already) return false;
  list.push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  hooks.UserPromptSubmit = list;
  settings.hooks = hooks;
  return true;
}

function main() {
  mkdirSync(dirname(hookDst), { recursive: true });
  mkdirSync(dirname(skillDst), { recursive: true });
  copyFileSync(join(here, 'drop-attach.mjs'), hookDst);
  copyFileSync(join(here, 'skills', 'drop', 'SKILL.md'), skillDst);
  console.log(`hook   -> ${hookDst}`);
  console.log(`skill  -> ${skillDst}`);

  let settings = {};
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf8');
    settings = JSON.parse(raw);
    const stamp = new Date().toISOString().slice(0, 10);
    const backup = `${settingsPath}.bak-${stamp}`;
    if (!existsSync(backup)) writeFileSync(backup, raw, 'utf8');
    console.log(`backup -> ${backup}`);
  }
  const changed = mergeHook(settings, hookCommandFor(hookDst));
  if (changed) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    console.log(`settings: UserPromptSubmit hook added to ${settingsPath}`);
  } else {
    console.log('settings: hook already present, nothing changed');
  }
}

const invokedDirectly = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) main();
