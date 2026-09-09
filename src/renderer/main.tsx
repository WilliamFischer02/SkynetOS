import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { SkynetBridge } from '@shared/ipc.js';
import { App } from './App.js';
import './styles.css';

declare global {
  interface Window {
    /** The only surface the renderer has on the OS. See src/preload/index.ts. */
    skynet: SkynetBridge;
  }
}

const host = document.getElementById('root');
if (!host) throw new Error('#root missing from index.html');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>
);
