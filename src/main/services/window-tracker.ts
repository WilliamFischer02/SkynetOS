import { spawn, type ChildProcess } from 'node:child_process';
import { parseTrackerLine, TRACKER_INTERVAL_MS, type TrackedWindow } from '@shared/avatar-window.js';

/**
 * Watching windows that are not ours: where a JARVIS Prime terminal is, and whether it is
 * minimised or in front, so its face can stay beside it.
 *
 * Windows Terminal is another program. Electron can only own windows it created, so the face of a
 * terminal session cannot be a child window the way the web Face's is. Instead ONE hidden
 * PowerShell helper asks user32 about top-level windows four times a second and prints one JSON
 * line per tracked title. Main moves the faces to match.
 *
 * What the helper can do is deliberately narrow: it READS titles, rectangles, minimised state and
 * which window is in front. It moves nothing, clicks nothing and sends no input (docs/07). The
 * script is a constant in this file; the only data spliced into it is the list of titles, as
 * base64, so no title can become code.
 *
 * Started when the first window is tracked, stopped when the last is released, restarted after a
 * crash with a back-off. Titles change rarely (a session starting or ending), so a changed set
 * restarts the helper rather than talking to it over stdin: one fewer moving part.
 */

type Listener = (state: TrackedWindow) => void;

const subscribers = new Map<string, Set<Listener>>();
let child: ChildProcess | null = null;
let childSet = '';
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let restartDelay = 1000;
let stopped = false;

/** The helper script for a set of title fragments. Exported for its tests, which hold it read-only. */
export function trackerScript(fragments: readonly string[], intervalMs = TRACKER_INTERVAL_MS): string {
  const payload = Buffer.from(fragments.join('\n'), 'utf8').toString('base64');
  return `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class SkyWinInfo { public IntPtr Handle; public string Title; public int L, T, R, B; public bool Min; }
public static class SkyWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  public static void Aware() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch { }
    try { SetProcessDPIAware(); } catch { }
  }
  public static List<SkyWinInfo> List() {
    var list = new List<SkyWinInfo>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      int n = GetWindowTextLength(h);
      if (n == 0) return true;
      var sb = new StringBuilder(n + 1);
      GetWindowText(h, sb, sb.Capacity);
      RECT r;
      GetWindowRect(h, out r);
      list.Add(new SkyWinInfo { Handle = h, Title = sb.ToString(), L = r.L, T = r.T, R = r.R, B = r.B, Min = IsIconic(h) });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
'@
[SkyWin]::Aware()
$fragments = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) -split "\`n" | Where-Object { $_ }
while ($true) {
  $fg = [SkyWin]::GetForegroundWindow()
  $wins = [SkyWin]::List()
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($f in $fragments) {
    $hit = $null
    foreach ($w in $wins) { if ($w.Title.IndexOf($f, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $hit = $w; break } }
    if ($hit) {
      $out.Add([pscustomobject]@{ f = $f; found = $true; x = $hit.L; y = $hit.T; w = $hit.R - $hit.L; h = $hit.B - $hit.T; min = $hit.Min; vis = $true; fg = ($hit.Handle -eq $fg) })
    } else {
      $out.Add([pscustomobject]@{ f = $f; found = $false })
    }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $out.ToArray() -Compress -Depth 3))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${intervalMs}
}
`;
}

function dispatch(line: string): void {
  const states = parseTrackerLine(line);
  if (!states) return;
  restartDelay = 1000;
  for (const state of states) {
    const listeners = subscribers.get(state.fragment);
    if (listeners) for (const listener of listeners) listener(state);
  }
}

function start(fragments: string[]): void {
  const encoded = Buffer.from(trackerScript(fragments), 'utf16le').toString('base64');
  let proc: ChildProcess;
  try {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    console.warn(`[tracker] could not start: ${(err as Error).message}`);
    return;
  }
  child = proc;
  childSet = JSON.stringify(fragments);
  let buffer = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      dispatch(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  });
  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); });
  proc.on('error', (err) => console.warn(`[tracker] ${err.message}`));
  proc.on('exit', (code) => {
    if (child === proc) { child = null; childSet = ''; }
    if (stopped || !subscribers.size) return;
    console.warn(`[tracker] helper exited (${code ?? '?'})${stderr.trim() ? `: ${stderr.trim().split(/\r?\n/).pop()}` : ''}; restarting in ${restartDelay} ms`);
    setTimeout(() => reconcile(true), restartDelay);
    restartDelay = Math.min(30_000, restartDelay * 2);
  });
  console.log(`[tracker] watching ${fragments.length} window title(s)`);
}

function reconcile(force = false): void {
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    if (stopped) return;
    const wanted = [...subscribers.keys()].sort();
    const set = JSON.stringify(wanted);
    if (!force && set === childSet && child) return;
    if (child) { const old = child; child = null; childSet = ''; old.kill(); }
    if (wanted.length) start(wanted);
  }, force ? 0 : 150);
}

/** Watch a window whose title contains `fragment`. Returns a function that stops watching. */
export function trackWindow(fragment: string, listener: Listener): () => void {
  stopped = false;
  let set = subscribers.get(fragment);
  if (!set) { set = new Set(); subscribers.set(fragment, set); }
  set.add(listener);
  reconcile();
  return () => {
    const current = subscribers.get(fragment);
    if (!current) return;
    current.delete(listener);
    if (!current.size) subscribers.delete(fragment);
    reconcile();
  };
}

/** On quit. */
export function stopWindowTracker(): void {
  stopped = true;
  subscribers.clear();
  if (reconcileTimer) clearTimeout(reconcileTimer);
  if (child) { child.kill(); child = null; childSet = ''; }
}
