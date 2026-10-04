import { spawn } from 'node:child_process';
import { HEADLESS_ENV, headlessClaudeArgs, unknownOption } from '@shared/converse.js';
import { which } from './which.js';
import { skynetRoot } from './target-resolver.js';

/**
 * One headless `claude -p` call that can only answer text: the prompt on stdin, the text on stdout,
 * no tool, no MCP server, no thinking (packages/shared/converse.ts `headlessClaudeArgs`; docs/07
 * § JARVIS Voice). Conversation and the planner both call this; it was two copies until 2026-09-27.
 *
 * A CLI that does not know `--safe-mode` or `--tools` exits at once with "unknown option": the call
 * is made again with the 2026-09-24 argument list, and that list is used for the rest of the run.
 */

export type HeadlessReason = 'missing' | 'timeout' | 'error' | null;

let legacy = false;

function once(exe: string, prompt: string, args: string[], timeoutMs: number, tag: string): Promise<{ text: string | null; reason: HeadlessReason; stderr: string }> {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (result: { text: string | null; reason: HeadlessReason }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...result, stderr: err });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { cwd: skynetRoot(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...HEADLESS_ENV } });
    } catch (spawnErr) {
      console.warn(`[${tag}] could not start claude:`, (spawnErr as Error).message);
      finish({ text: null, reason: 'error' });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* going anyway */ }
      finish({ text: null, reason: 'timeout' });
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
    child.on('error', (spawnErr) => { console.warn(`[${tag}] claude failed:`, spawnErr.message); finish({ text: null, reason: 'error' }); });
    child.on('close', (code) => {
      if (code !== 0) console.warn(`[${tag}] claude exited ${code}: ${err.trim().slice(0, 300)}`);
      finish({ text: code === 0 ? out : null, reason: code === 0 ? null : 'error' });
    });
    child.stdin?.end(prompt, 'utf8');
  });
}

export async function askClaude(prompt: string, opts: { model: string; system: string; mcpConfig: string; timeoutMs: number; tag: string }): Promise<{ text: string | null; reason: HeadlessReason }> {
  const exe = which('claude.exe') ?? which('claude');
  if (!exe) return { text: null, reason: 'missing' };
  const started = Date.now();
  const first = await once(exe, prompt, headlessClaudeArgs({ model: opts.model, mcpConfig: opts.mcpConfig, system: opts.system, legacy }), opts.timeoutMs, opts.tag);
  if (first.reason === 'error' && !legacy && unknownOption(first.stderr)) {
    legacy = true;
    console.warn(`[${opts.tag}] this claude does not know the lean arguments; using the legacy list from now on`);
    const left = Math.max(1000, opts.timeoutMs - (Date.now() - started));
    const second = await once(exe, prompt, headlessClaudeArgs({ model: opts.model, mcpConfig: opts.mcpConfig, system: opts.system, legacy }), left, opts.tag);
    return { text: second.text, reason: second.reason };
  }
  return { text: first.text, reason: first.reason };
}
