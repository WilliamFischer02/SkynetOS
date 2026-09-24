import { describe, expect, it } from 'vitest';
import {
  EDITOR_OPEN_WITH,
  isEditorOpenWith,
  isMarkdownFile,
  isTextFile,
  notepadPlusPlusCandidates,
  obsidianOpenUri
} from '../packages/shared/open-with.js';

describe('open with an editor', () => {
  it('knows exactly the two editors', () => {
    expect([...EDITOR_OPEN_WITH]).toEqual(['notepadpp', 'obsidian']);
    expect(isEditorOpenWith('obsidian')).toBe(true);
    expect(isEditorOpenWith('vscode')).toBe(false);
  });

  it('builds an Obsidian URI with a backslashed, fully encoded path', () => {
    const uri = obsidianOpenUri('C:/Users/w/OneDrive/Documents/SolidState Sync/01 Personal/a & b.md');
    expect(uri.startsWith('obsidian://open?path=')).toBe(true);
    const path = decodeURIComponent(uri.slice('obsidian://open?path='.length));
    expect(path).toBe('C:\\Users\\w\\OneDrive\\Documents\\SolidState Sync\\01 Personal\\a & b.md');
    expect(uri.slice(21)).not.toContain(' ');
    expect(uri.slice(21)).not.toContain('&');
  });

  it('lists the usual Notepad++ locations, skipping unset variables', () => {
    const list = notepadPlusPlusCandidates({ ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\w\\AppData\\Local' });
    expect(list).toEqual([
      'C:\\Program Files\\Notepad++\\notepad++.exe',
      'C:\\Users\\w\\AppData\\Local\\Programs\\Notepad++\\notepad++.exe'
    ]);
  });

  it('recognises markdown and text files', () => {
    expect(isMarkdownFile('Journal/2026-09-11.md')).toBe(true);
    expect(isMarkdownFile('notes.MARKDOWN')).toBe(true);
    expect(isMarkdownFile('a.docx')).toBe(false);
    expect(isTextFile('latest.log')).toBe(true);
    expect(isTextFile('board.canvas')).toBe(true);
    expect(isTextFile('photo.png')).toBe(false);
  });
});
