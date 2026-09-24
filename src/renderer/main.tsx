import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { SkynetBridge } from '@shared/ipc.js';
import { App } from './App.js';
import { AvatarApp } from './ui/AvatarApp.js';
import { installRemoteBridge, isRemotePage } from './remote/shim.js';
import { RemoteGate } from './remote/RemoteGate.js';
import './styles.css';
// The layout manager, icons and app panels: after styles.css so its overrides win, before the compact layer.
import './ui/chrome.css';
import './ui/mobile.css';

declare global {
  interface Window {
    /** The only surface the renderer has on the OS. See src/preload/index.ts. */
    skynet: SkynetBridge;
  }
}

const host = document.getElementById('root');
if (!host) throw new Error('#root missing from index.html');

/*
 * One bundle, two pages: the board, and at `#avatar` the JARVIS face window
 * (src/main/services/avatar-window.ts). The face window passes its chrome scale in the hash,
 * because it cancels the OS display scale exactly as the board window does.
 */
const isAvatar = window.location.hash.startsWith('#avatar');
if (isAvatar) {
  document.body.classList.add('avatar-mode');
  const ui = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('ui')) || 1;
  document.documentElement.style.setProperty('--ui-scale', String(Math.min(3, Math.max(1, Math.round(ui)))));
}

/*
 * A third page: the same board, served to a phone, tablet or other computer by the remote server
 * (docs/08). It has no preload, so `window.skynet` is installed here, over the remote bridge, before
 * anything reads it; RemoteGate pairs and connects before the app mounts.
 */
const remoteClient = !isAvatar && isRemotePage() ? installRemoteBridge() : null;

// The compact layout (ui/mobile.css): small windows, and any touch-first screen.
const compactQuery = window.matchMedia('(max-width: 820px), (pointer: coarse)');
const applyCompact = (): void => { document.documentElement.classList.toggle('compact', compactQuery.matches); };
applyCompact();
compactQuery.addEventListener('change', applyCompact);

createRoot(host).render(
  <StrictMode>
    {isAvatar ? <AvatarApp /> : remoteClient ? <RemoteGate client={remoteClient}><App /></RemoteGate> : <App />}
  </StrictMode>
);
