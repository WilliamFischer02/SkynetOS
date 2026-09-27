/*
 * tools/tooltip-audit.mjs — every control in the chrome says what the user does, on hover.
 *
 *   npm run audit:tooltips          list the controls under src/renderer/ui with no `title`
 *   npm run audit:tooltips -- --all include the files other workers own (EXCLUDED below)
 *
 * The rule (2026-09-27 UX pass): every `<button>`, every element with `role="button"`, every
 * `<select>` and every `<input type="checkbox|range">` carries a `title` that names what happens
 * ("Open the folder in Explorer", not "explorer"). An `aria-label` is welcome beside it, and is
 * required on an icon-only control, but it does not show on hover, so on its own it does not pass.
 *
 * Regex-level on purpose: it reads the TSX as text, finds each opening tag, walks to the `>` that
 * closes it (skipping braces and strings, so an arrow function's `=>` does not end the tag early),
 * and looks for the attribute inside that one tag. It does not follow props through components; a
 * shared component (PanelHead, StateBox) is audited where its own `<button>` is written.
 *
 * test/tooltip-audit.test.ts holds the count at zero.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
export const UI_DIR = join(REPO, 'src', 'renderer', 'ui');

/** Owned by other workers on 2026-09-27; audited with --all, not held to zero here. */
export const EXCLUDED = ['HologramApp.tsx', 'AvatarApp.tsx', 'ConfirmApp.tsx', 'SystemSettings.tsx'];

/** Blank out comments, keeping every newline so line numbers still point at the source. */
function stripComments(text) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank);
}

/**
 * From the `<` of an opening tag, the index just past its closing `>`, or -1.
 * Braces nest; quotes and template literals are skipped, with `${` inside a template nesting too.
 */
function tagEnd(text, start) {
  const stack = []; // '{' for a brace, '`' for a template literal
  let quote = null;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (top === '`') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { stack.pop(); continue; }
      if (c === '$' && text[i + 1] === '{') { stack.push('{'); i++; }
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '`') { stack.push('`'); continue; }
    if (c === '{') { stack.push('{'); continue; }
    if (c === '}') { if (top === '{') stack.pop(); continue; }
    if (c === '>' && !stack.length) return i + 1;
  }
  return -1;
}

/** The tag with every brace expression emptied, so `title=` is only found as an attribute of THIS tag. */
function topLevel(tag) {
  let out = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < tag.length; i++) {
    const c = tag[i];
    if (quote) {
      if (depth === 0) out += c;
      if (c === '\\') { if (depth === 0) out += tag[i + 1] ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || (c === '`' && depth > 0)) { quote = c; if (depth === 0) out += c; continue; }
    if (c === '{') { if (depth === 0) out += '{'; depth++; continue; }
    if (c === '}') { depth--; if (depth === 0) out += '}'; continue; }
    if (depth === 0) out += c;
  }
  return out;
}

/** What kind of control this opening tag is, or null when it is not one the rule covers. */
function controlKind(name, attrs) {
  if (name === 'button') return 'button';
  if (name === 'select') return 'select';
  if (name === 'input') {
    const type = /\btype=(?:"([^"]*)"|'([^']*)'|\{\s*['"]([^'"]*)['"]\s*\})/.exec(attrs);
    const value = type ? type[1] ?? type[2] ?? type[3] : '';
    if (value === 'checkbox' || value === 'range') return `input ${value}`;
    return null;
  }
  if (/\brole=(?:"button"|'button'|\{\s*['"]button['"]\s*\})/.test(attrs)) return `${name} role=button`;
  return null;
}

/** Every covered control in one file's source, with whether it passes. */
export function auditSource(source, file = '<source>') {
  const text = stripComments(source);
  const found = [];
  const open = /(^|[^\w$.])<([a-z][a-z0-9]*)(?=[\s/>])/g;
  let match;
  while ((match = open.exec(text))) {
    const start = match.index + match[1].length;
    const end = tagEnd(text, start);
    if (end < 0) continue;
    const tag = text.slice(start, end);
    const attrs = topLevel(tag);
    const kind = controlKind(match[2], attrs);
    if (!kind) continue;
    const hasTitle = /(^|\s)title=/.test(attrs);
    const hasLabel = /(^|\s)aria-label=/.test(attrs);
    const line = text.slice(0, start).split('\n').length;
    found.push({
      file,
      line,
      kind,
      ok: hasTitle,
      reason: hasTitle ? '' : hasLabel ? 'aria-label but no title' : 'no title',
      snippet: tag.replace(/\s+/g, ' ').slice(0, 96)
    });
  }
  return found;
}

/** Every `.tsx` under src/renderer/ui, minus the excluded files unless `all`. */
export function auditUi({ all = false } = {}) {
  const files = readdirSync(UI_DIR)
    .filter((name) => name.endsWith('.tsx'))
    .filter((name) => all || !EXCLUDED.includes(name))
    .sort();
  const controls = [];
  for (const name of files) {
    const path = join(UI_DIR, name);
    controls.push(...auditSource(readFileSync(path, 'utf8'), relative(REPO, path).replace(/\\/g, '/')));
  }
  return { files: files.length, controls, missing: controls.filter((control) => !control.ok) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const all = process.argv.includes('--all');
  const { files, controls, missing } = auditUi({ all });
  for (const control of missing) {
    console.log(`${control.file}:${control.line}  ${control.kind.padEnd(18)} ${control.reason.padEnd(24)} ${control.snippet}`);
  }
  console.log(
    `\n${missing.length} of ${controls.length} controls in ${files} files have no tooltip` +
      `${all ? '' : ` (excluding ${EXCLUDED.join(', ')})`}.`
  );
  process.exitCode = missing.length ? 1 : 0;
}
