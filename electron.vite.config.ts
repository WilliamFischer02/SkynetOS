import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = resolve(__dirname, 'packages/shared');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        // A sandboxed preload cannot load an ES module. electron-vite defaults preload to ESM
        // when package.json says "type": "module"; force CJS or the window comes up with no
        // bridge and a silent "require is not defined" in the preload's own console.
        output: { format: 'cjs', entryFileNames: 'index.cjs' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
      // Pixel art must never be inlined as a base64 data URI and re-encoded; keep assets as files.
      assetsInlineLimit: 0
    },
    server: {
      // The fonts and the baked atlas live outside src/renderer. Vite's dev server refuses to
      // serve files above the root unless they are allow-listed.
      fs: { allow: [resolve(__dirname, 'assets'), resolve(__dirname, 'src'), shared] }
    }
  }
});
