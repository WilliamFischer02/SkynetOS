import { describe, expect, it } from 'vitest';
import { chipTitle, closeLabel, failureLine } from '../packages/shared/ui-copy.js';

describe('failureLine', () => {
  it('joins what failed and what to do, upper case, one dash', () => {
    expect(failureLine('port 47821 is busy', 'COULD NOT START', 'change the port in settings.json')).toBe(
      'PORT 47821 IS BUSY — CHANGE THE PORT IN SETTINGS.JSON'
    );
  });

  it('uses the fallback when the other side said nothing', () => {
    expect(failureLine(undefined, 'could not stop', 'try again, or close its window')).toBe(
      'COULD NOT STOP — TRY AGAIN, OR CLOSE ITS WINDOW'
    );
    expect(failureLine('   ', 'NO CODE', 'press pair a device again')).toBe('NO CODE — PRESS PAIR A DEVICE AGAIN');
  });

  it('never writes the same instruction twice, and drops trailing stops', () => {
    expect(failureLine('COULD NOT SAVE — try again.', 'x', 'try again')).toBe('COULD NOT SAVE — TRY AGAIN');
    expect(failureLine('could not save.', 'x', 'try again')).toBe('COULD NOT SAVE — TRY AGAIN');
  });

  it('always ends in the action', () => {
    for (const error of ['boom', undefined, 'with a stop.']) {
      expect(failureLine(error, 'FAILED', 'do the thing')).toMatch(/ — DO THE THING$/);
    }
  });
});

describe('closeLabel', () => {
  it('names Esc by default and the panel key when given', () => {
    expect(closeLabel()).toBe('Close (Esc)');
    expect(closeLabel('L')).toBe('Close (L)');
  });
});

describe('chipTitle', () => {
  it('keeps the instruction when there is an error', () => {
    expect(chipTitle('camera 2 refused', 'cam A: 30 fps', 'click to switch manual control off')).toBe(
      'camera 2 refused — click to switch manual control off'
    );
  });

  it('shows the detail when nothing is wrong, and the instruction alone when there is neither', () => {
    expect(chipTitle(undefined, 'cam A: 30 fps', 'click to switch off')).toBe('cam A: 30 fps — click to switch off');
    expect(chipTitle(null, '  ', 'click to switch off')).toBe('click to switch off');
  });
});
