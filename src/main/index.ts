import { join } from 'node:path';
import { app, BrowserWindow, screen, shell } from 'electron';
import { registerIpc } from './ipc.js';
import { getSettings } from './services/settings.js';
import { boardRoot, pruneSnapshots } from './services/board-store.js';
import { closeDb, reapDeadSessions } from './services/db.js';
import { onSessionsChanged, restoreSessions, sweepSessions } from './services/session-manager.js';
import { onServicesChanged, stopAllServices, sweepServices } from './services/service-runner.js';
import { onFileChanged, stopWatching } from './services/watchers.js';
import { closeAllChatWindows } from './services/chat-window.js';

const isDev = !app.isPackaged;

/*
 * Kill Chromium's LCD subpixel text rendering, before anything creates a window.
 *
 * docs/02 anti-mush rule 8 forbids sub-pixel antialiasing. The CSS lever for it,
 * `-webkit-font-smoothing: none`, is a no-op on Windows — Chromium renders text through
 * DirectWrite and ignores it. A colour census of a screenshot proved it: the HUD text contained
 * rgb(224,132,27) and rgb(148,196,214), which are red/green subpixel fringes on glyph edges, not
 * blends of any two palette colours.
 *
 * These two switches are the real controls. `disable-lcd-text` forces greyscale antialiasing so
 * there is no colour fringing at all, and `disable-font-subpixel-positioning` makes glyphs land
 * on whole pixels instead of fractional ones, which is what a pixel font needs to stay crisp.
 *
 * Glyph edges in the DOM chrome still carry intermediate greys — that is what antialiasing is,
 * and the browser's text stack is not ours to replace. The palette-purity guarantee is scoped
 * to the canvas, where the board lives and where it is verified pixel by pixel. Board silkscreen
 * goes through renderSilkText, which thresholds alpha to binary and forces one exact palette
 * colour, precisely so it does not depend on any of this.
 */
app.commandLine.appendSwitch('disable-lcd-text');
app.commandLine.appendSwitch('disable-font-subpixel-positioning');

/**
 * Anti-mush rule 9: the window must not be fractionally scaled.
 *
 * Electron reports devicePixelRatio = osScaleFactor * zoomFactor in the renderer. At Windows'
 * 125% the OS factor is 1.25, so one CSS pixel covers 1.25 device pixels and every art pixel
 * lands on a fractional boundary — the exact shimmer this project treats as a crash-severity bug.
 *
 * docs/02 said to "snap to the nearest workable integer" zoom, but at 125% there is no workable
 * integer among the documented zooms: 1.25 * N is a whole number only for N in {4, 8, 12}, which
 * excludes zoom 2 and zoom 3 entirely. So instead of constraining the zoom, cancel the OS scale:
 * setZoomFactor(1 / scaleFactor) drives devicePixelRatio to exactly 1, and then 1 CSS px == 1
 * device px and every integer camera zoom is exact at any OS scaling. Logged either way.
 */
function neutralizeDisplayScaling(win: BrowserWindow): { scaleFactor: number; appliedZoomFactor: number } {
  const display = screen.getDisplayNearestPoint(win.getBounds());
  const scaleFactor = display.scaleFactor || 1;
  const appliedZoomFactor = 1 / scaleFactor;
  win.webContents.setZoomFactor(appliedZoomFactor);
  console.log(
    `[display] OS scaleFactor ${scaleFactor} -> zoomFactor ${appliedZoomFactor.toFixed(4)} ` +
    `(devicePixelRatio should now be 1; 1 art px = ${scaleFactor === 1 ? 1 : scaleFactor} device px at zoom 1)`
  );
  return { scaleFactor, appliedZoomFactor };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0E1A14', // SKYNET mask-dark, so the first paint is already the board
    title: 'SkynetOS',
    autoHideMenuBar: true,
    webPreferences: {
      // docs/07-SECURITY.md. All four are hard requirements, not defaults to be relaxed later.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, '../preload/index.cjs'),
      // Pixel art: never let Chromium apply its own smoothing to a canvas readback.
      backgroundThrottling: false
    }
  });

  win.once('ready-to-show', () => {
    neutralizeDisplayScaling(win);
    win.show();
  });

  // Re-apply when the window is dragged to a monitor with a different scale factor.
  win.on('moved', () => neutralizeDisplayScaling(win));

  /**
   * docs/07: deny every navigation and every new window. The only sanctioned way out of the app
   * is shell.openExternal for https:, which link.url nodes will use from the main process.
   */
  win.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL'];
    if (isDev && devServer && url.startsWith(devServer)) return;
    event.preventDefault();
    console.warn(`[security] blocked in-window navigation to ${url}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    else console.warn(`[security] blocked window.open for non-https url ${url}`);
    return { action: 'deny' };
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devServer) void win.loadURL(devServer);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  return win;
}

/**
 * Headless smoke capture. `node tools/smoke-shot.mjs` sets SKYNET_SMOKE_DIR and this drives the
 * window: let it settle, screenshot it, hold D to pan, screenshot again, report devicePixelRatio,
 * quit. It is how M0's exit criterion ("a window opens showing a tiled substrate at 3x, WASD pans
 * it") gets demonstrated instead of claimed, and it is the seed of the M5 golden-image diff.
 */
async function runSmokeCapture(win: BrowserWindow, outDir: string): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  mkdirSync(outDir, { recursive: true });

  /*
   * COORDINATE GOTCHA, learned the hard way: sendInputEvent takes DIP coordinates, but the
   * renderer's CSS pixels are DIP / zoomFactor. Main sets zoomFactor = 1/scaleFactor to force
   * devicePixelRatio to 1, so on this 200% display one DIP is TWO renderer CSS pixels. A grab at
   * DIP 192 lands at CSS 384, which at board zoom 3 is world pixel 128 — tile 8, not the tile 4
   * a naive reading predicts. That mismatch made an earlier version of this test grab a
   * different node than it named and report a failure that was not real. Never derive a grab
   * coordinate from an assumed camera position: snapshot the data, gesture, read back what
   * actually changed.
   */
  const shoot = async (name: string) => {
    const image = await win.webContents.capturePage();
    const file = join(outDir, name);
    writeFileSync(file, image.toPNG());
    const size = image.getSize();
    console.log(`[smoke] ${name}  ${size.width}x${size.height}`);
    return file;
  };

  try {
    await wait(2500); // font load + Pixi init + first frames
    const dpr = await win.webContents.executeJavaScript('window.devicePixelRatio');
    console.log(`[smoke] devicePixelRatio = ${String(dpr)} (must be 1 for pixel purity)`);

    await shoot('01-initial-3x.png');

    // Hold D. sendInputEvent goes through the same path as a real key, so this exercises the
    // actual listener rather than poking the camera directly.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'd' });
    await wait(1200);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'd' });
    await wait(200);
    await shoot('02-after-pan-right.png');

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '4' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '4' });
    await wait(400);
    await shoot('03-zoom-4x.png');

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '2' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '2' });
    await wait(400);
    await shoot('04-zoom-2x.png');

    /*
     * Drag the substrate to pan — the gesture, not the keyboard shortcut.
     *
     * At 4x deliberately. The root board is 64x40 tiles = 1024x640 world px, so at 2x it is
     * SMALLER than this viewport and clampCamera centres it: panning at 2x is impossible by
     * design and a drag test there proves nothing. The first version of this test ran at 2x and
     * reported a broken drag that was not broken.
     */
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '4' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '4' });
    await wait(400);
    await shoot('05a-before-drag-4x.png');

    // Drag the substrate. Left button down, a real sequence of moves, then up.
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 900, y: 700, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 12; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 900 - i * 14, y: 700 - i * 6, button: 'left' });
      await wait(25);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 900 - 12 * 14, y: 700 - 12 * 6, button: 'left', clickCount: 1 });
    await wait(350);
    await shoot('05b-after-drag-4x.png');

    // Tab to the first node and open the inspector on it, so the capture proves selection,
    // target resolution and the edit interface actually render — not just the substrate.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '3' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '3' });
    await wait(200);
    for (let i = 0; i < 4; i++) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await wait(150);
    }
    await wait(500);
    await shoot('06-selected-inspector.png');

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F2' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F2' });
    await wait(1200);
    await shoot('07-node-editor.png');

    // Close the form again so the next steps are not typing into an input.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait(200);

    /*
     * M4: the artifact cartridge, resolved against the REAL jars in C:/dev/TheStalker.
     * This is the milestone's exit criterion — "the Stalker artifact cartridge shows
     * thestalker-0.4.2.jar / 11m ago" — checked against whatever is actually on disk.
     */
    const artifacts = await win.webContents.executeJavaScript(
      `window.skynet['artifact:resolveBoard']('minecraftos')`
    ) as {
      nodeId: string; fileName: string | null; version: string | null;
      stale: string; lastCommit: string | null;
      target: { state: string; resolved: string | null; matchCount?: number; mtimeMs?: number };
    }[];

    for (const a of artifacts) {
      const age = a.target.mtimeMs
        ? `${Math.round((Date.now() - a.target.mtimeMs) / 60000)}m ago`
        : 'no mtime';
      console.log(
        `[smoke] artifact ${a.nodeId}: ${a.fileName ?? '(none)'}` +
        `${a.version ? ` v${a.version}` : ''} · ${age} · ${a.target.state}` +
        ` · stale=${a.stale}${a.target.matchCount !== undefined ? ` · ${a.target.matchCount} match(es)` : ''}`
      );
    }

    // Drag-out: resolve the file the badge would hand to Windows. Not actually starting the drag
    // -- startDrag needs a live mouse gesture, and once it fires the OS owns the pointer.
    const dragTarget = await win.webContents.executeJavaScript(
      `window.skynet['artifact:resolve']('minecraftos', 'a1_jar_stalker')`
    ) as { target: { resolved: string | null } };
    console.log(`[smoke] drag-out would hand Windows: ${dragTarget.target.resolved ?? '(nothing)'}`);

    // Drop-in ingestion, classified against real paths on this machine.
    const suggestions = await win.webContents.executeJavaScript(
      `window.skynet['ingest:classify'](${JSON.stringify([
        'C:/dev/TheStalker/build/libs/thestalker-0.1.0.jar',
        'C:/dev/TheStalker',
        'C:/definitely/not/here.jar'
      ])})`
    ) as { path: string; kind: string; fields: Record<string, unknown> }[];
    for (const s of suggestions) {
      console.log(`[smoke] drop-in ${s.path} -> ${s.kind}${s.fields['glob'] ? ` glob=${String(s.fields['glob'])}` : ''}`);
    }
    console.log(`[smoke] drop-in ignored the path that does not exist: ${suggestions.length === 2}`);

    // Watchers, with the polling decision reported.
    const watch = await win.webContents.executeJavaScript(
      `window.skynet['watch:board']('minecraftos')`
    ) as { watched: number; polled: number };
    console.log(`[smoke] watching ${watch.watched} director(ies), ${watch.polled} need polling`);

    /*
     * Prove the RESUME mechanism end to end, against the real database, without launching a
     * real Claude Code session.
     *
     * Deliberately not spawning `claude`: that would open a terminal and start a conversation in
     * William's repo, consuming his usage, for a test he did not ask for. What CAN be proved
     * automatically is the part that actually decides resume-vs-fresh — that a conversation id
     * written by one "launch" is the id the NEXT launch resumes, read back through the same
     * database that survives an app restart. The spawn itself is covered by unit tests on
     * launch-args.ts, and by clicking the chip once.
     */
    const { insertSession, claudeSessionIdsForNode } = await import('./services/db.js');
    const { claudeArgs } = await import('./services/launch-args.js');
    const { conversationExists } = await import('./services/conversations.js');
    const { randomUUID } = await import('node:crypto');

    const probeNode = 'smoke_probe_agent';
    const probe = {
      id: probeNode, kind: 'agent.code' as const, name: 'PROBE',
      pos: { x: 0, y: 0 }, cwd: 'C:/dev/SkynetOS', launch: 'popout' as const
    };
    const recordedIds = () => claudeSessionIdsForNode('root', probeNode);
    const firstRealId = () => recordedIds().find((id) => conversationExists(id, 'C:\\dev\\SkynetOS')) ?? null;

    // First launch: SkynetOS mints a conversation id and records it before spawning.
    const first = claudeArgs({
      node: probe,
      storedSessionId: firstRealId(),
      storedIsReal: firstRealId() !== null,
      fresh: false,
      addDirs: []
    });
    insertSession({
      id: randomUUID(),
      node_id: probeNode,
      board_id: 'root',
      kind: 'popout',
      cwd: 'C:/dev/SkynetOS',
      claude_session_id: first.sessionId,
      pid: null,
      started_at: new Date().toISOString()
    });
    console.log(`[smoke] first launch: resumed=${first.resumed} conversation=${first.sessionId.slice(0, 8)} flag=${first.args[0]}`);

    /*
     * Second launch. This used to assert "SAME CONVERSATION ACROSS LAUNCHES" and pass — while
     * every conversation id in the real database was a phantom and `claude --resume` was failing
     * on every click. The test proved the id round-tripped through SQLite, which was never the
     * question. The question is whether the conversation EXISTS, so that is what it checks now.
     */
    const recalled = recordedIds();
    const realId = firstRealId();
    const phantoms = recalled.filter((id) => !conversationExists(id, 'C:\\dev\\SkynetOS'));
    console.log(`[smoke] recorded ids: ${recalled.length}, real on disk: ${realId ? 1 : 0}, phantom: ${phantoms.length}`);

    const second = claudeArgs({
      node: probe,
      storedSessionId: realId,
      storedIsReal: realId !== null,
      fresh: false,
      addDirs: []
    });
    console.log(`[smoke] second launch: resumed=${second.resumed} conversation=${second.sessionId.slice(0, 8)} flag=${second.args[0]}`);
    console.log(`[smoke] REFUSED TO RESUME A CONVERSATION THAT DOES NOT EXIST: ${!second.resumed && second.args[0] === '--session-id'}`);

    // And the copy-able command, which is the escape hatch when the launcher itself is broken.
    const { resumeCommandLine } = await import('./services/launch-args.js');
    console.log(`[smoke] resume command: ${resumeCommandLine('C:/dev/SkynetOS', second.sessionId)}`);

    /*
     * Exercise the session IPC channel and its guards, through the real bridge, without spawning
     * anything. These are the paths a misconfigured board actually hits, and each must produce a
     * legible refusal rather than an exception or a silent no-op.
     */
    const guardJarvis = await win.webContents.executeJavaScript(
      `window.skynet['session:start']('root', 'u1_jarvis', false)`
    ) as { ok: boolean; error?: string };
    console.log(`[smoke] session:start on a non-agent node refused: ${!guardJarvis.ok} — ${guardJarvis.error ?? ''}`);

    const listed = await win.webContents.executeJavaScript(
      `window.skynet['session:list']()`
    ) as unknown[];
    console.log(`[smoke] session:list returned an array: ${Array.isArray(listed)} (${listed.length} live)`);

    const noConversation = await win.webContents.executeJavaScript(
      `window.skynet['session:resumeCommand']('root', 'u2_agent_skynet')`
    ) as string | null;
    console.log(`[smoke] resume command before any launch: ${noConversation === null ? 'null (correct)' : noConversation}`);

    const serviceGuard = await win.webContents.executeJavaScript(
      `window.skynet['service:start']('root', 'u2_agent_skynet')`
    ) as { ok: boolean; error?: string };
    console.log(`[smoke] service:start on a non-service node refused: ${!serviceGuard.ok} — ${serviceGuard.error ?? ''}`);

    /*
     * ── The launch proof ──────────────────────────────────────────────────────────────────────
     *
     * Everything above this line tests the launch WITHOUT launching, and that is exactly how the
     * project shipped a session manager that had never once opened a working terminal. The unit
     * tests were green, the smoke log said SAME CONVERSATION ACROSS LAUNCHES, and every chip on
     * the board was dead.
     *
     * So: opt in with SKYNET_SMOKE_LAUNCH and a real window opens.
     *
     *   terminal  a plain shell on this repo. Proves the whole staged-script and pid-file
     *             machinery end to end, and costs nothing.
     *   agent     a real Claude Code session on U2. Opens a conversation and uses real quota,
     *             which is why it is not the default.
     *
     * Left out of `npm run smoke` because a screenshot run should not litter the desktop with
     * terminals — but it is one env var away whenever this path is touched.
     */
    const launchProof = process.env['SKYNET_SMOKE_LAUNCH'];
    if (launchProof === 'terminal' || launchProof === 'agent') {
      const before = Date.now();
      if (launchProof === 'terminal') {
        const result = await win.webContents.executeJavaScript(
          `window.skynet['terminal:open']('root', 's1_repo_skynet', { elevated: false })`
        ) as { ok: boolean; pid: number | null; cwd: string; scriptFile: string; error?: string };
        console.log(`[smoke] terminal:open ok=${result.ok} pid=${result.pid ?? '-'} cwd=${result.cwd} in ${Date.now() - before}ms`);
        console.log(`[smoke]   script: ${result.scriptFile}`);
        if (!result.ok) console.log(`[smoke]   error: ${result.error ?? ''}`);
        console.log(`[smoke] A REAL TERMINAL OPENED AND REPORTED ITS PID: ${result.ok && result.pid !== null}`);
      } else {
        const nodeId = process.env['SKYNET_SMOKE_LAUNCH_NODE'] ?? 'u2_agent_skynet';
        const result = await win.webContents.executeJavaScript(
          `window.skynet['session:start']('root', ${JSON.stringify(nodeId)}, { fresh: false })`
        ) as { ok: boolean; error?: string; note?: string; session?: { pid: number | null; claudeSessionId: string | null; state: string } };
        console.log(`[smoke] session:start ok=${result.ok} in ${Date.now() - before}ms`);
        console.log(`[smoke]   note: ${result.note ?? result.error ?? ''}`);
        if (result.session) {
          console.log(`[smoke]   pid=${result.session.pid ?? '-'} state=${result.session.state} conversation=${result.session.claudeSessionId ?? '-'}`);
          /*
           * The claim that has to be checked on the OTHER side of the launch.
           *
           * Two different pieces of evidence, because they answer different questions and arrive
           * at very different times:
           *
           *   process   is `claude` running, in this window, on THIS conversation id? Decisive,
           *             and true within seconds of the agent starting. This is the launch.
           *   jsonl     has ~/.claude/projects/<cwd>/<id>.jsonl appeared? That is Claude Code
           *             committing the conversation to disk, which only happens once the first
           *             turn completes — after priming, after reading, possibly after a trust
           *             prompt a human has to answer. Absence proves nothing about the launch.
           *
           * Checking only the jsonl reports a perfectly good launch as a failure, which is its
           * own kind of lying.
           */
          const { execFileSync } = await import('node:child_process');
          const { conversationExists } = await import('./services/conversations.js');
          const id = result.session.claudeSessionId ?? '';

          let running = false;
          for (let i = 0; i < 40 && !running; i++) {
            try {
              const out = execFileSync('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-Command',
                `(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -like '*${id}*' }).ProcessId`
              ], { encoding: 'utf8', windowsHide: true }).trim();
              running = out.length > 0;
            } catch { /* powershell unavailable; the jsonl check still stands */ }
            if (!running) await wait(500);
          }
          console.log(`[smoke] CLAUDE CODE IS RUNNING ON THIS CONVERSATION: ${running}`);
          console.log(`[smoke]   (conversation committed to disk yet: ${conversationExists(id, 'C:\\dev\\SkynetOS')} — lags the launch by a full turn)`);
        }
      }
    }

    /*
     * Prove ROOM DESCENT: Tab until MinecraftOS is selected, activate it, and confirm the
     * breadcrumb and the board actually changed. Then Backspace back out. This is M2's exit
     * criterion — "click MinecraftOS, descend, see four mod clusters, press Esc, come back" —
     * driven through real key events rather than by calling the store.
     */
    const crumbText = () => win.webContents.executeJavaScript(
      "document.querySelector('.breadcrumb')?.textContent ?? ''"
    ) as Promise<string>;
    const selectedName = () => win.webContents.executeJavaScript(
      "document.querySelector('.inspector .nodename')?.textContent ?? ''"
    ) as Promise<string>;

    let found = false;
    for (let i = 0; i < 14 && !found; i++) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await wait(120);
      found = (await selectedName()).toLowerCase().includes('minecraft');
    }
    console.log(`[smoke] found the MinecraftOS drive by tabbing: ${found}`);

    const crumbBefore = await crumbText();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await wait(250);
    await shoot('11-iris-closing.png');
    await wait(900);
    const crumbAfter = await crumbText();
    const roomNodes = await win.webContents.executeJavaScript(
      "document.querySelector('.hud')?.textContent ?? ''"
    ) as string;
    console.log(`[smoke] descend: "${crumbBefore.trim()}" -> "${crumbAfter.trim()}"  changed=${crumbBefore !== crumbAfter}`);
    console.log(`[smoke] room HUD: ${roomNodes.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
    await shoot('12-inside-minecraftos.png');

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    await wait(1000);
    const crumbBack = await crumbText();
    console.log(`[smoke] ascend: back to "${crumbBack.trim()}"  returned=${crumbBack === crumbBefore}`);
    await shoot('13-back-at-root.png');

    /*
     * Prove NODE DRAGGING commits a move. Enter Edit Board mode, grab a component, drag it two
     * tiles, drop it, and read the position back out of the board file. This is the other half
     * of "click and drag": panning moves the camera, this moves the data.
     */
    const { readFileSync: readNow } = await import('node:fs');
    const boardPath = join(boardRoot(), 'root.board.json');
    const posOf = (id: string) => {
      const b = JSON.parse(readNow(boardPath, 'utf8')) as { nodes: { id: string; pos: { x: number; y: number } }[] };
      return b.nodes.find((n) => n.id === id)?.pos;
    };

    // Zoom to 3x, then drag the board hard down-right so the camera CLAMPS to 0,0. That makes
    // every node's screen position derivable as tile * 16 * zoom, with no assumptions about
    // where a previous step left the camera. Dragging right moves the camera left; see panTo.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '3' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '3' });
    await wait(300);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 400, y: 400, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 20; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 400 + i * 100, y: 400 + i * 60, button: 'left' });
      await wait(15);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 2400, y: 1300, button: 'left', clickCount: 1 });
    await wait(400);

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'e' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'e' });
    await wait(400);
    await shoot('08-edit-board-mode.png');

    /*
     * Assumption-free: snapshot every node position, drag from the middle of the viewport,
     * then report which node actually moved and by how much. An earlier version of this test
     * computed a grab coordinate from an assumed camera position, grabbed a different node than
     * it named, and would have reported a false failure.
     */
    const allPos = () => {
      const b = JSON.parse(readNow(boardPath, 'utf8')) as { nodes: { id: string; pos: { x: number; y: number } }[] };
      return new Map(b.nodes.map((n) => [n.id, `${n.pos.x},${n.pos.y}`]));
    };

    const posBefore = allPos();
    const grabX = 700;
    const grabY = 500;
    const whatIsThere = await win.webContents.executeJavaScript(
      "document.querySelector('.inspector .nodename')?.textContent ?? '(nothing)'"
    ) as string;
    void whatIsThere;

    win.webContents.sendInputEvent({ type: 'mouseDown', x: grabX, y: grabY, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: grabX + i * 10, y: grabY + i * 5, button: 'left' });
      await wait(30);
    }
    await shoot('09-drag-ghost.png');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: grabX + 100, y: grabY + 50, button: 'left', clickCount: 1 });
    await wait(800);

    const posAfter = allPos();
    const moved = [...posBefore.entries()].filter(([id, p]) => posAfter.get(id) !== p);
    console.log(`[smoke] node drag moved ${moved.length} node(s): ${moved.map(([id, p]) => `${id} ${p} -> ${posAfter.get(id)}`).join('; ') || 'NONE'}`);
    await shoot('10-after-node-drag.png');

    const undoneMove = await win.webContents.executeJavaScript(`window.skynet['command:undo']()`) as { ok: boolean };
    await wait(500);
    const posRestored = allPos();
    const stillMoved = [...posBefore.entries()].filter(([id, p]) => posRestored.get(id) !== p);
    console.log(`[smoke] node drag undo: ok=${undoneMove.ok} every node back at origin=${stillMoved.length === 0}`);

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'e' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'e' });
    await wait(200);

    // --- prove the edit path end to end, through the real IPC bridge and the real command bus.
    // Screenshots show that the form renders; this shows that saving it changes the file on
    // disk, that the change validates, that a snapshot was taken, and that Ctrl+Z reverses it.
    const { readFileSync } = await import('node:fs');
    // boardRoot() resolves to resources/board when packaged and the repo copy in dev, so the
    // same harness proves the same thing against a real installed build.
    const boardFile = join(boardRoot(), 'root.board.json');
    const MARKER = 'SMOKE TEST MARKER ' + Date.now();
    const before = readFileSync(boardFile, 'utf8');

    const applied = await win.webContents.executeJavaScript(`
      window.skynet['command:apply']({
        command: { type: 'node.update', boardId: 'root', nodeId: 'u2_agent_skynet', patch: { notes: ${JSON.stringify(MARKER)} } },
        actor: 'user',
        label: 'smoke edit'
      })
    `) as { ok: boolean; error?: string; snapshot?: string | null; changed?: unknown[] };

    const afterWrite = readFileSync(boardFile, 'utf8');
    console.log(`[smoke] edit applied: ok=${applied.ok} changed=${applied.changed?.length ?? 0} snapshot=${applied.snapshot ? 'yes' : 'NO'}`);
    console.log(`[smoke] marker written to disk: ${afterWrite.includes(MARKER)}`);
    if (applied.error) console.log(`[smoke] edit error: ${applied.error}`);

    const undone = await win.webContents.executeJavaScript(`window.skynet['command:undo']()`) as { ok: boolean; error?: string };
    const afterUndo = readFileSync(boardFile, 'utf8');
    console.log(`[smoke] undo: ok=${undone.ok} marker gone: ${!afterUndo.includes(MARKER)}`);
    console.log(`[smoke] file byte-identical to before the edit: ${afterUndo === before}`);
    if (undone.error) console.log(`[smoke] undo error: ${undone.error}`);

    // Prove a bad edit is refused rather than written.
    const rejected = await win.webContents.executeJavaScript(`
      window.skynet['command:apply']({
        command: { type: 'node.update', boardId: 'root', nodeId: 'u2_agent_skynet', patch: { pos: { x: 9999, y: 9999 } } },
        actor: 'user', label: 'smoke invalid'
      })
    `) as { ok: boolean; error?: string };
    console.log(`[smoke] off-board move refused: ${!rejected.ok}`);
    console.log(`[smoke] board unchanged by refusal: ${readFileSync(boardFile, 'utf8') === afterUndo}`);

    // Prove deletion cannot happen without explicit approval, even if the caller lies by omission.
    const unapproved = await win.webContents.executeJavaScript(`
      window.skynet['command:apply']({
        command: { type: 'node.delete', boardId: 'root', nodeId: 'j1_github' },
        actor: 'jarvis', label: 'smoke delete without approval'
      })
    `) as { ok: boolean; needsApproval?: boolean };
    console.log(`[smoke] unapproved delete blocked: ${!unapproved.ok} needsApproval=${String(unapproved.needsApproval)}`);
    console.log(`[smoke] board unchanged by blocked delete: ${readFileSync(boardFile, 'utf8') === afterUndo}`);

    console.log('[smoke] done');
  } catch (err) {
    console.error('[smoke] FAILED', err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

app.whenReady().then(() => {
  const settings = getSettings();
  console.log(`[settings] devRoots=${settings.devRoots.join(', ')} reducedMotion=${settings.reducedMotion} streamMode=${settings.streamMode}`);
  pruneSnapshots(settings.snapshotRetentionDays);

  /*
   * Reap before restore. A crash, a reboot or a Task Manager kill all leave rows claiming to be
   * live, and a session dock that lies about what is running is worse than no dock at all.
   * reapDeadSessions closes the rows whose processes are gone; restoreSessions re-adopts the
   * ones that genuinely survived, so closing and reopening SkynetOS does not orphan an agent.
   */
  reapDeadSessions();
  restoreSessions();

  registerIpc();
  const win = createWindow();

  // Push live session and service state to the renderer. The dock must not have to poll.
  onSessionsChanged((sessions) => {
    if (!win.isDestroyed()) win.webContents.send('sessions:changed', sessions);
  });
  onServicesChanged((services) => {
    if (!win.isDestroyed()) win.webContents.send('services:changed', services);
  });
  onFileChanged((event) => {
    if (!win.isDestroyed()) win.webContents.send('files:changed', event);
  });

  // A detached popout terminal can be closed in ways that never reach our 'exit' handler, so the
  // dock is reconciled against the OS on a slow timer as well as on events.
  const sweep = setInterval(() => { sweepSessions(); sweepServices(); }, 5000);
  app.on('will-quit', () => {
    clearInterval(sweep);
    // Agent popouts are detached on purpose and outlive us. Services do not: a dev server that
    // survives the app that started it is a port you cannot rebind and a process you cannot find.
    stopAllServices();
    // A conversation window is ours, not the OS's — it must not outlive the board it belongs to.
    closeAllChatWindows();
    void stopWatching();
    closeDb();
  });

  const smokeDir = process.env['SKYNET_SMOKE_DIR'];
  if (smokeDir) {
    // Renderer console output goes to the renderer's own devtools, which a headless capture run
    // never opens. Forwarding the lines we care about is how the smoke log can show that the
    // router actually re-ran after a node moved, rather than asserting that it must have.
    win.webContents.on('console-message', (event) => {
      if (/^\[(router|atlas|ui|mosaic)\]/.test(event.message)) console.log(`[renderer] ${event.message}`);
    });
    win.once('ready-to-show', () => void runSmokeCapture(win, smokeDir));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Nothing in this app has any business loading remote code into the main window.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
    const devServer = process.env['ELECTRON_RENDERER_URL'];
    if (isDev && devServer && details.url.startsWith(devServer)) return cb({});
    console.warn(`[security] blocked remote request from the main window: ${details.url}`);
    cb({ cancel: true });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
