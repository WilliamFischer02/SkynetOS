import { app, dialog, ipcMain, screen } from 'electron';
import { CHANNELS, isAgentMethod, isRemoteMethod, isVisionMethod, isVisionShared, isVoiceMethod, type Channel, type SkynetApi } from '@shared/ipc.js';
import { prepareRemoteCall } from '@shared/remote.js';
import type { BoardNode } from '@shared/types.js';
import { asWilliam, type Actor, type CommandRequest } from '@shared/commands.js';
import { DEFAULT_FOOTPRINT, isDecorPart } from '@shared/types.js';
import { findNode, listBoards, loadBoard, loadBoardByFile } from './services/board-store.js';
import { apply, historyStatus, redo, undo } from './services/command-bus.js';
import { pick } from './services/pickers.js';
import { boardWindow } from './services/main-window.js';
import { getSettings, setFableResetsAt, setUsagePlan } from './services/settings.js';
import { lastClaudeSessionId } from './services/db.js';
import { resumeCommandLine } from './services/launch-args.js';
import { mosaicForBoardTile, mosaicForNode } from './services/mosaic.js';
import { clearUsageCache, readUsage, usageRoutes } from './services/usage.js';
import { hardwareSnapshot } from './services/hardware.js';
import { clearModelCache, fableStatus } from './services/model-availability.js';
import { describePromptFiles, pickPromptFiles, sendPrompt } from './services/prompt-send.js';
import { isPlanId } from '@shared/plans.js';
import { archiveMail, listMail, sendMail } from './services/mailbox.js';
import { financeStatus } from './services/finance.js';
import {
  listSessions,
  startSession,
  stopSession
} from './services/session-manager.js';
import {
  listServices,
  serviceTail,
  startService,
  stopService
} from './services/service-runner.js';
import { openNodeTerminal, openTarget } from './services/shell-opener.js';
import { resolveArtifact, resolveBoardArtifacts } from './services/artifacts.js';
import { startDragOut } from './services/drag-out.js';
import { dragExplorerItem, listExplorer, openExplorerItem } from './services/explorer.js';
import { classify, suggestionToNode } from './services/ingest.js';
import { watchBoard } from './services/watchers.js';
import { apply as applyCommand } from './services/command-bus.js';
import { findFreeSpaceOnBoard } from './services/placement.js';
import { freeNodeId, makeNode } from './services/node-factory.js';
import {
  edgesFromPhantom,
  findPhantomSpot,
  nodeFromPhantom,
  phantomFromProposal,
  withoutPhantom,
  type PhantomProposal
} from '@shared/phantoms.js';
import { pasteNodes } from './services/paste.js';
import { summonJarvis } from './services/summon.js';
import { createPairCode, remoteStatus, revokeDevice, runTailscaleServe, setRemoteEnabled } from './services/remote.js';
import { isVisionSender, reportVision, setTrainMode, setVisionEnabled, visionEvents, visionStatus } from './services/vision.js';
import {
  addGestureSample,
  deleteGesture,
  dropGestureSample,
  gestureCalibration,
  gestureHealthReport,
  gestureLibrary,
  repairGestureLibrary,
  resetGestureSamples,
  saveCalibration,
  saveGesture,
  gestureAnalysis,
  setGestureFrames,
  setGestureMode,
  setGestureTravel,
  tuneGestureLibrary
} from './services/gesture-store.js';
import { isVoiceSender, setVoiceEnabled, voiceCaptured, voiceStatus } from './services/voice.js';
import { noteVisit, readVisits } from './services/visits.js';
import { refuseDialogWhenRemote, runAsRemote } from './services/remote-context.js';
import { avatarDir, loadAvatar } from './services/avatar-frames.js';
import { avatarsEnabled, faceCount, openPreviewFace, refreshFaces } from './services/avatar-window.js';
import { watchNodeMoods } from './services/avatar-mood.js';
import { setAvatarWindowsEnabled } from './services/settings.js';
import { runTaskNow, taskStatus } from './services/scheduler.js';
import { autostartState, setAutostart } from './services/autostart.js';
import { checkForUpdate, installUpdate, updateStatus } from './services/updater.js';
import { writeJournalNote } from './services/journal.js';
import { buildNodeFromPrompt } from './services/node-builder.js';
import { resolveNodeTarget, resolveValue } from './services/target-resolver.js';
import { claimAwaySubsession, markActivity } from './services/activity.js';
import { enterAway, getAwayStatus, refreshAwayStatus, wake } from './services/presence.js';
import { setAwaySettings } from './services/settings.js';

/**
 * Handlers, one per allowlisted channel. The type says every channel in CHANNELS must have one
 * and that its argument and return types match packages/shared/ipc.ts — so a channel added to
 * the allowlist without a handler is a typecheck failure, not a runtime "no handler registered".
 */
type Handlers = {
  [K in Channel]: (...args: Parameters<SkynetApi[K]>) => ReturnType<SkynetApi[K]> | Promise<ReturnType<SkynetApi[K]>>;
};

/**
 * Put a new node on a board.
 *
 * A function rather than an inline handler because the agent path needs it too, and it needs it
 * attributed differently. The history says who did what — the activity feed, the undo tooltip and
 * `docs/07`'s audit story all rest on that — so "the renderer called it, therefore William did it"
 * stops being true the moment JARVIS Prime can call it as well. The actor is a parameter, and the
 * two callers each pass the truth.
 */
function addNode(
  boardId: string,
  kind: Parameters<SkynetApi['node:add']>[1],
  pos: { x: number; y: number },
  fields: Partial<BoardNode> | undefined,
  actor: Actor
): ReturnType<SkynetApi['node:add']> {
  const load = loadBoard(boardId);
  if (!load.ok) return { ok: false, error: load.error };
  const node = makeNode(load.board, kind, pos);

  /*
   * A deliberately tiny allowlist. The palette needs to say WHICH decor part it is placing and
   * nothing else; everything else about a new node is decided by the factory or by the editor
   * afterwards. Accepting an arbitrary patch here would make `node:add` a second, unvalidated
   * way to write board JSON straight out of the renderer — or out of an agent.
   */
  if (fields?.part && isDecorPart(fields.part)) node.part = fields.part;

  /*
   * A printed kind (note.silk, group.zone) is placed exactly where it was asked for. It has no
   * footprint on the grid and never collides, so looking for "free space" would move a bracket
   * away from the cluster it was drawn around — which is the one thing it must not do.
   */
  const printed = kind === 'note.silk' || kind === 'group.zone';
  if (!printed) {
    const fp = node.footprint ?? DEFAULT_FOOTPRINT[kind];
    const free = findFreeSpaceOnBoard(load.board, fp, node.pos);
    if (!free) return { ok: false, error: 'NO FREE GRID SPACE ON THIS BOARD' };
    node.pos = free;
  }

  const result = applyCommand({
    command: { type: 'node.create', boardId, node },
    actor,
    label: `add ${kind}`
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, nodeId: node.id };
}

/**
 * Sketch a recommended node. Shared by the renderer and the agent path, each passing the truth
 * about who is asking — the signature on a phantom decides who may later withdraw it.
 */
function proposePhantom(
  boardId: string,
  proposal: PhantomProposal,
  actor: Actor
): ReturnType<SkynetApi['phantom:propose']> {
  const load = loadBoard(boardId);
  if (!load.ok) return { ok: false, error: load.error };
  let phantom;
  try {
    // A phone, a spoken command and a gesture are all William's own hand: signed as his.
    phantom = phantomFromProposal(load.board, proposal, asWilliam(actor), new Date().toISOString());
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const result = applyCommand({
    command: { type: 'phantom.propose', boardId, phantom },
    actor,
    label: `recommend ${phantom.name}`
  });
  return result.ok ? { ok: true, phantomId: phantom.id } : { ok: false, error: result.error };
}

/**
 * William's tick on a recommended node: build the real node with the same factory `node:add` uses
 * (so its id and designator follow the room's conventions), put it where the phantom was drawn or
 * the nearest free spot if something has moved in since, wire it as sketched, and hand the whole
 * thing to the bus as ONE command. User only — see AGENT_METHODS.
 */
function approvePhantom(boardId: string, phantomId: string): ReturnType<SkynetApi['phantom:approve']> {
  const load = loadBoard(boardId);
  if (!load.ok) return { ok: false, error: load.error };
  const phantom = (load.board.phantoms ?? []).find((p) => p.id === phantomId);
  if (!phantom) return { ok: false, error: `NO SUCH RECOMMENDED NODE — "${phantomId}"` };

  const base = makeNode(load.board, phantom.kind, phantom.pos);
  base.id = freeNodeId(load.board, phantom.kind, phantom.name);
  const node = nodeFromPhantom(phantom, base);

  const { next: without } = withoutPhantom(load.board, phantomId);
  const spot = findPhantomSpot(without, node.kind, node.footprint ?? DEFAULT_FOOTPRINT[node.kind], node.pos);
  if (!spot) return { ok: false, error: 'NO FREE GRID SPACE ON THIS BOARD' };
  node.pos = spot;

  const edges = edgesFromPhantom(load.board, phantom, node.id);
  const result = applyCommand({
    command: { type: 'phantom.approve', boardId, phantomId, node, edges },
    actor: 'user',
    label: `approve ${node.name}`
  });
  return result.ok ? { ok: true, nodeId: node.id } : { ok: false, error: result.error };
}

/**
 * Activate a node's target.
 *
 * Shared, and taking an ACTOR, for the same reason `addNode` does: what a click may do without
 * asking is not the same as what an agent may do without asking. `confirmBeforeLaunch: false` is
 * the user saying "stop asking me about this one", and board JSON is agent-writable — so the flag
 * is honoured for 'user' and ignored for 'agent'. See `trustedByUser` in services/shell-opener.ts.
 */
async function openNode(
  boardId: string,
  nodeId: string,
  by: Actor
): Promise<Awaited<ReturnType<SkynetApi['node:open']>>> {
  const node = nodeOrThrow(boardId, nodeId);

  /*
   * A monitor.system node points at nothing on disk: it IS the reading. So activating it opens the
   * system monitor panel rather than failing with "POINTS AT NOTHING", which is what a double-click
   * on the PSU used to say. For the user only: an agent has `hardware:snapshot` for the numbers, and
   * a panel popping up in front of William because an agent asked would be a surprise with no purpose.
   */
  if (node.kind === 'monitor.system' && by === 'user') {
    const win = boardWindow();
    const target = resolveNodeTarget(node);
    if (!win) return { ok: false, action: 'blocked', target, error: 'NO BOARD WINDOW TO OPEN THE MONITOR IN' };
    win.webContents.send('monitor:open', {
      boardId,
      nodeId,
      name: node.designator ? `${node.designator} ${node.name}` : node.name
    });
    return { ok: true, action: `opened the system monitor (${node.name})`, target };
  }

  /*
   * A journal task (a task.scheduled with a vault): a click writes today's journal note into
   * William's Obsidian vault now. There is no scheduler yet (M8), so the click IS the run. User
   * only: it writes into his vault, and an agent asking it to would be a note he did not ask for.
   */
  if (node.kind === 'task.scheduled' && node.journalVault && by === 'user') {
    const target = resolveNodeTarget(node);
    const written = writeJournalNote(node);
    return written.ok
      ? { ok: true, action: written.action, target }
      : { ok: false, action: 'journal', target, error: written.error ?? 'COULD NOT WRITE THE JOURNAL NOTE' };
  }

  const result = await openTarget(node, by);
  return {
    ok: result.ok,
    action: result.action,
    target: result.target,
    ...(result.error ? { error: result.error } : {})
  };
}

function nodeOrThrow(boardId: string, nodeId: string): BoardNode {
  const load = loadBoard(boardId);
  if (!load.ok) throw new Error(load.error);
  const node = findNode(load.board, nodeId);
  if (!node) throw new Error(`NO SUCH NODE — "${nodeId}" on board "${boardId}"`);
  return node;
}

const handlers: Handlers = {
  'board:load': (boardId) => loadBoard(boardId),

  'board:loadRoom': (boardFile) => loadBoardByFile(boardFile),

  'board:list': () => listBoards(),

  'display:info': () => {
    const win = boardWindow();
    const display = win ? screen.getDisplayNearestPoint(win.getBounds()) : screen.getPrimaryDisplay();
    const scaleFactor = display.scaleFactor || 1;
    return {
      scaleFactor,
      appliedZoomFactor: win ? win.webContents.getZoomFactor() : 1,
      workArea: { width: display.workArea.width, height: display.workArea.height }
    };
  },

  // User only, both: an agent can never make SkynetOS start itself. See services/autostart.ts.
  'app:autostart': () => autostartState(),
  'app:setAutostart': (on) => setAutostart(on === true),

  // Program updates. Status is read-only; check and install are user-only (not in AGENT_METHODS
  // or REMOTE_METHODS). See services/updater.ts.
  'update:status': () => updateStatus(),
  'update:check': () => checkForUpdate(),
  'update:install': () => installUpdate(),

  'app:version': () => ({
    app: app.getVersion(),
    electron: process.versions['electron'] ?? 'unknown',
    chrome: process.versions['chrome'] ?? 'unknown',
    node: process.versions['node'] ?? 'unknown'
  }),

  'settings:read': () => {
    const s = getSettings();
    return {
      devRoots: s.devRoots,
      reducedMotion: s.reducedMotion,
      streamMode: s.streamMode,
      confirmAllLaunches: s.confirmAllLaunches,
      plan: s.plan,
      tokenBudget: s.tokenBudget
    };
  },

  'settings:setPlan': (plan, tokenBudget) => {
    const result = setUsagePlan(
      plan !== null && isPlanId(plan) ? plan : null,
      tokenBudget
    );
    // The usage cache holds per-window scans; the budget does not affect them, but the window
    // length can change with a settings reload, so it is cleared rather than left to go subtly
    // stale.
    if (result.ok) clearUsageCache();
    return result;
  },

  'target:resolveNode': (boardId, nodeId) => ({
    nodeId,
    target: resolveNodeTarget(nodeOrThrow(boardId, nodeId))
  }),

  'target:resolveBoard': (boardId) => {
    const load = loadBoard(boardId);
    if (!load.ok) return [];
    return load.board.nodes.map((node) => ({ nodeId: node.id, target: resolveNodeTarget(node) }));
  },

  'target:verify': (control, value, context) => resolveValue(control, value, context as BoardNode | undefined),

  'pick:target': (request) => pick(request),

  'mosaic:forNode': (boardId, nodeId, slot) => {
    const load = loadBoard(boardId);
    if (!load.ok) return { ok: false, error: load.error };
    const node = findNode(load.board, nodeId);
    if (!node) return { ok: false, error: `NO SUCH NODE — "${nodeId}"` };
    return mosaicForNode(load.board, node, slot ?? 'face');
  },

  'mosaic:boardTile': (boardId) => {
    const load = loadBoard(boardId);
    if (!load.ok) return { ok: false, error: load.error };
    return mosaicForBoardTile(load.board);
  },

  'usage:summary': () => readUsage(),

  'usage:routes': (boardId) => usageRoutes(boardId),

  'hardware:snapshot': (options) => hardwareSnapshot(options?.light ? { light: true } : {}),

  // Away (sleep) mode. User only, all four: see AGENT_METHODS and docs/07.
  'away:status': () => getAwayStatus(),
  'away:sleepNow': () => enterAway('manual', 0),
  'away:wake': () => wake('renderer'),
  'away:setMode': (patch) => {
    const result = setAwaySettings(patch ?? {});
    if (result.ok) refreshAwayStatus();
    return result;
  },

  'models:status': () => fableStatus(),

  'models:setFableReset': (iso) => {
    const result = setFableResetsAt(iso);
    // The next status read must see the new time, not a reading cached before it existed.
    if (result.ok) clearModelCache();
    return result;
  },

  // User only: none of these is in AGENT_METHODS. See services/prompt-send.ts.
  'prompt:pickFiles': () => pickPromptFiles(),
  'prompt:describeFiles': (paths) => describePromptFiles(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []),
  'prompt:send': (request) => sendPrompt(request),
  'prompt:build': (request) => buildNodeFromPrompt(request),

  'mailbox:list': (side) => listMail(side),
  'mailbox:send': (side, message) => sendMail(side, message),
  'mailbox:archive': (side, file) => archiveMail(side, file),

  'session:start': (boardId, nodeId, options) =>
    startSession(boardId, nodeOrThrow(boardId, nodeId), {
      fresh: options?.fresh ?? false,
      ...(options?.prompt ? { prompt: options.prompt } : {})
    }),

  'session:stop': (sessionId) => stopSession(sessionId),

  'session:list': () => listSessions(),

  /**
   * The command to reattach to this node's conversation by hand. docs/03 lists "Copy resume
   * command" in the right-click menu, and it is the escape hatch when the launcher itself is
   * the thing that is broken.
   */
  'session:resumeCommand': (boardId, nodeId) => {
    const node = nodeOrThrow(boardId, nodeId);
    const id = lastClaudeSessionId(boardId, nodeId);
    if (!id || !node.cwd) return null;
    return resumeCommandLine(node.cwd, id);
  },

  /**
   * A plain shell in a node's directory. The board's missing verb: until now the only thing that
   * could open a console was an agent chip, and `openWith: 'terminal'` answered "arrives at M3".
   */
  'terminal:open': (boardId, nodeId, options) =>
    openNodeTerminal(nodeOrThrow(boardId, nodeId), { elevated: options?.elevated === true }),

  'service:start': (boardId, nodeId) => startService(boardId, nodeOrThrow(boardId, nodeId)),
  'service:stop': (boardId, nodeId) => stopService(boardId, nodeId),
  'service:list': () => listServices(),
  'service:tail': (boardId, nodeId) => serviceTail(boardId, nodeId),

  'artifact:resolve': async (boardId, nodeId) => {
    const load = loadBoard(boardId);
    if (!load.ok) throw new Error(load.error);
    return resolveArtifact(load.board, nodeOrThrow(boardId, nodeId));
  },

  'artifact:resolveBoard': async (boardId) => {
    const load = loadBoard(boardId);
    if (!load.ok) return [];
    return resolveBoardArtifacts(load.board);
  },

  'drag:startFile': async (boardId, nodeId, ..._rest) => {
    void _rest;
    const load = loadBoard(boardId);
    if (!load.ok) return { ok: false, error: load.error };
    const win = boardWindow();
    if (!win) return { ok: false, error: 'NO WINDOW' };
    return startDragOut(win.webContents, load.board, nodeId);
  },

  // Read-only and scoped to the node's root; in AGENT_METHODS. See services/explorer.ts.
  'explorer:list': (boardId, nodeId, rel) =>
    listExplorer(nodeOrThrow(boardId, nodeId), typeof rel === 'string' ? rel : null),

  // User only, both: one runs the default app (confirmed for anything that runs code), the other
  // hands a file to whatever the OS drops it on.
  'explorer:open': (boardId, nodeId, rel, mode) =>
    openExplorerItem(
      nodeOrThrow(boardId, nodeId),
      typeof rel === 'string' ? rel : '',
      mode === 'reveal' || mode === 'notepadpp' || mode === 'obsidian' ? mode : 'open'
    ),

  'explorer:drag': async (boardId, nodeId, rel) => {
    const win = boardWindow();
    if (!win) return { ok: false, error: 'NO WINDOW' };
    return dragExplorerItem(win.webContents, nodeOrThrow(boardId, nodeId), typeof rel === 'string' ? rel : '');
  },

  'ingest:classify': (paths) => paths.map((p) => classify(p)).filter((s): s is NonNullable<typeof s> => s !== null),

  'ingest:create': (boardId, suggestion, pos) => {
    const load = loadBoard(boardId);
    if (!load.ok) return { ok: false, error: load.error };
    const existing = new Set(load.board.nodes.map((n) => n.id));
    const free = findFreeSpaceOnBoard(load.board, suggestion.footprint, pos);
    if (!free) return { ok: false, error: 'NO FREE GRID SPACE ON THIS BOARD' };
    const node = suggestionToNode(suggestion, free, existing);
    const result = applyCommand({
      command: { type: 'node.create', boardId, node },
      actor: 'user',
      label: `drop in ${node.name}`
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, nodeId: node.id };
  },

  'watch:board': async (boardId) => {
    const load = loadBoard(boardId);
    if (!load.ok) return { watched: 0, polled: 0, waiting: 0 };
    return watchBoard(load.board);
  },

  'node:add': (boardId, kind, pos, fields) => addNode(boardId, kind, pos, fields, 'user'),

  'phantom:list': (boardId) => {
    const load = loadBoard(boardId);
    return load.ok ? (load.board.phantoms ?? []) : [];
  },
  'phantom:propose': (boardId, proposal) => proposePhantom(boardId, proposal, 'user'),
  'phantom:approve': (boardId, phantomId) => approvePhantom(boardId, phantomId),
  'phantom:dismiss': (boardId, phantomId) => {
    const result = applyCommand({
      command: { type: 'phantom.dismiss', boardId, phantomId },
      actor: 'user',
      label: `dismiss recommendation ${phantomId}`
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },

  'node:paste': (boardId, clip, anchor) => pasteNodes(boardId, clip, anchor, 'user'),

  'jarvis:summon': (boardId, nodeId, directive) => summonJarvis(boardId, nodeId, directive),

  'avatar:frames': (name) => loadAvatar(typeof name === 'string' ? name : undefined),

  'avatar:status': () => ({ enabled: avatarsEnabled(), faces: faceCount(), folder: avatarDir() }),

  'avatar:preview': () => openPreviewFace(),

  'avatar:watchNodes': (boardId, nodeIds) =>
    watchNodeMoods(typeof boardId === 'string' ? boardId : '', Array.isArray(nodeIds) ? nodeIds : []),

  'avatar:setEnabled': (on) => {
    const result = setAvatarWindowsEnabled(on === true);
    if (result.ok) refreshFaces();
    return { ...result, enabled: avatarsEnabled() };
  },

  'task:status': (boardId, nodeId) => taskStatus(boardId, nodeId),

  'task:runNow': (boardId, nodeId) => runTaskNow(boardId, nodeId),

  'finance:status': () => financeStatus(),

  'node:open': async (boardId, nodeId) => {
    const result = await openNode(boardId, nodeId, 'user');
    // Counted for the MATRIX, where a file floats higher the more it is opened (services/visits.ts).
    if (result.ok) noteVisit(boardId, nodeId);
    return result;
  },

  'node:visits': () => readVisits(),

  'command:apply': (request) => apply(request),

  'command:undo': () => undo(),
  'command:redo': () => redo(),
  'command:history': () => historyStatus(),

  /**
   * docs/07: deleting a node, edge or room "always requires explicit approval in the UI. No auto
   * policy can override this." The approval is a native modal, deliberately — an in-page
   * confirm could be dismissed by a stray keypress, and this is the one gate that must not be.
   */
  'command:confirmDestructive': async (summary, detail) => {
    refuseDialogWhenRemote('a deletion');
    const win = boardWindow();
    const options = {
      type: 'warning' as const,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Confirm deletion',
      message: summary,
      detail: `${detail}\n\nA snapshot of every board file is written to board/.snapshots/ first, and Ctrl+Z undoes this.`,
      noLink: true
    };
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return response === 0;
  },

  // Remote (docs/08). Desktop-only: in neither AGENT_METHODS nor REMOTE_METHODS.
  'remote:status': () => remoteStatus(),
  'remote:setEnabled': (on) => setRemoteEnabled(on === true),
  'remote:pairCode': () => createPairCode(),
  'remote:revoke': (deviceId) => revokeDevice(String(deviceId)),
  'remote:tailscaleServe': () => runTailscaleServe(),

  // Manual (gesture) control. Desktop-only, and `vision:*` is refused from any sender but the
  // vision window itself — see registerIpc below.
  'gesture:status': () => visionStatus(),
  'gesture:setEnabled': (on) => setVisionEnabled(on === true),
  'vision:report': (report) => reportVision(report),
  'vision:events': (events) => visionEvents(Array.isArray(events) ? events : []),

  // The gesture catalogue and the camera calibration. `gesture:addSample` and
  // `gesture:saveCalibration` are refused from anything but the vision page (see registerIpc).
  'gesture:library': () => gestureLibrary(),
  'gesture:saveGesture': (input) => saveGesture(input),
  'gesture:deleteGesture': (id) => deleteGesture(String(id)),
  'gesture:addSample': (input) => addGestureSample(input),
  'gesture:resetSamples': (id) => resetGestureSamples(String(id)),
  'gesture:dropSample': (input) => dropGestureSample(String(input?.gestureId ?? ''), String(input?.sampleId ?? '')),
  'gesture:setFrames': (input) => setGestureFrames(String(input?.gestureId ?? ''), input?.frames ?? 1),
  'gesture:setMode': (input) => setGestureMode(String(input?.gestureId ?? ''), input?.mode ?? 'one'),
  'gesture:setTravel': (input) => setGestureTravel(String(input?.gestureId ?? ''), input?.travel === true),
  'gesture:analysis': () => gestureAnalysis(),
  'gesture:tune': () => tuneGestureLibrary(),
  'gesture:health': () => gestureHealthReport(),
  'gesture:repair': () => repairGestureLibrary(),
  'gesture:calibration': () => gestureCalibration(),
  'gesture:saveCalibration': (profile) => saveCalibration(profile),
  'gesture:train': (on) => setTrainMode(on === true),
  'voice:status': () => voiceStatus(),
  'voice:setEnabled': (on) => setVoiceEnabled(on === true),
  'voice:captured': (capture) => voiceCaptured(capture)
};

/**
 * Call a handler for a paired REMOTE device (the phone, the iPad, the laptop). docs/08.
 *
 * The remote twin of `callAsAgent`, for William on another screen rather than for an agent:
 *   1. REMOTE_METHODS only.
 *   2. The arguments are made safe first (prepareRemoteCall): `command:apply` is attributed to
 *      `remote` with any claimed approval stripped and deletions refused; a prompt carries no files.
 *   3. It runs inside `runAsRemote`, so anything that would put a native dialog on the PC's screen
 *      refuses with "confirm on the desktop" instead of waiting for a click nobody can see.
 * Using SkynetOS remotely is presence: away mode stays asleep while the phone is in use.
 */
export async function callAsRemote(channel: string, args: unknown[], deviceId: string): Promise<unknown> {
  if (!isRemoteMethod(channel)) {
    throw new Error(`"${channel}" IS NOT AVAILABLE FROM A REMOTE DEVICE — do this at the PC`);
  }
  const prepared = prepareRemoteCall(channel, args);
  if ('refuse' in prepared) throw new Error(prepared.refuse);
  markActivity();
  return runAsRemote(deviceId, async () => {
    // Attributed to the phone, not to "the renderer is always William at the PC".
    if (channel === 'node:add') {
      const [boardId, kind, pos, fields] = prepared.args as Parameters<SkynetApi['node:add']>;
      return addNode(boardId, kind, pos, fields, 'remote');
    }
    if (channel === 'node:paste') {
      const [boardId, clip, anchor] = prepared.args as Parameters<SkynetApi['node:paste']>;
      return pasteNodes(boardId, clip, anchor, 'remote');
    }
    const handler = handlers[channel as Channel] as (...a: unknown[]) => unknown;
    return await handler(...prepared.args);
  });
}

/**
 * Call a handler on behalf of an agent.
 *
 * Everything that arrives over the control channel comes through here, and it does two things the
 * renderer's path does not:
 *
 *   1. Refuses any method not in AGENT_METHODS.
 *   2. Rewrites a `command:apply` request so it cannot lie about itself. `actor` becomes 'agent'
 *      regardless of what was asked for — attribution is not the caller's to choose — and
 *      `approved` is stripped. That flag means "a human approved THIS command in THIS exchange",
 *      and an agent setting it for itself would turn the delete guard in command-bus.ts into a
 *      comment. Deletion still works; it comes back `needsApproval: true` and the user confirms it
 *      in the UI, which is what docs/07 asks for.
 */
export async function callAsAgent(method: string, params: unknown[]): Promise<unknown> {
  if (!isAgentMethod(method)) {
    throw new Error(`"${method}" IS NOT AVAILABLE TO AGENTS — see AGENT_METHODS in src/main/ipc.ts`);
  }

  // An agent working counts as presence: no away mode while one is busy on the board.
  markActivity();

  /*
   * While an away run is going, the sessions an agent may start are capped HERE, in main, not left
   * to the away prompt: none at level plan, at most two at level work. Outside an away run this
   * allows everything and counts nothing.
   */
  if (method === 'session:start') {
    const refusal = claimAwaySubsession();
    if (refusal) return { ok: false, error: refusal };
  }

  if (method === 'command:apply') {
    const request = (params[0] ?? {}) as CommandRequest;
    const { approved: _discarded, ...rest } = request;
    return handlers['command:apply']({ ...rest, actor: 'agent' });
  }

  /*
   * `node:add` goes through the shared function rather than the handler, so the history records
   * that an AGENT added this node. The handler's job is to answer the renderer, and the renderer
   * is always William.
   */
  if (method === 'node:add') {
    const [boardId, kind, pos, fields] = params as Parameters<SkynetApi['node:add']>;
    return addNode(boardId, kind, pos, fields, 'agent');
  }

  /*
   * Same reason as `node:add`: activating a node runs something on this machine, and an agent must
   * not be able to skip the confirmation by clearing a flag in board JSON it can also write.
   */
  // A recommendation is signed by whoever made it, and that signature decides who may withdraw it.
  if (method === 'phantom:propose') {
    const [boardId, proposal] = params as Parameters<SkynetApi['phantom:propose']>;
    return proposePhantom(boardId, proposal, 'agent');
  }

  if (method === 'node:open') {
    const [boardId, nodeId] = params as Parameters<SkynetApi['node:open']>;
    return openNode(boardId, nodeId, 'agent');
  }

  const handler = handlers[method as Channel] as (...a: unknown[]) => unknown;
  return await handler(...params);
}

export function registerIpc(): void {
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const handler = handlers[channel] as (...a: unknown[]) => unknown;
      try {
        /*
         * Which window asked. The board window may call anything in CHANNELS; the vision window may
         * call VISION_METHODS and nothing else, and nothing else may call VISION_METHODS.
         *
         * This used to be implied rather than enforced: only the board window had a preload, so
         * "the window that asked" was always the board window (services/main-window.ts). The vision
         * page needs the bridge to report gestures, so the implication no longer holds and the rule
         * is checked here instead — which is stronger, because it does not depend on which windows
         * happen to exist.
         */
        const fromVision = isVisionSender(event.sender);
        if (fromVision && !isVisionMethod(channel) && !isVisionShared(channel)) {
          throw new Error(`"${channel}" IS NOT AVAILABLE TO THE VISION PAGE — it may only report gestures and read the catalogue`);
        }
        if (!fromVision && isVisionMethod(channel)) {
          throw new Error(`"${channel}" MAY ONLY BE CALLED BY THE VISION WINDOW`);
        }
        // The voice capture window: the same rule, in both directions (docs/07-SECURITY.md, Voice).
        const fromVoice = isVoiceSender(event.sender);
        if (fromVoice && !isVoiceMethod(channel)) {
          throw new Error(`"${channel}" IS NOT AVAILABLE TO THE VOICE WINDOW — it may only deliver a sentence`);
        }
        if (!fromVoice && isVoiceMethod(channel)) {
          throw new Error(`"${channel}" MAY ONLY BE CALLED BY THE VOICE WINDOW`);
        }
        return await handler(...args);
      } catch (err) {
        // An exception crossing the bridge arrives in the renderer as a rejected promise with a
        // mangled message. Log the real one here where the stack is intact.
        console.error(`[ipc] ${channel} failed:`, err);
        throw err;
      }
    });
  }
  console.log(`[ipc] registered ${CHANNELS.length} allowlisted channels`);
}
