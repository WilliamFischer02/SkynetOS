import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * The `--mcp-config` file that gives an agent the `skynet` tools.
 *
 * ── Why this is generated and not checked in ─────────────────────────────────────────────────
 *
 * The config has to name an absolute path to `tools/skynet-mcp.mjs`, and that path is different in
 * development (the repo) and in an installed build (next to the executable, unpacked from asar —
 * see electron-builder.yml). A file in the repo could only be right in one of those, and the way
 * it would be wrong is the worst kind: Claude Code starts, fails to spawn the server, and the
 * agent simply has no board tools, with nothing on screen to say so.
 *
 * So it is written at startup from paths resolved at runtime. It lives in userData beside
 * settings.json and sessions.db, which is also where the control file goes — an agent's whole
 * connection to the board is in one directory.
 *
 * ── Why a name and not a path on the node ────────────────────────────────────────────────────
 *
 * A board node says `"mcpServers": ["skynet"]`, not a path. Board JSON is hand-edited and
 * git-diffable and belongs to William; making him paste an absolute path that changes between his
 * dev checkout and his installed copy would be a trap. `resolveMcpConfigs` maps the name.
 */

/** Where `tools/skynet-mcp.mjs` actually is, in this build. */
function mcpScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tools', 'skynet-mcp.mjs')
    : join(app.getAppPath(), 'tools', 'skynet-mcp.mjs');
}

function configPath(): string {
  return join(app.getPath('userData'), 'mcp', 'skynet.json');
}

/**
 * Write the config and return its path. Called once at startup.
 *
 * `process.execPath` is Electron, which runs a plain script as Node when ELECTRON_RUN_AS_NODE is
 * set. That is deliberate: it means the MCP server runs on the same runtime the app was built
 * against and does not depend on the user having a `node` on PATH — which, on a machine where
 * Node is installed through a version manager, is not a safe assumption for a process spawned by
 * something other than the user's own shell.
 */
export function writeMcpConfig(): string | null {
  const file = configPath();
  const config = {
    mcpServers: {
      skynet: {
        command: process.execPath,
        args: [mcpScriptPath()],
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }
    }
  };

  try {
    mkdirSync(join(app.getPath('userData'), 'mcp'), { recursive: true });
    writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
    return file;
  } catch (err) {
    console.error('[mcp] could not write the config:', (err as Error).message);
    return null;
  }
}

/**
 * Turn a node's `mcpServers` entries into `--mcp-config` paths.
 *
 * A bare name is looked up here; anything containing a separator is passed through as a path the
 * user wrote themselves, so declaring some other MCP server on a node keeps working. An unknown
 * name is dropped with a warning rather than passed to the CLI as a filename that does not exist —
 * Claude Code treats a missing config as a hard startup failure, and losing one server should not
 * cost the whole session.
 */
export function resolveMcpConfigs(names: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const name of names ?? []) {
    if (name.includes('/') || name.includes('\\')) { out.push(name); continue; }
    if (name === 'skynet') { out.push(configPath()); continue; }
    console.warn(`[mcp] node asks for an unknown server "${name}" — ignoring it`);
  }
  return out;
}
