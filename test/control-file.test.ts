import { describe, expect, it } from 'vitest';
import { controlFilePath, ownsControlFile } from '../packages/shared/control-file.js';

/**
 * 2026-09-21: a smoke capture of the packed exe, run beside William's open app, overwrote his
 * copy's control.json and deleted it on exit. His board stayed open and every agent was told
 * SKYNETOS IS NOT RUNNING. These are the two rules that stop a second copy doing that.
 */

const USER_DATA = 'C:/Users/w/AppData/Roaming/SkynetOS';

describe('controlFilePath', () => {
  it('is userData for the app William is using', () => {
    expect(controlFilePath({}, USER_DATA)).toBe(`${USER_DATA}/control.json`);
  });

  it('is the capture folder for a smoke run, never userData', () => {
    const path = controlFilePath({ SKYNET_SMOKE_DIR: 'C:\\dev\\SkynetOS\\.smoke\\' }, USER_DATA);
    expect(path).toBe('C:\\dev\\SkynetOS\\.smoke/control.json');
    expect(path).not.toContain('AppData');
  });

  it('lets an explicit override win over both', () => {
    expect(controlFilePath({ SKYNET_CONTROL_FILE: 'D:/t/c.json', SKYNET_SMOKE_DIR: 'C:/smoke' }, USER_DATA)).toBe('D:/t/c.json');
  });
});

describe('ownsControlFile', () => {
  it('is true only for a file this process wrote', () => {
    const mine = JSON.stringify({ pipePath: 'p', token: 't', pid: 4242 });
    expect(ownsControlFile(mine, 4242)).toBe(true);
    expect(ownsControlFile(mine, 4243)).toBe(false);
  });

  it('never claims a file it cannot read: removing one is how a live board goes dark', () => {
    expect(ownsControlFile(null, 4242)).toBe(false);
    expect(ownsControlFile('', 4242)).toBe(false);
    expect(ownsControlFile('{ not json', 4242)).toBe(false);
    expect(ownsControlFile('{"pid":"4242"}', 4242)).toBe(false);
  });
});
