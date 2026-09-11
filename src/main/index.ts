import { join } from 'node:path';
import { app, BrowserWindow, screen, shell } from 'electron';
import { DEFAULT_FOOTPRINT, type Board, type NodeKind } from '@shared/types.js';
import { findFreeSpaceOnBoard } from './services/placement.js';
import { callAsAgent, registerIpc } from './ipc.js';
import { startControlServer, stopControlServer } from './services/control-server.js';
import { writeMcpConfig } from './services/mcp-config.js';
import { dispatchMail } from './services/mail-dispatch.js';
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

    /*
     * Zoom to 3x and work out where a chosen node actually is on screen.
     *
     * This used to drag the board hard down-right so the camera clamped to 0,0, which made every
     * node's screen position derivable as tile * 16 * zoom. That worked while the board was barely
     * bigger than the window and the components sat near its origin. Tripling every board moved
     * the content to the middle of a 192x120 grid, so the clamp corner is now bare substrate: the
     * harness grabbed empty board, moved nothing, and reported a camera "failure" that was really
     * the harness panning with a drag it thought was a node move.
     *
     * So it no longer assumes. It reads the live camera and converts a real node's real position
     * into a real screen coordinate.
     */
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '3' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '3' });
    await wait(300);

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

    /*
     * ── The camera must not move when a node does ────────────────────────────────────────────
     *
     * William: "as of now re-arranging the board snaps back to the default camera position each
     * time a node is moved." The cause was BoardCanvas keying its init effect on `props.board`,
     * so every mutation destroyed and rebuilt the whole Pixi application — camera, zoom, mosaics
     * and router with it.
     *
     * So this pans somewhere deliberately non-default FIRST, and asserts the camera is still
     * there after the drop. Without the pan the test would pass at 0,0 by accident, which is
     * exactly the value the bug reset to.
     */
    /*
     * ── Dragging, for real ───────────────────────────────────────────────────────────────────
     *
     * `win.webContents.sendInputEvent({ type: 'mouseDown' })` does NOT produce a `pointerdown`.
     * BoardCanvas listens for pointer events — that is what gives it capture and what lets a drag
     * that leaves the window still finish — so every mouse drag this harness has "performed" since
     * that change landed on nothing at all. The screenshots named `09-drag-ghost.png` were of a
     * board with no drag in progress, and nobody noticed, because the only assertion was "did a
     * node move", which a broken harness and a broken app both answer the same way.
     *
     * Real hardware produces both. `sendInputEvent` produces only the mouse half. So the harness
     * dispatches PointerEvents in the page instead: same listeners, same handlers, same code path
     * a mouse takes. They are `isTrusted: false`, which nothing in the renderer tests for.
     *
     * `pointerdown` goes to the canvas; `pointermove` and `pointerup` go to `window`, because that
     * is where BoardCanvas listens for them — see the comment there about drags released
     * off-canvas never delivering `pointerup`.
     */
    const pointerDrag = async (from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> => {
      await win.webContents.executeJavaScript(`
        (async () => {
          const canvas = document.querySelector('canvas');
          if (!canvas) throw new Error('no canvas in the page');
          const ev = (type, x, y, target) => target.dispatchEvent(new PointerEvent(type, {
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
            clientX: x, clientY: y, bubbles: true, cancelable: true
          }));
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          ev('pointerdown', ${from.x}, ${from.y}, canvas);
          for (let i = 1; i <= ${steps}; i++) {
            const t = i / ${steps};
            ev('pointermove', ${from.x} + (${to.x} - ${from.x}) * t, ${from.y} + (${to.y} - ${from.y}) * t, window);
            await wait(25);
          }
          ev('pointerup', ${to.x}, ${to.y}, window);
        })()
      `);
    };

    const cameraNow = async (): Promise<string> => {
      // Read the live value the ticker publishes, not the HUD — see BoardCanvas.
      const cam = await win.webContents.executeJavaScript(
        "JSON.stringify(window.__skynetCamera ?? null)"
      ) as string;
      const parsed = JSON.parse(cam) as { x: number; y: number } | null;
      return parsed ? `${parsed.x},${parsed.y}` : '?';
    };

    /*
     * A short pan, not a long one. The point is only to be somewhere the bug's reset value is not,
     * and the camera now ARRIVES framed on the board's content rather than at 0,0 — so a nine
     * hundred millisecond pan at full ramp speed sails clean off the components and leaves nothing
     * under the grab point.
     */
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'd' });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 's' });
    await wait(250);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'd' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 's' });
    await wait(400);
    const cameraBefore = await cameraNow();
    console.log(`[smoke] panned away from the origin: CAM ${cameraBefore}`);

    const posBefore = allPos();

    /*
     * Which node can we actually grab, and where is it on screen right now?
     *
     * Three assumptions used to live here and every one of them has now been wrong:
     *
     *   1. "The camera is clamped to 0,0, so a node's screen position is tile * 16 * zoom."
     *      Tripling every board moved the content to the middle of a 192x120 grid, so the clamp
     *      corner became bare substrate and the harness dragged empty board.
     *   2. "win.getContentSize() is the coordinate space sendInputEvent uses." It is not. The OS
     *      reports scaleFactor 2, so main sees 1267x717 while the page — and every input event —
     *      is 2534x1434.
     *   3. "A node in the middle of the window is clickable." The usage meter, minimap, breadcrumb
     *      and inspector are DOM chrome drawn OVER the canvas. A mousedown on the minimap is a
     *      camera JUMP, which looks exactly like the camera-reset bug this section exists to catch.
     *
     * The fix for all three is to stop reasoning about the window from outside it. The page knows
     * where its own camera is, how big it is, and what is on top at any point — so it picks the
     * target, and `document.elementFromPoint` is the arbiter of "clickable" rather than a guess
     * about which margins the chrome occupies.
     */
    const liveBoard = JSON.parse(readNow(boardPath, 'utf8')) as {
      nodes: { id: string; kind: string; pos: { x: number; y: number }; footprint?: { w: number; h: number } }[]
    };
    const grabbableNodes = liveBoard.nodes
      .filter((n) => n.kind !== 'note.silk' && n.kind !== 'group.zone' && !n.kind.startsWith('decor.'))
      // A drive descends when clicked, so its drag competes with another gesture. Grab anything else.
      .filter((n) => n.kind !== 'drive.room')
      .map((n) => {
        const fp = n.footprint ?? DEFAULT_FOOTPRINT[n.kind as NodeKind] ?? { w: 2, h: 2 };
        return { id: n.id, wx: (n.pos.x + fp.w / 2) * 16, wy: (n.pos.y + fp.h / 2) * 16 };
      });

    const pick = await win.webContents.executeJavaScript(`
      (() => {
        const cam = window.__skynetCamera;
        if (!cam) return JSON.stringify({ error: 'the camera has not published yet' });
        const nodes = ${JSON.stringify(grabbableNodes)};
        const tried = [];
        for (const n of nodes) {
          const x = Math.round((n.wx - cam.x) * cam.zoom);
          const y = Math.round((n.wy - cam.y) * cam.zoom);
          if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
          const el = document.elementFromPoint(x, y);
          const tag = el ? (el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '')) : 'none';
          tried.push(n.id + '@' + tag);
          // The board is the only canvas in the page. Anything else on top is chrome.
          if (el && el.tagName === 'CANVAS') {
            return JSON.stringify({ id: n.id, x, y, view: [window.innerWidth, window.innerHeight], cam, tried: tried.length });
          }
        }
        return JSON.stringify({ error: 'every node is under chrome or off screen', tried });
      })()
    `) as string;

    const target = JSON.parse(pick) as
      { id: string; x: number; y: number; view: number[]; cam: { x: number; y: number; zoom: number }; tried: number }
      | { error: string; tried?: string[] };

    if ('error' in target) {
      console.log(`[smoke] NO GRABBABLE NODE: ${target.error}${target.tried ? ` (tried ${target.tried.join(', ')})` : ''}`);
    } else {
      console.log(`[smoke] grabbing ${target.id} at ${target.x},${target.y} in a ${target.view.join('x')} view, camera ${target.cam.x},${target.cam.y} @${target.cam.zoom}x`);
    }
    const grabX = 'error' in target ? 700 : target.x;
    const grabY = 'error' in target ? 500 : target.y;

    /*
     * Drag far, not two tiles. A short drag lands on whatever is next door and `canDrop` refuses
     * it — a refused drop and a broken drag both read as "moved 0 nodes", which is the wrong thing
     * to be ambiguous about. Tripling the board left a wide empty margin below and right of the
     * content, so a long drag lands somewhere provably free.
     */
    /*
     * Drag to somewhere provably FREE, not a fixed number of pixels.
     *
     * A fixed offset lands on whatever happens to be next door and `canDrop` refuses the drop. A
     * refused drop and a broken drag both read as "moved 0 node(s)", which is precisely the thing
     * this must not be ambiguous about — it is how a genuinely broken drag hid here for weeks.
     * `findFreeSpaceOnBoard` is the same search the drop-in path uses, so the destination is free
     * by construction and any refusal that still happens is a real one.
     */
    const dragged = 'error' in target ? null : liveBoard.nodes.find((n) => n.id === target.id) ?? null;
    const draggedFp = dragged ? dragged.footprint ?? DEFAULT_FOOTPRINT[dragged.kind as NodeKind] : null;
    const destination = dragged && draggedFp
      ? findFreeSpaceOnBoard(
          JSON.parse(readNow(boardPath, 'utf8')) as Board,
          draggedFp,
          { x: dragged.pos.x + draggedFp.w + 2, y: dragged.pos.y + draggedFp.h + 2 }
        )
      : null;

    const cameraAtDrag = 'error' in target ? null : target.cam;
    const dropPoint = destination && dragged && cameraAtDrag
      ? {
          x: grabX + (destination.x - dragged.pos.x) * 16 * cameraAtDrag.zoom,
          y: grabY + (destination.y - dragged.pos.y) * 16 * cameraAtDrag.zoom
        }
      : { x: grabX + 360, y: grabY + 300 };

    console.log(`[smoke] dragging ${dragged?.id ?? '?'} from tile ${dragged?.pos.x},${dragged?.pos.y} to a free ${destination ? `${destination.x},${destination.y}` : '(none found)'} — screen ${grabX},${grabY} -> ${Math.round(dropPoint.x)},${Math.round(dropPoint.y)}`);

    const ghost = pointerDrag({ x: grabX, y: grabY }, { x: Math.round(dropPoint.x), y: Math.round(dropPoint.y) });
    await wait(200);
    await shoot('09-drag-ghost.png');
    await ghost;
    await wait(800);

    const posAfter = allPos();
    const moved = [...posBefore.entries()].filter(([id, p]) => posAfter.get(id) !== p);
    console.log(`[smoke] node drag moved ${moved.length} node(s): ${moved.map(([id, p]) => `${id} ${p} -> ${posAfter.get(id)}`).join('; ') || 'NONE'}`);
    await shoot('10-after-node-drag.png');

    const cameraAfter = await cameraNow();
    console.log(`[smoke] CAMERA HELD ITS POSITION THROUGH A NODE MOVE: ${cameraAfter === cameraBefore} (${cameraBefore} -> ${cameraAfter})`);

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

    /*
     * ── Drawing a trace by hand ──────────────────────────────────────────────────────────────
     *
     * Click one node's edge, click another's, and a trace exists. This drives it the way a mouse
     * does — two real PointerEvents on the canvas at coordinates derived from the live camera —
     * and then reads the board file to see whether an edge actually landed.
     *
     * Back into Edit Board mode first: wiring is gated behind it, because browsing a board
     * involves a lot of clicking near components and a click that starts a trace by accident
     * would be worse than no feature at all.
     */
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'e' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'e' });
    await wait(400);
    const inEditMode = await win.webContents.executeJavaScript(
      `Boolean(document.querySelector('.add-fab')) || /EDIT BOARD/.test(document.body.textContent ?? '')`
    ) as boolean;
    console.log(`[smoke] back in edit mode for the wire test: ${inEditMode}`);
    const wireBoard = JSON.parse(readNow(boardPath, 'utf8')) as {
      nodes: { id: string; kind: string; pos: { x: number; y: number }; footprint?: { w: number; h: number } }[];
      edges: { id: string; from: string; to: string }[];
    };
    const edgesBefore = wireBoard.edges.length;

    const edgePortsOf = (id: string) => {
      const node = wireBoard.nodes.find((n) => n.id === id);
      if (!node) return null;
      const fp = node.footprint ?? DEFAULT_FOOTPRINT[node.kind as NodeKind] ?? { w: 2, h: 2 };
      // The middle of the TOP edge, in world pixels — where ports.ts puts the dot.
      return { wx: (node.pos.x + fp.w / 2) * 16, wy: node.pos.y * 16 };
    };

    // Two nodes the root board does not already connect, so the wire is a new one.
    const connected = new Set(wireBoard.edges.map((e) => `${e.from}|${e.to}`));
    const candidates = wireBoard.nodes.filter(
      (n) => !n.kind.startsWith('decor.') && n.kind !== 'note.silk' && n.kind !== 'group.zone'
    );
    const pair = candidates.flatMap((a) =>
      candidates
        .filter((b) => b.id !== a.id && !connected.has(`${a.id}|${b.id}`) && !connected.has(`${b.id}|${a.id}`))
        .map((b) => [a, b] as const)
    );

    const wired = await win.webContents.executeJavaScript(`
      (async () => {
        const cam = window.__skynetCamera;
        const canvas = document.querySelector('canvas');
        if (!cam || !canvas) return JSON.stringify({ error: 'no camera or canvas' });
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const ev = (type, x, y, target) => target.dispatchEvent(new PointerEvent(type, {
          pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
          clientX: x, clientY: y, bubbles: true, cancelable: true
        }));
        const toScreen = (wx, wy) => ({ x: Math.round((wx - cam.x) * cam.zoom), y: Math.round((wy - cam.y) * cam.zoom) });
        const onScreen = (p) => p.x > 4 && p.y > 4 && p.x < window.innerWidth - 4 && p.y < window.innerHeight - 4;

        /*
         * Hover first, and believe the RENDERER about what lit up.
         *
         * Computing where a port ought to be and clicking there tests the harness's arithmetic,
         * not the feature — and when the two disagree the harness reports a failure that is not
         * real. It did: it aimed at a node's old position and concluded wiring was broken.
         * window.__skynetWire is where the port actually is, according to the code that draws it.
         */
        const probe = async (wx, wy) => {
          const p = toScreen(wx, wy);
          if (!onScreen(p)) return null;
          if (document.elementFromPoint(p.x, p.y)?.tagName !== 'CANVAS') return null;
          ev('pointermove', p.x, p.y, window);
          await wait(30);
          const lit = window.__skynetWire?.hover;
          return lit ? { screen: p, port: lit } : null;
        };

        const ports = ${JSON.stringify(Object.fromEntries(candidates.map((n) => [n.id, edgePortsOf(n.id)])))};
        const tried = [];
        let first = null;

        for (const [id, port] of Object.entries(ports)) {
          if (!port) continue;
          const found = await probe(port.wx, port.wy);
          if (!found) { tried.push(id); continue; }
          if (!first) { first = found; continue; }
          // A second, different node. Draw between them.
          if (found.port.nodeId === first.port.nodeId) continue;

          ev('pointermove', first.screen.x, first.screen.y, window);
          await wait(20);
          ev('pointerdown', first.screen.x, first.screen.y, canvas);
          ev('pointerup', first.screen.x, first.screen.y, window);
          await wait(20);
          ev('pointermove', found.screen.x, found.screen.y, window);
          await wait(20);
          ev('pointerdown', found.screen.x, found.screen.y, canvas);
          ev('pointerup', found.screen.x, found.screen.y, window);
          return JSON.stringify({ from: first.port.nodeId, to: found.port.nodeId });
        }
        return JSON.stringify({ error: 'fewer than two ports lit anywhere on screen', tried: tried.length });
      })()
    `) as string;

    const attempt = JSON.parse(wired) as { from?: string; to?: string; error?: string };

    /*
     * Poll, do not sleep.
     *
     * A fixed wait was 700ms and the round trip — IPC, command bus, schema validation, snapshot,
     * disk write — sometimes took longer. The harness then read the OLD edge count, reported a
     * failure the app had not committed, and skipped its own cleanup because the count had not
     * changed. So a passing feature looked broken AND left a stray trace in William's board file.
     * Waiting for the thing to happen is both more honest and faster when it happens quickly.
     */
    const edgeCount = (): number => (JSON.parse(readNow(boardPath, 'utf8')) as { edges: unknown[] }).edges.length;
    let edgesAfter = edgesBefore;
    for (let i = 0; i < 30 && edgesAfter === edgesBefore; i++) {
      await wait(100);
      edgesAfter = edgeCount();
    }

    console.log(`[smoke] wire attempt: ${attempt.error ?? `${attempt.from} -> ${attempt.to}`}`);
    console.log(`[smoke] A TRACE WAS DRAWN BY HAND: ${edgesAfter === edgesBefore + 1} (${edgesBefore} -> ${edgesAfter} traces)`);
    await shoot('14-wire-drawn.png');

    /*
     * Put the board back. This harness runs against the REAL board/ in development, so anything it
     * creates and does not remove is a component William finds on his board tomorrow with no idea
     * where it came from.
     */
    if (edgesAfter > edgesBefore) {
      await win.webContents.executeJavaScript(`window.skynet['command:undo']()`);
      let edgesUndone = edgesAfter;
      for (let i = 0; i < 20 && edgesUndone !== edgesBefore; i++) {
        await wait(100);
        edgesUndone = edgeCount();
      }
      console.log(`[smoke] and undone, leaving the board as it was: ${edgesUndone === edgesBefore}`);
    }

    /*
     * ── The resize handle still works with wiring on ─────────────────────────────────────────
     *
     * Reported: "i'm having trouble scaling nodes because of the wire creation ui, instead of
     * scaling it always tried to create a wire instead."
     *
     * The handle is in the node's bottom-right CORNER, which is where the east and south edges
     * meet, and ports are hit-tested along a whole edge — so wiring, which runs first, took every
     * press on the handle. This selects a node, grabs its handle, drags, and reads the footprint
     * back out of the board file.
     */
    const resizeTarget = (JSON.parse(readNow(boardPath, 'utf8')) as {
      nodes: { id: string; kind: string; pos: { x: number; y: number }; footprint?: { w: number; h: number } }[]
    }).nodes.find((n) => n.id === 'u2_agent_skynet');

    if (resizeTarget) {
      const fpBefore = resizeTarget.footprint ?? DEFAULT_FOOTPRINT[resizeTarget.kind as NodeKind];
      const resized = await win.webContents.executeJavaScript(`
        (async () => {
          const cam = window.__skynetCamera;
          const canvas = document.querySelector('canvas');
          if (!cam || !canvas) return JSON.stringify({ error: 'no camera or canvas' });
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const ev = (type, x, y, target) => target.dispatchEvent(new PointerEvent(type, {
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
            clientX: x, clientY: y, bubbles: true, cancelable: true
          }));
          const toScreen = (wx, wy) => ({ x: Math.round((wx - cam.x) * cam.zoom), y: Math.round((wy - cam.y) * cam.zoom) });

          // Select it by clicking its middle — the handle only exists on the selected node.
          const centre = toScreen(${(resizeTarget.pos.x + fpBefore.w / 2) * 16}, ${(resizeTarget.pos.y + fpBefore.h / 2) * 16});
          if (document.elementFromPoint(centre.x, centre.y)?.tagName !== 'CANVAS') {
            return JSON.stringify({ error: 'the node is not clickable where it should be' });
          }
          ev('pointerdown', centre.x, centre.y, canvas);
          ev('pointerup', centre.x, centre.y, window);
          await wait(200);

          // The handle: an 8 world-px square inside the node's bottom-right corner.
          const corner = toScreen(${(resizeTarget.pos.x + fpBefore.w) * 16 - 4}, ${(resizeTarget.pos.y + fpBefore.h) * 16 - 4});
          ev('pointermove', corner.x, corner.y, window);
          await wait(60);
          // Nothing may light there. A port under the handle IS the bug.
          const litOnHandle = window.__skynetWire?.hover ?? null;

          ev('pointerdown', corner.x, corner.y, canvas);
          for (let i = 1; i <= 10; i++) {
            ev('pointermove', corner.x + i * 12, corner.y + i * 8, window);
            await wait(20);
          }
          ev('pointerup', corner.x + 120, corner.y + 80, window);
          return JSON.stringify({ litOnHandle, wiring: window.__skynetWire?.wiring ?? null });
        })()
      `) as string;

      const outcome = JSON.parse(resized) as { litOnHandle?: unknown; wiring?: string | null; error?: string };
      const footprintOfNow = (): { w: number; h: number } => {
        const node = (JSON.parse(readNow(boardPath, 'utf8')) as {
          nodes: { id: string; kind: string; footprint?: { w: number; h: number } }[]
        }).nodes.find((n) => n.id === 'u2_agent_skynet');
        return node?.footprint ?? DEFAULT_FOOTPRINT[(node?.kind ?? 'agent.code') as NodeKind];
      };

      let fpAfter = footprintOfNow();
      for (let i = 0; i < 30 && fpAfter.w === fpBefore.w && fpAfter.h === fpBefore.h; i++) {
        await wait(100);
        fpAfter = footprintOfNow();
      }

      console.log(`[smoke] handle hover lit a wire port: ${outcome.litOnHandle ? 'YES — THE BUG IS BACK' : 'no'}${outcome.error ? ` (${outcome.error})` : ''}`);
      console.log(`[smoke] A NODE STILL RESIZES WITH WIRING ON: ${fpAfter.w !== fpBefore.w || fpAfter.h !== fpBefore.h} (${fpBefore.w}x${fpBefore.h} -> ${fpAfter.w}x${fpAfter.h})`);

      if (fpAfter.w !== fpBefore.w || fpAfter.h !== fpBefore.h) {
        await win.webContents.executeJavaScript(`window.skynet['command:undo']()`);
        let restored = footprintOfNow();
        for (let i = 0; i < 20 && (restored.w !== fpBefore.w || restored.h !== fpBefore.h); i++) {
          await wait(100);
          restored = footprintOfNow();
        }
        console.log(`[smoke] and undone: ${restored.w === fpBefore.w && restored.h === fpBefore.h}`);
      }
    }

    /*
     * ── JARVIS Prime's tool surface, end to end ──────────────────────────────────────────────
     *
     * Spawns the REAL tools/skynet-mcp.mjs the way Claude Code will, pointed at the REAL control
     * file this run just wrote, and drives it over stdio. Nothing is stubbed: the call crosses the
     * MCP protocol, the named pipe, `callAsAgent`, the handler table and the board store, and the
     * board that comes back is the one on disk.
     *
     * The unit test proves the proxy forwards. Only this proves the two halves find each other —
     * which is the part that silently breaks when a path, a userData location or a packaging rule
     * changes, and the failure mode is "JARVIS Prime has no tools" with nothing in any log.
     */
    const { spawn: spawnMcp } = await import('node:child_process');
    const mcp = spawnMcp(process.execPath, [join(app.getAppPath(), 'tools', 'skynet-mcp.mjs')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const mcpCall = (id: number, method: string, params: unknown): Promise<Record<string, unknown>> =>
      new Promise((resolveCall, rejectCall) => {
        const timer = setTimeout(() => rejectCall(new Error(`no answer to ${method}`)), 15_000);
        let acc = '';
        const onData = (chunk: Buffer): void => {
          acc += chunk.toString('utf8');
          for (const line of acc.split('\n')) {
            if (!line.trim()) continue;
            let message: { id?: number; result?: Record<string, unknown>; error?: unknown };
            try { message = JSON.parse(line); } catch { continue; }
            if (message.id !== id) continue;
            clearTimeout(timer);
            mcp.stdout.off('data', onData);
            if (message.error) rejectCall(new Error(JSON.stringify(message.error)));
            else resolveCall(message.result ?? {});
            return;
          }
        };
        mcp.stdout.on('data', onData);
        mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });

    try {
      const hello = await mcpCall(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
      console.log(`[smoke] skynet-mcp handshake: ${(hello['serverInfo'] as { name: string } | undefined)?.name ?? 'NONE'}`);

      const tools = await mcpCall(2, 'tools/list', {});
      const toolNames = (tools['tools'] as { name: string }[]).map((t) => t.name);
      console.log(`[smoke] skynet-mcp offers ${toolNames.length} tools including session_start: ${toolNames.includes('session_start')}`);

      const read = await mcpCall(3, 'tools/call', { name: 'board_read', arguments: { boardId: 'root' } });
      const payload = JSON.parse((read['content'] as { text: string }[])[0]!.text) as { ok?: boolean; board?: { nodes: unknown[] } };
      console.log(`[smoke] JARVIS PRIME READ THE LIVE BOARD OVER MCP: ${payload.ok === true} (${payload.board?.nodes.length ?? 0} nodes)`);

      // The gate, from the outside. An agent must not be able to reach a settings write.
      const refused = await mcpCall(4, 'tools/call', { name: 'node_delete', arguments: { boardId: 'root', nodeId: 'u1_jarvis' } });
      const refusedText = (refused['content'] as { text: string }[])[0]!.text;
      console.log(`[smoke] AN AGENT DELETE STILL NEEDS APPROVAL: ${refusedText.includes('REQUIRES EXPLICIT APPROVAL')}`);
    } catch (err) {
      console.log(`[smoke] skynet-mcp FAILED: ${(err as Error).message}`);
    } finally {
      mcp.kill();
    }

    /*
     * ── A document bound by a URL ────────────────────────────────────────────────────────────
     *
     * William: "many of my word docs are hosted in onedrive so instead of a hard drive directory
     * they have an https address." A file.document is now bound by a path OR a url, and this
     * checks the resolver picks the right one and calls both states healthy — the whole point
     * being that a OneDrive document must not render as a broken footprint.
     */
    const { resolveNodeTarget: resolveOne } = await import('./services/target-resolver.js');
    const docCases = [
      { label: 'url only', node: { id: 'f_url', kind: 'file.document', name: 'NOVEL', pos: { x: 0, y: 0 }, url: 'https://contoso-my.sharepoint.com/personal/w/Documents/Novel.docx' } },
      { label: 'share link', node: { id: 'f_share', kind: 'file.document', name: 'NOVEL', pos: { x: 0, y: 0 }, url: 'https://1drv.ms/w/s!AbCdEf' } },
      { label: 'local OneDrive path', node: { id: 'f_local', kind: 'file.document', name: 'NOVEL', pos: { x: 0, y: 0 }, path: `${(process.env['OneDrive'] ?? '').split(String.fromCharCode(92)).join('/')}/Attachments/GRN SCRN.docx` } },
      { label: 'no binding', node: { id: 'f_none', kind: 'file.document', name: 'NOVEL', pos: { x: 0, y: 0 } } }
    ];
    for (const { label, node } of docCases) {
      const t = resolveOne(node as unknown as Parameters<typeof resolveOne>[0]);
      console.log(`[smoke] document (${label}): state=${t.state} kind=${t.kind ?? '-'} ${t.detail ?? ''}`);
    }

    /*
     * ── Launching what CreateProcess cannot ──────────────────────────────────────────────────
     *
     * Reported: "exe nodes show a message but don't launch a game." The node pointed at a .lnk,
     * and `spawn` answers EFTYPE for one. This makes a harmless shortcut — to `cmd /c exit` —
     * launches it through the real code path, and checks it actually ran. Deliberately NOT the
     * user's Minecraft shortcut: a smoke run must not open a game on somebody's desktop.
     */
    const { writeFileSync: writeNow, existsSync: existsNow, rmSync: rmNow } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const probeDir = tmpdir();
    const probeLnk = join(probeDir, 'skynet-smoke.lnk');
    const probeFlag = join(probeDir, 'skynet-smoke-ran.txt');
    try { rmNow(probeFlag, { force: true }); } catch { /* nothing to remove */ }

    const { spawnSync: spawnNow } = await import('node:child_process');
    spawnNow('powershell.exe', ['-NoProfile', '-Command',
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${probeLnk}'); ` +
      `$s.TargetPath = "$env:SystemRoot" + [char]92 + 'system32' + [char]92 + 'cmd.exe'; ` +
      `$s.Arguments = '/c echo ran > "${probeFlag}"'; $s.Save()`
    ], { windowsHide: true });

    if (existsNow(probeLnk)) {
      const { openTarget: openOne } = await import('./services/shell-opener.js');
      const probeNode = {
        id: 'f_smoke_lnk', kind: 'file.exe', name: 'SMOKE SHORTCUT',
        pos: { x: 0, y: 0 }, path: probeLnk.split(String.fromCharCode(92)).join('/'),
        // The user's own "stop asking" flag, so this exercises the no-dialog path too. A smoke run
        // cannot answer a modal.
        confirmBeforeLaunch: false
      };
      const launched = await openOne(probeNode as unknown as Parameters<typeof openOne>[0], 'user');
      for (let i = 0; i < 30 && !existsNow(probeFlag); i++) await wait(100);
      console.log(`[smoke] .lnk launch: ok=${launched.ok} — ${launched.action}${launched.error ? ` (${launched.error})` : ''}`);
      console.log(`[smoke] A SHORTCUT ACTUALLY RAN: ${existsNow(probeFlag)}`);

      /*
       * The agent path is NOT exercised here. It raises a modal by design — that is the whole
       * point of it — and a headless capture has nobody to answer one, so calling it hangs the run
       * forever with no output. It is guarded structurally in test/windows-aliases.test.ts instead.
       */

      try { rmNow(probeLnk, { force: true }); rmNow(probeFlag, { force: true }); } catch { /* leave it */ }
    } else {
      console.log('[smoke] .lnk launch: could not create the probe shortcut');
    }

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

  /*
   * The control channel: how JARVIS Prime reaches this board.
   *
   * `tools/skynet-mcp.mjs` is spawned by Claude Code as a stdio MCP server, so it cannot BE this
   * process — main is already running and owns the board, the database, the command bus and the
   * undo stack. It connects here instead, and every call it makes is dispatched through
   * `callAsAgent`, which is the same handler table the renderer uses narrowed to the authority
   * docs/07-SECURITY.md grants an agent.
   */
  const control = startControlServer(callAsAgent);
  if (!control) console.warn('[control] not listening — JARVIS Prime will report the board as unreachable');

  // The --mcp-config file a session is launched with. Written every run because it names an
  // absolute path that differs between this repo and an installed build.
  const mcpConfig = writeMcpConfig();
  if (mcpConfig) console.log(`[mcp] skynet tools configured at ${mcpConfig}`);

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

  /*
   * Head -> Prime. A message the Face flagged with `run:` starts a real session on the Hands node.
   *
   * Polled rather than watched. The mailbox is a directory in the repo that git, an editor, the
   * Face's own clipboard path and the Hands themselves all write to, and a file watcher on a
   * directory with that many writers fires on partial writes — half a message dispatched as a task
   * would be worse than one dispatched ten seconds late. Ten seconds is imperceptible for
   * something whose other end is a human typing into a chat window.
   */
  const dispatch = setInterval(() => {
    void dispatchMail().then((results) => {
      for (const result of results) {
        const what = `"${result.subject}" (${result.file})`;
        if (result.ok) console.log(`[mail] autonomous run started on ${result.nodeId}: ${what}`);
        else console.warn(`[mail] did not run ${what}: ${result.error}`);
        if (!win.isDestroyed()) win.webContents.send('mail:dispatched', result);
      }
    });
  }, 10_000);
  app.on('will-quit', () => {
    clearInterval(sweep);
    clearInterval(dispatch);
    // The pipe dies with us; the file naming it must not outlive it, or the next proxy waits on
    // a pipe that is not there rather than reporting that SkynetOS is closed.
    stopControlServer();
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
    /*
     * Renderer console -> smoke log.
     *
     * Errors are forwarded unconditionally, not just the tagged lines. A React hooks violation
     * introduced while wiring the usage meter rendered a completely blank window, and the capture
     * dutifully saved a screenshot of an empty board with no hint of why — the error existed only
     * in a devtools window a headless run never opens.
     */
    win.webContents.on('console-message', (event) => {
      if (/^\[(router|atlas|ui|mosaic)\]/.test(event.message) || String(event.level) !== 'info') {
        console.log(`[renderer:${String(event.level)}] ${event.message}`);
      }
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
