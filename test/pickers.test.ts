import { describe, expect, it } from 'vitest';
import { portableSpelling } from '../src/main/services/pickers.js';

/**
 * What the Browse button stores. A board is the save file and travels between machines, so a
 * picked path inside the repo or the profile must be stored in the spelling that still resolves
 * elsewhere, or `npm run paths:check` goes red the moment someone uses Browse.
 */

const REPO = 'C:/dev/SkynetOS';
const HOME = 'C:\\Users\\wills';

describe('portableSpelling', () => {
  it('writes a file inside the repo as %SKYNET%', () => {
    expect(portableSpelling('C:/dev/SkynetOS/assets/sprites/arcade.png', REPO, HOME)).toBe('%SKYNET%/assets/sprites/arcade.png');
  });

  it('writes a file under the profile as %USERPROFILE%', () => {
    expect(portableSpelling('C:/Users/wills/OneDrive/Documents/PANIC.docx', REPO, HOME))
      .toBe('%USERPROFILE%/OneDrive/Documents/PANIC.docx');
  });

  it('is case-insensitive, like the Windows filesystem it describes', () => {
    expect(portableSpelling('c:/DEV/skynetos/board/root.board.json', REPO, HOME)).toBe('%SKYNET%/board/root.board.json');
  });

  it('leaves a path elsewhere alone: C:/dev/TheStalker is a true statement about one machine', () => {
    expect(portableSpelling('C:/dev/TheStalker', REPO, HOME)).toBe('C:/dev/TheStalker');
  });

  it('does not mistake a sibling with a shared prefix for the repo', () => {
    expect(portableSpelling('C:/dev/SkynetOS-old/x.png', REPO, HOME)).toBe('C:/dev/SkynetOS-old/x.png');
  });

  it('normalises backslashes either way', () => {
    expect(portableSpelling('C:\\dev\\SkynetOS\\assets\\a.png', 'C:\\dev\\SkynetOS\\', HOME)).toBe('%SKYNET%/assets/a.png');
  });
});
