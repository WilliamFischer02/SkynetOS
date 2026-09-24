import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { SEED_DIRS, chooseHome, parseBuildInfo, type BuildInfo, type HomeChoice } from '@shared/home.js';
import { getSettings } from './settings.js';

/**
 * The data home: where `board/`, `codex/` and the pictures live. The rule, and why an install may
 * never own them, is in packages/shared/home.ts. This file supplies the facts and does the one
 * piece of I/O the rule can ask for: seeding a home on a machine that has no repo.
 *
 * Program files are a different matter and stay with the install: the schema the validator was
 * built against, `tools/skynet-mcp.mjs`, and `build-info.json`. See `programRoot()`.
 */

let choice: HomeChoice | null = null;
let buildInfo: BuildInfo | null | undefined;

/** Where the PROGRAM's own files are: the repo in dev, `resources/` in an install. */
export function programRoot(): string {
  if (!app) return process.cwd().replace(/\\/g, '/');
  return (app.isPackaged ? process.resourcesPath : app.getAppPath()).replace(/\\/g, '/');
}

/** What the installer recorded about itself. Null in dev, and in an install made without it. */
export function getBuildInfo(): BuildInfo | null {
  if (buildInfo !== undefined) return buildInfo;
  buildInfo = null;
  if (app?.isPackaged) {
    try {
      buildInfo = parseBuildInfo(readFileSync(join(process.resourcesPath, 'build-info.json'), 'utf8'));
    } catch {
      // An install without the file still runs; it just cannot find the repo it came from.
    }
  }
  return buildInfo;
}

/**
 * Where an install writes down the home it chose. Main writes it; no channel does, so like
 * settings.json it is out of an agent's reach (the home is a trusted root, docs/07).
 */
const rememberedFile = (): string => join(app.getPath('userData'), 'home.json');

function readRemembered(): string | null {
  try {
    const value = (JSON.parse(readFileSync(rememberedFile(), 'utf8')) as { home?: unknown }).home;
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

const hasBoard = (dir: string): boolean => existsSync(join(dir, 'board', 'root.board.json'));

/**
 * Copy the install's starter data into a new home. `force: false` and `errorOnExist: false` make
 * this fill gaps only: a file that is already there is never replaced, so running it twice, or
 * over a half-made home, loses nothing.
 */
function seed(home: string): void {
  mkdirSync(home, { recursive: true });
  for (const rel of SEED_DIRS) {
    const from = join(process.resourcesPath, rel);
    if (!existsSync(from)) continue;
    cpSync(from, join(home, rel), { recursive: true, force: false, errorOnExist: false });
  }
  console.log(`[home] seeded ${home} from the install`);
}

export function homeChoice(): HomeChoice {
  if (choice) return choice;
  // Outside Electron (vitest, tools/) the working directory is the repo. Same answer, other route.
  if (!app) return { home: process.cwd().replace(/\\/g, '/'), source: 'dev' };

  choice = chooseHome({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    settingsHome: getSettings().home,
    remembered: app.isPackaged ? readRemembered() : null,
    builtFrom: getBuildInfo()?.builtFrom ?? null,
    profile: app.getPath('home') || homedir(),
    hasBoard
  });
  if (choice.source === 'seed') {
    try {
      seed(choice.home);
    } catch (err) {
      console.error(`[home] could not seed ${choice.home}: ${(err as Error).message}`);
    }
  }
  if (app.isPackaged && choice.source !== 'remembered') {
    try {
      mkdirSync(app.getPath('userData'), { recursive: true });
      writeFileSync(rememberedFile(), `${JSON.stringify({ home: choice.home, source: choice.source, at: new Date().toISOString() }, null, 2)}\n`);
    } catch (err) {
      console.warn(`[home] could not remember the home: ${(err as Error).message}`);
    }
  }
  if (choice.note) console.warn(`[home] ${choice.note}`);
  console.log(`[home] ${choice.home} (${choice.source})`);
  return choice;
}

/** The data home, forward slashes. `%SKYNET%` expands to this. */
export function homeRoot(): string {
  return homeChoice().home;
}
