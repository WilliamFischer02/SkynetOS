/**
 * Opening a document in a named editor rather than whatever Windows associates with it.
 *
 * William: "add notepad++ as an Open With option for md files / nodes as well as obsidian."
 *
 * Pure: which editors there are, where Notepad++ usually lives, and the URI Obsidian answers to.
 * src/main/services/editors.ts does the finding and the launching.
 */

export const EDITOR_OPEN_WITH = ['notepadpp', 'obsidian'] as const;
export type EditorOpenWith = (typeof EDITOR_OPEN_WITH)[number];

export function isEditorOpenWith(value: unknown): value is EditorOpenWith {
  return typeof value === 'string' && (EDITOR_OPEN_WITH as readonly string[]).includes(value);
}

export const EDITOR_LABELS: Record<EditorOpenWith, string> = {
  notepadpp: 'Notepad++',
  obsidian: 'Obsidian'
};

/**
 * `obsidian://open?path=` takes an absolute path and opens the note in whichever registered vault
 * contains it. Backslashes, because that is the form Obsidian compares against its vault list on
 * Windows, and fully percent-encoded, because note names are full of spaces and ampersands.
 */
export function obsidianOpenUri(absPath: string): string {
  return `obsidian://open?path=${encodeURIComponent(absPath.replace(/\//g, '\\'))}`;
}

/** Where the Notepad++ installer, a per-user install and scoop put it, in that order. */
export function notepadPlusPlusCandidates(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  const add = (base: string | undefined, rest: string): void => { if (base) out.push(`${base}\\${rest}`); };
  add(env['ProgramFiles'], 'Notepad++\\notepad++.exe');
  add(env['ProgramFiles(x86)'], 'Notepad++\\notepad++.exe');
  add(env['LOCALAPPDATA'], 'Programs\\Notepad++\\notepad++.exe');
  add(env['USERPROFILE'], 'scoop\\apps\\notepadplusplus\\current\\notepad++.exe');
  return out;
}

const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'log', 'json', 'csv', 'tsv', 'yml', 'yaml', 'xml', 'ini', 'cfg', 'conf', 'toml',
  'ts', 'tsx', 'js', 'mjs', 'cjs', 'py', 'ps1', 'bat', 'cmd', 'sh', 'html', 'css', 'java', 'cpp', 'h',
  'c', 'cs', 'rs', 'glsl', 'lua', 'properties', 'gitignore', 'canvas'
]);

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? (match[1] ?? '').toLowerCase() : '';
}

export function isMarkdownFile(name: string): boolean {
  const ext = extensionOf(name);
  return ext === 'md' || ext === 'markdown';
}

/** Files a text editor is the right tool for: the ones Notepad++ is offered on. */
export function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(name));
}
