---
updated: 2026-09-23
purpose: Electron facts this repo has had to learn by doing. Each one names the file that depends on it.
---

# Electron notes

- **Windows toasts need an App User Model ID.** `new Notification({ title, body }).show()` shows
  nothing on Windows unless the process has an AUMID. A packaged NSIS install gets one from its
  shortcut; a dev copy must call `app.setAppUserModelId(process.execPath)` first. Done lazily in
  `src/main/services/scheduler.ts` for the `notify` task. Unverified on screen as of 2026-09-23;
  if nothing shows, look in Windows Settings → Notifications for an "electron" entry switched off.
- **`app.isPackaged`** separates the installed program from `npm run dev`; `updater.ts` returns
  at once when it is false, so a dev build never loads electron-updater.
- **Single instance:** `app.requestSingleInstanceLock()` in `instance.ts`. The newer copy wins by
  design ("replace on launch"), which is why a packed exe started plainly beside the dev app takes
  over. Smoke runs pass `SKYNET_SMOKE_DIR` to be exempt.
- **`BrowserWindow.getAllWindows()[0]` is the newest window**, the Face's once it exists. Use
  `boardWindow()` from `services/main-window.ts`.
- **`webContents.sendInputEvent` gives mouse events, not pointer events.** `BoardCanvas` listens for
  `pointerdown`, so the smoke harness dispatches real `PointerEvent`s in the page.
- **Top-level `await` in an ESM Electron entry deadlocks `app.whenReady()`.** Every probe puts its
  work in an unawaited `main()`.
- **A `WebContentsView` with no preload has no bridge**; main can still `executeJavaScript` into it
  (the prompt node). docs/07 records the honest shape of that.
- **`contextIsolation: true`, `sandbox: true`**: the renderer reaches main only through the typed
  preload bridge, and every channel is on an allowlist in `packages/shared/ipc.ts`.
- **vite-node strips the script path from `process.argv`**, so a `.ts` tool cannot recognise itself
  by argv; `prime/tools/board-overlap.ts` uses `process.env.VITEST` to avoid running under the test.
