import { describe, expect, it } from 'vitest';
import {
  RUN_KEY,
  RUN_VALUE,
  autostartCommand,
  installedAutostartCommand,
  bootVbs,
  parseRunValue,
  regAddArgs,
  regDeleteArgs,
  regQueryArgs,
  singleInstanceApplies
} from '../packages/shared/boot.js';

const B = String.fromCharCode(92);

describe('start with Windows', () => {
  it('uses the per-user Run key, so no administrator is needed', () => {
    expect(RUN_KEY).toBe(['HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Run'].join(B));
    expect(RUN_VALUE).toBe('SkynetOS');
  });

  it('builds reg.exe argument arrays, with the data as ONE argument', () => {
    const data = '"C:' + B + 'Windows' + B + 'System32' + B + 'wscript.exe" "C:' + B + 'Users' + B + 'a b' + B + 'boot.vbs"';
    const add = regAddArgs(data);
    expect(add.slice(0, 2)).toEqual(['add', RUN_KEY]);
    expect(add[add.indexOf('/d') + 1]).toBe(data);
    expect(add).toContain('/f');
    expect(regDeleteArgs()).toEqual(['delete', RUN_KEY, '/v', RUN_VALUE, '/f']);
    expect(regQueryArgs()).toEqual(['query', RUN_KEY, '/v', RUN_VALUE]);
  });

  it('quotes both paths in the Run command', () => {
    expect(autostartCommand('C:' + B + 'W' + B + 'wscript.exe', 'C:' + B + 'a b' + B + 'boot.vbs'))
      .toBe('"C:' + B + 'W' + B + 'wscript.exe" "C:' + B + 'a b' + B + 'boot.vbs"');
  });

  it('starts an installed copy from its exe, quoted, with no script between', () => {
    // docs/09: there is nothing to build, and the exe keeps its per-user path across updates.
    const exe = 'C:' + B + 'Users' + B + 'a b' + B + 'AppData' + B + 'Local' + B + 'Programs' + B + 'SkynetOS' + B + 'SkynetOS.exe';
    expect(installedAutostartCommand(exe)).toBe('"' + exe + '"');
    expect(installedAutostartCommand(exe)).not.toContain('wscript');
  });

  it('writes a login script that runs node on boot.mjs in a hidden window without waiting', () => {
    const vbs = bootVbs({ node: 'C:' + B + 'node' + B + 'node.exe', script: 'C:' + B + 'dev' + B + 'SkynetOS' + B + 'tools' + B + 'boot.mjs', repo: 'C:' + B + 'dev' + B + 'SkynetOS' });
    expect(vbs).toContain('CreateObject("WScript.Shell")');
    expect(vbs).toContain('sh.CurrentDirectory = "C:' + B + 'dev' + B + 'SkynetOS"');
    // The command line is a VBScript string: each inner quote doubled.
    expect(vbs).toContain('sh.Run """C:' + B + 'node' + B + 'node.exe"" ""C:' + B + 'dev' + B + 'SkynetOS' + B + 'tools' + B + 'boot.mjs""", 0, False');
  });

  it('reads the value back out of reg query output, and null when absent', () => {
    const out = `\r\nHKEY_CURRENT_USER${B}Software${B}Microsoft${B}Windows${B}CurrentVersion${B}Run\r\n    SkynetOS    REG_SZ    "C:${B}W${B}wscript.exe" "C:${B}a b${B}boot.vbs"\r\n\r\n`;
    expect(parseRunValue(out)).toBe(`"C:${B}W${B}wscript.exe" "C:${B}a b${B}boot.vbs"`);
    expect(parseRunValue('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
    expect(parseRunValue('    SkynetOSOther    REG_SZ    x')).toBeNull();
  });
});

describe('single instance', () => {
  it('applies to every normal start, and never to a smoke run', () => {
    expect(singleInstanceApplies({})).toBe(true);
    expect(singleInstanceApplies({ SKYNET_SMOKE_DIR: 'C:' + B + 'x' })).toBe(false);
  });
});
