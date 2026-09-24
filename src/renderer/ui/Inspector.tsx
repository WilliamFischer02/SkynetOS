import type { BoardNode } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import { primaryTargetField } from '@shared/node-fields.js';
import { isBroken, type TargetInfo } from '@shared/targets.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { NodeEditor } from './NodeEditor.js';
import { ScheduleBlock } from './ScheduleBlock.js';
import { FinanceBlock } from './FinanceBlock.js';
import { isFinanceFolder } from '@shared/finance.js';
import { AvatarLogoNote } from './AvatarLogoNote.js';
import { GifNote } from './GifNote.js';
import { formatBytes, relativeTime } from './TargetField.js';
import { formatTokens } from '@shared/usage.js';

/**
 * The inspector: everything about the selected node, and the way in to editing it.
 *
 * Read mode leads with the resolved target, because that is the question you actually have when
 * you click a component — is this bound to something real, and what. Broken states are stated in
 * the board's voice ("TARGET NOT FOUND — C:/dev/…") rather than as a generic error, per docs/02
 * §Writing on the board.
 */

const STATE_TEXT: Record<TargetInfo['state'], string> = {
  ok: 'BOUND',
  none: 'NO TARGET — THIS KIND POINTS AT NOTHING',
  unset: 'UNBOUND — NOTHING SELECTED YET',
  missing: 'BROKEN — TARGET NOT FOUND',
  invalid: 'BROKEN — TARGET IS NOT USABLE',
  'outside-dev-root': 'BOUND, OUTSIDE DEV ROOTS',
  unknown: 'UNKNOWN — COULD NOT READ TARGET'
};

function stateClass(state: TargetInfo['state']): string {
  if (state === 'ok') return 'state ok';
  if (state === 'none') return 'state dim';
  if (state === 'outside-dev-root' || state === 'unset') return 'state warn';
  return 'state fault';
}

export function Inspector(): React.JSX.Element | null {
  const board = useBoardStore((s) => s.board);
  const selectedId = useBoardStore((s) => s.selectedId);
  const editingId = useBoardStore((s) => s.editingId);
  const targets = useBoardStore((s) => s.targets);
  const busy = useBoardStore((s) => s.busy);
  const boardId = useBoardStore((s) => s.boardId);
  const beginEdit = useBoardStore((s) => s.beginEdit);
  const cancelEdit = useBoardStore((s) => s.cancelEdit);
  const runCommand = useBoardStore((s) => s.runCommand);
  const openNode = useBoardStore((s) => s.openNode);
  const toast = useBoardStore((s) => s.toast);
  const sessions = useBoardStore((s) => s.sessions);
  const services = useBoardStore((s) => s.services);
  const startSession = useBoardStore((s) => s.startSession);
  const stopSession = useBoardStore((s) => s.stopSession);
  const copyResumeCommand = useBoardStore((s) => s.copyResumeCommand);
  const openTerminal = useBoardStore((s) => s.openTerminal);
  const refreshFiles = useBoardStore((s) => s.refreshFiles);
  const usageRoutes = useBoardStore((s) => s.usageRoutes);

  if (!board) return null;

  const node = selectedId ? board.nodes.find((n) => n.id === selectedId) : undefined;

  /*
   * Nothing selected means no panel at all. It used to render an empty "NOTHING SELECTED" card,
   * which meant a third of the board was permanently hidden behind a panel that had nothing to
   * say — worst when panning, because the part of the map you were panning toward was the part
   * covered up. The help bar already tells you how to select something.
   */
  if (!node) return null;

  const target = targets[node.id];
  const fp = footprintOf(node);
  const targetField = primaryTargetField(node.kind);
  const session = sessions.find(
    (s) => s.nodeId === node.id && s.boardId === boardId && (s.state === 'running' || s.state === 'starting')
  );
  const failedSession = sessions.find((s) => s.nodeId === node.id && s.boardId === boardId && s.state === 'error');
  const service = services.find((s) => s.nodeId === node.id && s.boardId === boardId && s.state === 'running');
  const usageRoute = usageRoutes.find((r) => r.nodeId === node.id);

  const save = async (patch: Partial<BoardNode>) => {
    const result = await runCommand(
      { type: 'node.update', boardId, nodeId: node.id, patch },
      `edit ${node.designator ?? node.id}`
    );
    if (result.ok) cancelEdit();
  };

  const remove = async () => {
    // docs/07: deletion always requires explicit approval in the UI, and no policy can skip it.
    // The approval is a native modal in main; the renderer cannot fake it.
    const approved = await window.skynet['command:confirmDestructive'](
      `Delete ${node.designator ? node.designator + ' — ' : ''}${node.name}?`,
      `${node.kind}${target?.resolved ? `\n${target.resolved}` : ''}\n\nThe file or folder on disk is NOT touched — only this node and its traces are removed from the board.`
    );
    if (!approved) { toast('warn', 'delete cancelled'); return; }
    const result = await window.skynet['command:apply']({
      command: { type: 'node.delete', boardId, nodeId: node.id },
      actor: 'user',
      approved: true,
      label: `delete ${node.designator ?? node.id}`
    });
    if (!result.ok) { toast('fault', result.error); return; }
    cancelEdit();
    useBoardStore.setState({ selectedId: null });
    await useBoardStore.getState().loadBoard(boardId);
    toast('ok', `deleted ${node.name}`);
  };

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <div className="inspector-title">
          {node.designator ? <span className="desig">{node.designator}</span> : null}
          <span className="nodename">{node.name}</span>
        </div>
        <div className="inspector-kind">{node.kind}</div>
      </header>

      {target ? (
        <div className={stateClass(target.state)}>
          <div className="state-line">{STATE_TEXT[target.state]}</div>
          {target.resolved ? <div className="state-path">{target.resolved}</div> : null}
          {target.detail ? <div className="state-detail">{target.detail}</div> : null}
          {target.state === 'ok' ? (
            <div className="state-meta">
              {target.kind ? <span>{target.kind}</span> : null}
              {target.matchCount !== undefined ? <span>{target.matchCount} match{target.matchCount === 1 ? '' : 'es'}</span> : null}
              {target.versionLabel ? <span>v{target.versionLabel}</span> : null}
              {target.sizeBytes !== undefined && target.kind === 'file' ? <span>{formatBytes(target.sizeBytes)}</span> : null}
              {target.mtimeMs !== undefined ? <span>{relativeTime(target.mtimeMs)}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {editingId === node.id ? (
        <NodeEditor
          node={node}
          saving={busy}
          onSave={(patch) => void save(patch)}
          onCancel={cancelEdit}
          onDelete={() => void remove()}
        />
      ) : (
        <>
          <div className="inspector-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!targetField || (target ? isBroken(target) : false)}
              onClick={() => void openNode(node.id)}
            >
              {openLabel(node)}
            </button>
            <button type="button" className="btn" onClick={() => beginEdit(node.id)}>Edit node (F2)</button>
            {node.kind === 'file.artifact' || node.kind === 'file.document' || node.kind === 'file.exe' ? (
              <button
                type="button"
                className="btn"
                onClick={() => void refreshFiles({ announce: true })}
                title="Look on disk again for the newest file, now. The board also does this by itself when a file changes and when you come back to the window."
              >
                Refresh (F5)
              </button>
            ) : null}
          </div>

          {/*
            * A shell, on any node that has a directory.
            *
            * The board could not do this at all until now: `openWith: 'terminal'` answered
            * "TERMINAL LAUNCH ARRIVES AT M3" and an agent chip was the only thing that could
            * open a console. Both buttons run the same staged script an agent launch does, so a
            * repo primed with `git-fetch` primes here too.
            */}
          {hasDirectory(node) ? (
            <div className="inspector-actions">
              <button
                type="button"
                className="btn"
                disabled={target ? isBroken(target) : false}
                onClick={() => void openTerminal(node.id, false)}
                title="Open a PowerShell window in this folder, primed with the update steps this node declares"
              >
                Open terminal
              </button>
              <button
                type="button"
                className="btn warn"
                disabled={target ? isBroken(target) : false}
                onClick={() => void openTerminal(node.id, true)}
                title="Open an ELEVATED PowerShell window in this folder. Windows will ask for confirmation."
              >
                Admin terminal
              </button>
            </div>
          ) : null}

          {node.kind === 'agent.code' || node.kind === 'agent.audit' ? (
            <div className="session-block">
              {session ? (
                <>
                  <div className={session.state === 'starting' ? 'state warn' : 'state ok'}>
                    <div className="state-line">
                      {session.state === 'starting'
                        ? (node.launch === 'popout-elevated'
                            ? 'STARTING — WAITING ON THE UAC PROMPT'
                            : 'STARTING — WAITING FOR THE TERMINAL TO REPORT IN')
                        : `SESSION RUNNING${session.resumed ? ' — RESUMED' : ' — NEW CONVERSATION'}`}
                    </div>
                    <div className="state-meta">
                      <span>PID {session.pid ?? '?'}</span>
                      <span>{session.mode}</span>
                      <span>{relativeTime(Date.parse(session.startedAt))}</span>
                    </div>
                    {session.claudeSessionId ? (
                      <div className="state-path">conversation {session.claudeSessionId}</div>
                    ) : null}
                  </div>
                  <div className="inspector-actions">
                    <button type="button" className="btn danger" onClick={() => void stopSession(session.id)}>Kill session</button>
                    <button type="button" className="btn" onClick={() => void startSession(node.id, true)}>New session (fresh context)</button>
                  </div>
                </>
              ) : (
                <>
                  {failedSession ? (
                    <div className="state fault">
                      <div className="state-line">LAST LAUNCH FAILED</div>
                      <div className="state-detail">{failedSession.error}</div>
                    </div>
                  ) : null}
                  <div className="inspector-actions">
                    <button type="button" className="btn primary" onClick={() => void startSession(node.id)}>
                      {node.resume === false ? 'Launch session' : 'Resume conversation'}
                    </button>
                    <button type="button" className="btn" onClick={() => void startSession(node.id, true)}>New session (fresh context)</button>
                  </div>
                </>
              )}
              <div className="inspector-actions">
                <button type="button" className="btn" onClick={() => void copyResumeCommand(node.id)}>Copy resume command</button>
              </div>
            </div>
          ) : null}

          {node.kind === 'service.process' && service ? (
            <div className="state ok">
              <div className="state-line">SERVICE UP</div>
              <div className="state-meta">
                <span>PID {service.pid ?? '?'}</span>
                {service.port !== null ? <span>PORT {service.port}</span> : null}
                <span>{relativeTime(Date.parse(service.startedAt))}</span>
              </div>
            </div>
          ) : null}

          {node.kind === 'task.scheduled' ? <ScheduleBlock node={node} /> : null}
          {node.kind === 'store.folder' && isFinanceFolder(node.path) ? <FinanceBlock /> : null}
          {node.logoSource === 'avatar' || node.logoSource === 'avatar-live' ? <AvatarLogoNote node={node} /> : null}
          <GifNote node={node} />

          <dl className="facts">
            <dt title="Grid position, in tiles from the board origin. Drag in Edit Board mode (E) to change it.">Position</dt>
            <dd>{node.pos.x}, {node.pos.y}</dd>
            <dt title="Size in tiles. Drag the corner handle in Edit Board mode, use Shift+arrows, or set it in the editor.">Size</dt>
            <dd>{fp.w} × {fp.h}</dd>
            {targetField ? <><dt>{targetField.label}</dt><dd className="wrap">{String(node[targetField.key] ?? '(unset)')}</dd></> : null}
            {node.launch ? <>
              <dt title="popout opens Windows Terminal. popout-elevated raises a UAC prompt on every launch.">Launch</dt>
              <dd>{node.launch}{node.launch === 'popout-elevated' ? ' ⚡ ELEVATED' : ''}</dd>
            </> : null}
            {node.kind === 'agent.code' && node.remoteControl === true ? <>
              <dt title="This chip's sessions start with Claude Code's Remote Control. Open the Claude app, signed in as you, to read and drive them. Set in the editor, Session section.">Phone</dt>
              <dd>REACHABLE (REMOTE CONTROL)</dd>
            </> : null}
            {node.prelaunch?.length ? <>
              <dt title="Named update steps this terminal runs before handing over. The commands live in code, never in board JSON.">Primes</dt>
              <dd>{node.prelaunch.join(', ')}</dd>
            </> : null}
            {node.addDirs?.length ? <>
              <dt title="Directories outside the working directory this agent may read and write (claude --add-dir).">Granted</dt>
              <dd className="wrap">{node.addDirs.join('\n')}</dd>
            </> : null}
            {node.openWith ? <><dt title="What a click does.">Open with</dt><dd>{node.openWith}</dd></> : null}
            {node.remote ? <><dt>Remote</dt><dd className="wrap">{node.remote}</dd></> : null}
            {node.schedule ? <><dt>Schedule</dt><dd>{node.schedule}</dd></> : null}
            {node.port !== undefined ? <><dt>Port</dt><dd>{node.port}</dd></> : null}
            {node.tags?.length ? <><dt title="Searchable from Ctrl+K.">Tags</dt><dd>{node.tags.join(', ')}</dd></> : null}
            {node.codexRef ? <><dt>Codex</dt><dd className="wrap">{node.codexRef}</dd></> : null}
            {node.provisional ? <>
              <dt title="A real PCB convention: the footprint is on the board but nothing is fitted to it yet. Bind this node to something and clear the flag.">Provisional</dt>
              <dd className="warntext">UNPOPULATED</dd>
            </> : null}
          </dl>

          {usageRoute ? (
            <div className="state ok" title={`Measured from ~/.claude/projects for ${usageRoute.projects.join(', ')}. This is what the couriers walking to this node are in proportion to.`}>
              <div className="state-line">{Math.round(usageRoute.share * 100)}% OF BOARD ACTIVITY</div>
              <div className="state-meta">
                <span>{formatTokens(usageRoute.windowTokens)} TOKENS</span>
                <span>{usageRoute.projects.length} PROJECT{usageRoute.projects.length === 1 ? '' : 'S'}</span>
                {usageRoute.touchedFiles ? (
                  <span title="Distinct files Claude's tool calls touched inside this node, in the usage window.">
                    {usageRoute.touchedFiles} FILE{usageRoute.touchedFiles === 1 ? '' : 'S'} TOUCHED
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {node.notes ? <div className="notes" title="Free text on the node. Never rendered on the board.">{node.notes}</div> : null}

          <div className="traces-list">
            <div className="section-head">Traces</div>
            {board.edges.filter((e) => e.from === node.id || e.to === node.id).map((e) => (
              <div className="trace-row" key={e.id}>
                <span className="tk">{e.kind}</span>
                <span>{e.from === node.id ? `→ ${e.to}` : `← ${e.from}`}</span>
                {e.relation ? <span className="rel">{e.relation}</span> : null}
              </div>
            ))}
            {!board.edges.some((e) => e.from === node.id || e.to === node.id) ? (
              <div className="dim">NONE</div>
            ) : null}
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * Kinds that resolve to somewhere on this disk you could stand in a shell.
 *
 * Not the same as "has a target": a link.url and a store.cloud point at real things that are not
 * folders, and offering a terminal for them would be a button that can only fail.
 */
function hasDirectory(node: BoardNode): boolean {
  switch (node.kind) {
    case 'store.repo':
    case 'store.folder':
    case 'store.explorer':
    case 'agent.code':
    case 'agent.audit':
    case 'service.process':
    case 'file.document':
    case 'file.exe':
    case 'file.artifact':
      return true;
    case 'store.cloud':
      return Boolean(node.localPath);
    default:
      return false;
  }
}

/** Buttons say what happens. docs/02: "Launch session", "Open in Explorer", not "Go". */
function openLabel(node: BoardNode): string {
  switch (node.kind) {
    case 'agent.code': return 'Launch session';
    case 'agent.audit': return 'Start drive audit';
    case 'agent.prompt': return 'Type a message';
    case 'agent.prompt-to-node': return 'Describe a node';
    case 'monitor.system': return 'Open system monitor';
    case 'agent.chat':
    case 'agent.jarvis': return 'Open conversation in browser';
    case 'drive.room': return 'Descend into room';
    case 'store.explorer': return 'Browse files';
    case 'store.repo':
    case 'store.folder': return node.openWith === 'vscode' ? 'Open in VS Code' : 'Open in Explorer';
    case 'store.cloud':
    case 'link.url': return 'Open in browser';
    case 'file.document': return 'Open document';
    case 'file.exe': return 'Launch program';
    case 'file.artifact': return 'Reveal newest build';
    case 'service.process': return 'Start / stop service';
    default: return 'Open target';
  }
}
