import { describe, expect, it } from 'vitest';
import { fineTuneName, useVoiceAction, voiceLabel, windowsVoiceName, type SpeechStatus } from '../packages/shared/speech.js';

/**
 * William, 2026-09-27: after a reboot the voice was Microsoft David although the "jarvis" profile
 * was selected; settings.json said `speech.backend: sapi` and nothing on screen did. The label below
 * is what the TRAIN panel and the caption now say, so it is held here word for word.
 */
const status = (over: Partial<SpeechStatus> = {}): SpeechStatus => ({
  enabled: true,
  backend: 'sapi',
  available: true,
  voice: 'Microsoft David Desktop',
  voices: ['Microsoft David Desktop', 'Microsoft Zira Desktop'],
  speaking: false,
  ...over
});

describe('voiceLabel: which voice will actually speak', () => {
  it('names Windows\' voice on the sapi backend, even with a profile remembered in the settings', () => {
    expect(voiceLabel(status())).toBe('WINDOWS VOICE · Microsoft David Desktop');
    expect(voiceLabel(status({ profile: 'jarvis' }))).toBe('WINDOWS VOICE · Microsoft David Desktop');
  });

  it('drops the status\'s advisory suffix and says STARTING before the sidecar answers', () => {
    expect(voiceLabel(status({ voice: 'Microsoft David Desktop (no British voice installed yet)' }))).toBe('WINDOWS VOICE · Microsoft David Desktop');
    expect(voiceLabel(status({ voice: null, available: false }))).toBe('WINDOWS VOICE · STARTING');
  });

  it('walks the server backend through WARMING, READY and FINE-TUNED', () => {
    expect(voiceLabel(status({ backend: 'server', profile: 'jarvis', warm: false }))).toBe('PROFILE jarvis · WARMING');
    expect(voiceLabel(status({ backend: 'server', profile: 'jarvis', warm: true }))).toBe('PROFILE jarvis · READY');
    expect(voiceLabel(status({ backend: 'server', profile: 'jarvis', warm: true, model: 'F5TTS_v1_Base' }))).toBe('PROFILE jarvis · READY');
    expect(voiceLabel(status({ backend: 'server', profile: 'jarvis', warm: true, model: 'model_1500_pruned.pt' }))).toBe('PROFILE jarvis · FINE-TUNED model_1500_pruned');
  });

  it('says the profile is unavailable, and who speaks instead, when the server is down', () => {
    const down = status({ backend: 'server', profile: 'jarvis', warm: false, error: 'NO SYNTHESIS ENVIRONMENT — RUN npm run speech:install' });
    expect(voiceLabel(down)).toBe('PROFILE jarvis · UNAVAILABLE — WINDOWS VOICE · Microsoft David Desktop');
  });

  it('tells the truth about the line in progress when it fell back to Windows\' voice', () => {
    const warmServer = status({ backend: 'server', profile: 'jarvis', warm: true });
    expect(voiceLabel(warmServer, 'server')).toBe('PROFILE jarvis · READY');
    expect(voiceLabel(warmServer, 'sapi')).toBe('WINDOWS VOICE · Microsoft David Desktop — PROFILE jarvis NOT READY');
    expect(voiceLabel(warmServer, 'recording')).toBe('PLAYING YOUR RECORDING');
  });

  it('says so when speech is off or the status is unknown', () => {
    expect(voiceLabel(status({ enabled: false }))).toBe('SPEECH OFF');
    expect(voiceLabel(null)).toBe('VOICE UNKNOWN');
    expect(voiceLabel(status({ backend: 'server', profile: '', warm: true }))).toBe('PROFILE default · READY');
  });
});

describe('fineTuneName and windowsVoiceName', () => {
  it('shortens a checkpoint path and treats the base model as not fine-tuned', () => {
    expect(fineTuneName('C:\\ckpts\\jarvis\\model_1500_pruned.pt')).toBe('model_1500_pruned');
    expect(fineTuneName('model_2000.safetensors')).toBe('model_2000');
    expect(fineTuneName('F5TTS_v1_Base')).toBeNull();
    expect(fineTuneName(undefined)).toBeNull();
    expect(windowsVoiceName('  Microsoft George  ')).toBe('Microsoft George');
    expect(windowsVoiceName('')).toBeNull();
  });
});

describe('useVoiceAction: the toggle reads as what a press will do', () => {
  it('offers the chosen profile from Windows\' voice, and Windows\' voice from the chosen profile', () => {
    expect(useVoiceAction(status(), 'jarvis')).toEqual({ backend: 'server', label: 'USE THE JARVIS PROFILE' });
    expect(useVoiceAction(status({ backend: 'server', profile: 'jarvis' }), 'jarvis')).toEqual({ backend: 'sapi', label: 'USE WINDOWS VOICE' });
  });

  it('offers a different profile when another one is speaking, and asks for one when none is chosen', () => {
    expect(useVoiceAction(status({ backend: 'server', profile: 'william' }), 'jarvis')).toEqual({ backend: 'server', label: 'USE THE JARVIS PROFILE' });
    expect(useVoiceAction(status(), null)).toEqual({ backend: 'server', label: 'USE A PROFILE' });
  });
});
