import { describe, expect, it } from 'vitest';
import { AGENT_METHODS, CHANNELS, EVENTS, HOLOGRAM_ALLOWED, REMOTE_METHODS, VISION_METHODS, VISION_SHARED, VOICE_METHODS } from '../packages/shared/ipc.js';

/**
 * docs/11-JARVIS-VOICE.md and docs/07 § Desktop control: the channels that can put words in
 * JARVIS's mouth, move the mouse, or open a microphone belong to William's own windows and to
 * nobody else. Held here so a later edit cannot grant one to an agent or a phone by accident.
 */
const VOICE_CHANNELS = CHANNELS.filter((c) => /^(hologram|speech|profile|desktop|converse|dictate):/.test(c) || c === 'voice:typed');

describe('JARVIS Voice contract', () => {
  it('declares every channel the hologram window is allowed', () => {
    // 9 hologram (status, setEnabled, minimize, open, close, shutdown, setDesk, control, runAction)
    // + 5 speech + 6 profile + 6 desktop + 6 desktop record/action (fork H) + converse:ask
    // + voice:typed + 2 dictate.
    expect(VOICE_CHANNELS.length).toBe(36);
    for (const c of HOLOGRAM_ALLOWED) expect(CHANNELS).toContain(c);
  });

  it('keeps TRAIN ACTION recording and replay to the hologram window, never an agent or a phone (fork H)', () => {
    for (const c of ['desktop:recordStart', 'desktop:recordStop', 'desktop:recordStatus', 'desktop:actionSave', 'desktop:actionList', 'desktop:actionRun'] as const) {
      expect(CHANNELS).toContain(c);
      expect(HOLOGRAM_ALLOWED as readonly string[]).toContain(c);
      expect(AGENT_METHODS as readonly string[]).not.toContain(c);
      expect(REMOTE_METHODS as readonly string[]).not.toContain(c);
    }
    // docs/07: nothing deletes by a channel. William deletes the file.
    expect(CHANNELS as readonly string[]).not.toContain('desktop:actionDelete');
    expect(EVENTS as readonly string[]).toContain('desktop:recordState');
  });

  it('lets the hologram press its own controls by voice and dictate, and nobody else (fork G)', () => {
    for (const c of ['hologram:control', 'hologram:runAction', 'dictate:toggle', 'dictate:status'] as const) {
      expect(CHANNELS).toContain(c);
      expect(HOLOGRAM_ALLOWED as readonly string[]).toContain(c);
      expect(AGENT_METHODS as readonly string[]).not.toContain(c);
      expect(REMOTE_METHODS as readonly string[]).not.toContain(c);
    }
    for (const e of ['hologram:control', 'dictate:state']) expect(EVENTS as readonly string[]).toContain(e);
  });

  it('grants none of them to an agent or a remote device', () => {
    for (const c of VOICE_CHANNELS) {
      expect(AGENT_METHODS as readonly string[]).not.toContain(c);
      expect(REMOTE_METHODS as readonly string[]).not.toContain(c);
    }
  });

  it('keeps them away from the vision and voice-capture windows', () => {
    for (const c of VOICE_CHANNELS) {
      expect(VISION_METHODS as readonly string[]).not.toContain(c);
      expect(VISION_SHARED as readonly string[]).not.toContain(c);
      expect(VOICE_METHODS as readonly string[]).not.toContain(c);
    }
  });

  it('lets the hologram switch things and type, never run a plan or edit the board', () => {
    const allowed = HOLOGRAM_ALLOWED as readonly string[];
    for (const c of ['desktop:run', 'command:apply', 'node:open', 'terminal:open', 'session:start', 'prompt:send', 'hologram:setEnabled']) {
      expect(allowed).not.toContain(c);
    }
    for (const c of ['voice:setEnabled', 'voice:typed', 'desktop:setEnabled', 'desktop:halt', 'speech:stop', 'profile:record']) {
      expect(allowed).toContain(c);
    }
  });

  it('pushes speech and desktop state as events, and the profile recorder only to the capture window', () => {
    for (const e of ['speech:state', 'desktop:state', 'voice:record']) expect(EVENTS as readonly string[]).toContain(e);
  });
  it('closes, shuts down and lays out the window only from the window itself, and levels only from the microphone page (fork F1)', () => {
    for (const c of ['hologram:close', 'hologram:shutdown', 'hologram:setDesk'] as const) {
      expect(CHANNELS).toContain(c);
      expect(HOLOGRAM_ALLOWED as readonly string[]).toContain(c);
      expect(AGENT_METHODS as readonly string[]).not.toContain(c);
      expect(REMOTE_METHODS as readonly string[]).not.toContain(c);
    }
    // Microphone levels: the capture window delivers them, like a sentence, and nothing else may.
    expect(VOICE_METHODS as readonly string[]).toContain('voice:levels');
    expect(HOLOGRAM_ALLOWED as readonly string[]).not.toContain('voice:levels');
    expect(AGENT_METHODS as readonly string[]).not.toContain('voice:levels');
    expect(REMOTE_METHODS as readonly string[]).not.toContain('voice:levels');
    for (const e of ['speech:levels', 'voice:levels', 'hologram:scene']) expect(EVENTS as readonly string[]).toContain(e);
  });

  it('gives the tray icon no channel: its switches are main-side calls, and stay out of both allowlists (M13.5)', () => {
    // src/main/services/tray.ts calls setVoiceEnabled, setDesktopEnabled, setAutostart and
    // openHologram directly. Were a tray:* channel ever added, it would be user-only like these.
    expect((CHANNELS as readonly string[]).filter((c) => c.startsWith('tray:'))).toEqual([]);
    for (const c of ['voice:setEnabled', 'desktop:setEnabled', 'app:setAutostart', 'app:autostart', 'hologram:open'] as const) {
      expect(CHANNELS).toContain(c);
      expect(AGENT_METHODS as readonly string[]).not.toContain(c);
      expect(REMOTE_METHODS as readonly string[]).not.toContain(c);
    }
    for (const c of [...(AGENT_METHODS as readonly string[]), ...(REMOTE_METHODS as readonly string[])]) expect(c.startsWith('tray:')).toBe(false);
  });
});
