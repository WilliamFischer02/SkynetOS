#!/usr/bin/env node
/**
 * drop-attach: a Claude Code `UserPromptSubmit` hook that turns dropped files into context.
 *
 * Windows Terminal pastes a dropped file's full path into the prompt (quoted when it has spaces).
 * This hook reads the prompt from stdin, finds the absolute paths in it that exist on disk, and
 * prints `additionalContext` for them: text files inline (capped), images and PDFs as an instruction
 * to `Read` them (Claude Code renders both), Office files as a pointer to the office skills,
 * folders as a short listing, anything else as its size and type.
 *
 * It never follows a path the user did not type, never reads secrets (`.env`, keys, certificates)
 * or anything under `.git/` or `node_modules/`, always exits 0, and prints nothing on any error so a
 * broken hook can never block a prompt.
 *
 * Installed to ~/.claude/hooks/ by `npm run drop:install` (tools/claude-hooks/install.mjs).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PER_FILE_CAP = 64 * 1024;
export const TOTAL_CAP = 200 * 1024;
export const DIR_LISTING_CAP = 50;
/**
 * A dropped-file prompt is short. A long prompt that merely MENTIONS paths (a pasted log, a system
 * notification) must not have their contents attached: above these limits only the header and the
 * path list go out, and above MAX_PATHS_LISTED nothing at all.
 */
export const MAX_PROMPT_CHARS_FOR_CONTENTS = 1500;
export const MAX_PATHS_FOR_CONTENTS = 6;
export const MAX_PATHS_LISTED = 20;

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.log', '.csv', '.tsv',
  '.xml', '.html', '.htm', '.css', '.scss', '.less', '.svg',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.rs', '.go', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cc',
  '.cs', '.swift', '.php', '.lua', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd', '.sql', '.graphql', '.gql',
  '.vue', '.svelte', '.astro', '.glsl', '.frag', '.vert', '.wgsl', '.gradle', '.properties', '.cmake', '.mk', '.dockerfile',
  '.gitignore', '.gitattributes', '.editorconfig', '.env.example', '.tex', '.bib', '.rst', '.org', '.srt', '.vtt'
]);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const OFFICE_EXT = new Map([
  ['.docx', 'docx'], ['.doc', 'docx'], ['.xlsx', 'xlsx'], ['.xls', 'xlsx'], ['.csv', null], ['.pptx', 'pptx'], ['.ppt', 'pptx']
]);
const SECRET_NAMES = [/^\.env(\..*)?$/i, /\.pem$/i, /\.key$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i, /\.p12$/i, /\.pfx$/i];
const DENIED_DIRS = new Set(['.git', 'node_modules']);

/** Strip the punctuation a sentence hangs on a path: `C:\x\y.md.` or `(C:\x\y.md)`. */
function trimTrailing(raw) {
  // \x60 is a backtick: written as an escape because vite's import lexer misreads a literal one
  // inside a regex as the start of a template literal.
  return raw.replace(/[\\/.,;:!?)\]}>'"\x60]+$/, '');
}

/** Every absolute path candidate in a prompt, in order of appearance, without duplicates. */
export function findPathCandidates(prompt, home = homedir()) {
  const out = [];
  const seen = new Set();
  const push = (p) => {
    const key = p.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(p); }
  };
  const text = String(prompt ?? '');
  // 1. Quoted Windows paths, which is how Windows Terminal drops a path containing spaces.
  for (const m of text.matchAll(/["']([A-Za-z]:[\\/][^"'\r\n]*?)["']/g)) push(trimTrailing(m[1]));
  // 2. Bare Windows paths up to whitespace. A URL never starts with a drive letter and a colon+slash
  //    pair followed by a backslash or a path, so `https://` does not match.
  for (const m of text.matchAll(/(?<![\w"'])([A-Za-z]:[\\/][^\s"'\x60<>|)\],;]+)/g)) push(trimTrailing(m[1]));
  // 3. Git-bash style `/c/Users/...`.
  for (const m of text.matchAll(/(?<![\w/])\/([A-Za-z])\/([^\s"'\x60<>|)\],;]+)/g)) push(`${m[1].toUpperCase()}:/${trimTrailing(m[2])}`);
  // 4. Home-relative `~/x` or `~\x`.
  for (const m of text.matchAll(/(?<![\w])~[\\/]([^\s"'\x60<>|)\],;]+)/g)) push(join(home, trimTrailing(m[1])));
  return out;
}

export function isSecretName(name) {
  return SECRET_NAMES.some((re) => re.test(name));
}

export function isUnderDeniedDir(path) {
  return resolve(path).split(/[\\/]/).some((part) => DENIED_DIRS.has(part.toLowerCase()));
}

/** A cheap "is this text": no NUL bytes and mostly printable in the first 8 KB. */
export function looksLikeText(buf) {
  const head = buf.subarray(0, 8192);
  if (head.length === 0) return true;
  let odd = 0;
  for (const b of head) {
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32)) odd++;
  }
  return odd / head.length < 0.02;
}

export function classify(path) {
  const ext = extname(path).toLowerCase();
  const name = basename(path);
  if (isSecretName(name)) return 'secret';
  if (isUnderDeniedDir(path)) return 'denied';
  let stat;
  try { stat = statSync(path); } catch { return 'missing'; }
  if (stat.isDirectory()) return 'dir';
  if (!stat.isFile()) return 'other';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (OFFICE_EXT.has(ext) && OFFICE_EXT.get(ext)) return 'office';
  if (TEXT_EXT.has(ext) || name.startsWith('.') && ext === '') return 'text';
  if (stat.size <= 2 * 1024 * 1024) {
    try {
      const fd = readFileSync(path);
      if (looksLikeText(fd)) return 'text';
    } catch { /* fall through */ }
  }
  return 'binary';
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fenceFor(text) {
  // A fence longer than any run of backticks in the file, so the contents cannot close it early.
  let longest = 2;
  for (const m of text.matchAll(/\x60{3,}/g)) longest = Math.max(longest, m[0].length);
  return '\x60'.repeat(longest + 1);
}

/**
 * Build the context for a list of candidate paths. Pure over the filesystem; returns `null` when
 * nothing in the prompt was a real path, so the hook stays silent for ordinary prompts.
 */
export function buildContext(candidates, caps = { perFile: PER_FILE_CAP, total: TOTAL_CAP }) {
  const parts = [];
  let total = 0;
  let any = false;
  for (const path of candidates) {
    const kind = classify(path);
    if (kind === 'missing') continue;
    any = true;
    const name = basename(path);
    switch (kind) {
      case 'secret':
        parts.push(`- ${path}: NOT ATTACHED. It looks like a secret (${name}); read it yourself only if the user insists.`);
        break;
      case 'denied':
        parts.push(`- ${path}: NOT ATTACHED. It is under .git/ or node_modules/; Read it directly if you need it.`);
        break;
      case 'dir': {
        let entries = [];
        try { entries = readdirSync(path, { withFileTypes: true }); } catch { /* unreadable */ }
        const shown = entries.slice(0, DIR_LISTING_CAP).map((e) => `${e.isDirectory() ? '[dir] ' : ''}${e.name}`);
        const more = entries.length > DIR_LISTING_CAP ? `\n  … ${entries.length - DIR_LISTING_CAP} more` : '';
        parts.push(`- ${path} (folder, ${entries.length} entries):\n  ${shown.join('\n  ')}${more}`);
        break;
      }
      case 'image':
        parts.push(`- ${path}: an image. Use the Read tool on this exact path to see it.`);
        break;
      case 'pdf':
        parts.push(`- ${path}: a PDF. Use the Read tool on this exact path (with \`pages\` for long ones) to read it.`);
        break;
      case 'office': {
        const skill = OFFICE_EXT.get(extname(path).toLowerCase());
        parts.push(`- ${path}: an Office document. Load the \`anthropic-skills:${skill}\` skill, then read it from this path.`);
        break;
      }
      case 'text': {
        let buf;
        try { buf = readFileSync(path); } catch (err) { parts.push(`- ${path}: could not be read (${err.message.split('\n')[0]}).`); break; }
        const room = Math.min(caps.perFile, caps.total - total);
        if (room <= 0) { parts.push(`- ${path}: NOT INLINED, the ${human(caps.total)} total cap is spent. Read it from this path.`); break; }
        let text = buf.subarray(0, room).toString('utf8');
        const truncated = buf.length > room;
        if (truncated) text += `\n[truncated at ${human(room)} of ${human(buf.length)}; Read the path for the rest]`;
        total += Math.min(buf.length, room);
        const fence = fenceFor(text);
        parts.push(`- ${path} (${human(buf.length)}):\n${fence}\n${text}\n${fence}`);
        break;
      }
      default: {
        let size = 0;
        try { size = statSync(path).size; } catch { /* unknown */ }
        parts.push(`- ${path}: ${extname(path) || 'no extension'}, ${human(size)}, binary. Not inlined.`);
      }
    }
  }
  if (!any) return null;
  return `[dropped files] The user dropped or typed these paths into the prompt. Treat them as attachments.\n${parts.join('\n')}`;
}

/**
 * How much to say for a prompt: 'contents' for a short prompt naming a few paths, 'list' for a long
 * one or many paths (header and sizes only), 'none' above MAX_PATHS_LISTED.
 */
export function attachMode(promptLength, pathCount, limits = { chars: MAX_PROMPT_CHARS_FOR_CONTENTS, paths: MAX_PATHS_FOR_CONTENTS, listed: MAX_PATHS_LISTED }) {
  if (pathCount === 0 || pathCount > limits.listed) return 'none';
  if (promptLength > limits.chars || pathCount > limits.paths) return 'list';
  return 'contents';
}

/** The header and one line per existing path with its kind and size, no contents. */
export function buildListing(candidates) {
  const lines = [];
  for (const path of candidates) {
    const kind = classify(path);
    if (kind === 'missing') continue;
    let size = '';
    if (kind !== 'dir' && kind !== 'secret' && kind !== 'denied') { try { size = `, ${human(statSync(path).size)}`; } catch { /* unknown */ } }
    lines.push(`- ${path} (${kind}${size})`);
  }
  if (!lines.length) return null;
  return `[dropped files] The prompt names these paths (not inlined: the prompt is long or names many). Read the ones you need.\n${lines.join('\n')}`;
}

export function hookOutput(context) {
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw || '{}');
    const prompt = String(input.prompt ?? '');
    const candidates = findPathCandidates(prompt);
    const mode = attachMode(prompt.length, candidates.length);
    if (mode === 'none') return;
    const context = mode === 'contents' ? buildContext(candidates) : buildListing(candidates);
    if (!context) return;
    process.stdout.write(JSON.stringify(hookOutput(context)));
  } catch {
    // Silence is the contract: a broken hook must never block a prompt.
  }
}

const invokedDirectly = (() => {
  try { return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url; } catch { return false; }
})();
if (invokedDirectly) void main().finally(() => process.exit(0));

export const _internal = { sep, existsSync };
