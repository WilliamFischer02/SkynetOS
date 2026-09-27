import { describe, expect, it } from 'vitest';
import { COMMANDS, describeStatus, lastJson, parseArgs, venvPython, type TrainStatus } from '../tools/speech-finetune.js';

const status = (over: Partial<TrainStatus> = {}): TrainStatus => ({
  profile: 'jarvis',
  running: true,
  pid: 4242,
  started: '2026-09-26T21:00:00+00:00',
  elapsedMin: 3.2,
  update: 120,
  loss: 0.4123,
  epoch: 3,
  epochs: 100,
  updatesPerEpoch: 45,
  totalUpdates: 4500,
  secPerUpdate: 1.6,
  etaHours: 1.9,
  lastSaved: null,
  checkpoints: [{ file: 'pretrained_model_1250000.safetensors', mb: 1300, modified: '2026-09-26T21:00:05+00:00' }],
  gpu: { usedMiB: 8200, totalMiB: 12227 },
  error: null,
  log: 'C:/x/train.log',
  ...over
});

describe('speech:finetune arguments', () => {
  it('knows every subcommand the Python has', () => {
    expect(COMMANDS).toEqual(['prepare', 'train', 'status', 'stop', 'prune', 'apply', 'eval']);
  });

  it('needs a command and a plain profile name', () => {
    expect(parseArgs([])).toEqual({ error: expect.stringContaining('NAME A COMMAND') });
    expect(parseArgs(['dance', 'jarvis'])).toEqual({ error: expect.stringContaining('NAME A COMMAND') });
    expect(parseArgs(['status'])).toEqual({ error: expect.stringContaining('NAME A PROFILE') });
    expect(parseArgs(['status', '../etc'])).toEqual({ error: expect.stringContaining('NAME A PROFILE') });
    expect(parseArgs(['train', 'jarvis', '--epochs', '50'])).toEqual({ command: 'train', profile: 'jarvis', flags: ['--epochs', '50'] });
  });

  it('refuses to stop training without --yes, because that throws work away', () => {
    expect(parseArgs(['stop', 'jarvis'])).toEqual({ error: expect.stringContaining('--yes') });
    expect(parseArgs(['stop', 'jarvis', '--yes'])).toEqual({ command: 'stop', profile: 'jarvis', flags: ['--yes'] });
  });

  it('finds the venv where speech:install puts it', () => {
    expect(venvPython('C:\\Users\\w\\AppData\\Local').replace(/\\/g, '/')).toBe('C:/Users/w/AppData/Local/SkynetOS/voice/tts/venv/Scripts/python.exe');
  });
});

describe('speech:finetune status', () => {
  it('reads the last JSON line and ignores the progress chatter before it', () => {
    const out = '[speech-finetune] 117 clips\n{"a":1}\nnoise\n{"pid": 7, "log": "x"}\n';
    expect(lastJson<{ pid: number }>(out)?.pid).toBe(7);
    expect(lastJson('nothing here')).toBeNull();
  });

  it('says what is running, how far, how fast, and when it ends', () => {
    const lines = describeStatus(status());
    expect(lines[0]).toBe('jarvis: RUNNING (pid 4242) · 3.2 min since start');
    expect(lines[1]).toBe('update 120 of 4500 · epoch 3/100 · loss 0.4123');
    expect(lines[2]).toBe('1.6 s per update · about 1.9 h to go');
    expect(lines).toContain('on disk: pretrained_model_1250000.safetensors (1300 MB)');
    expect(lines).toContain('gpu: 8200 of 12227 MiB in use');
  });

  it('names an error and a missing checkpoint plainly', () => {
    const lines = describeStatus(status({ running: false, error: 'CUDA out of memory', checkpoints: [], update: 12, secPerUpdate: null }));
    expect(lines[0]).toContain('STOPPED WITH AN ERROR');
    expect(lines).toContain('on disk: no checkpoint yet');
    expect(lines.some((l) => l.startsWith('ERROR: CUDA out of memory'))).toBe(true);
  });

  it('reports a run that never started without inventing numbers', () => {
    const lines = describeStatus(status({ running: false, pid: null, started: null, elapsedMin: null, update: null, loss: null, epoch: null, secPerUpdate: null, etaHours: null, checkpoints: [], gpu: null }));
    expect(lines[0]).toBe('jarvis: NOT STARTED');
    expect(lines.some((l) => l.startsWith('update'))).toBe(false);
  });
});
