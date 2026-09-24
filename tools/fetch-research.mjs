#!/usr/bin/env node
/**
 * Download one file for research, and record where it came from.
 *
 *   node tools/fetch-research.mjs <url> <destDir> [--name file] [--license "..."] [--note "..."] [--max-mb 50] [--allow-html]
 *   node tools/fetch-research.mjs --restore <dir>
 *   npm run research:fetch -- <url> <destDir> ...
 *
 * William, 2026-09-11: "if you can't access the internet and download files yet, now is the time
 * to get that functionality setup / primed for yourself." This is that: one file per call, into a
 * folder, with a line appended to that folder's SOURCES.json — url, the URL it finally came from,
 * size, sha256, date, content type, licence and a note. A research folder whose files cannot be
 * traced back to a source is a pile; this keeps it a library.
 *
 * Deliberately conservative:
 * - http and https only, redirects followed, and a size cap (50 MB unless --max-mb says otherwise),
 *   checked against Content-Length up front and again while streaming.
 * - It never overwrites. An existing file of the same name is a refusal, not a replacement.
 * - A web page arriving under a data name (.csv, .pdf…) is refused: servers answer bad requests
 *   with 200 and an HTML shell, and that is not research. --allow-html overrides it.
 * - It writes to `<file>.part` first and renames only on success, so an interrupted download never
 *   masquerades as a finished one. The only thing it ever removes is its own `.part` from this run.
 * - An unreadable SOURCES.json is refused, not rewritten: it is somebody's record.
 *
 * `--restore <dir>` walks every SOURCES.json under <dir> and fetches each recorded file that is
 * missing on this machine, checking it against the recorded sha256. It is what lets large public
 * binaries stay out of git: the manifest travels, and the files can be rebuilt from it anywhere.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chooseFilename, mergeManifest, parseArgs, restorePlan, suspectHtml } from './fetch-research-lib.mjs';

const USER_AGENT = 'SkynetOS-research-fetch/1.0 (personal research; github.com/WilliamFischer02/SkynetOS)';

/** Stream a response body into `part`, hashing as it goes. Removes only its own `.part` on failure. */
async function streamTo(response, part, capBytes, maxMb) {
  const handle = await open(part, 'wx');
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > capBytes) throw new Error(`download passed the ${maxMb} MB cap; raise it with --max-mb if this is intended`);
      hash.update(chunk);
      await handle.write(chunk);
    }
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    try { unlinkSync(part); } catch { /* our own temp file; leaving it is harmless */ }
    throw error;
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function request(url, capBytes, maxMb) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > capBytes) {
    await response.body?.cancel();
    throw new Error(`${declared} bytes is over the ${maxMb} MB cap; raise it with --max-mb if this is intended`);
  }
  return response;
}

export async function fetchResearch(options) {
  const destDir = resolve(options.destDir);
  mkdirSync(destDir, { recursive: true });
  const capBytes = Math.round(options.maxMb * 1024 * 1024);
  const response = await request(options.url, capBytes, options.maxMb);

  const contentType = response.headers.get('content-type');
  const file = chooseFilename({
    explicit: options.name,
    disposition: response.headers.get('content-disposition'),
    url: response.url || options.url,
    contentType
  });
  if (!options.allowHtml && suspectHtml(file, contentType)) {
    await response.body?.cancel();
    throw new Error(`the server answered with a web page, not ${file}; probably an error page or an app shell. Nothing was saved (--allow-html overrides).`);
  }
  const target = join(destDir, file);
  if (existsSync(target)) {
    await response.body?.cancel();
    throw new Error(`${target} already exists; nothing was overwritten (pass --name to save under another name)`);
  }

  const part = `${target}.part`;
  const { bytes, sha256 } = await streamTo(response, part, capBytes, options.maxMb);
  if (existsSync(target)) throw new Error(`${target} appeared during the download; the new copy is left at ${part}`);
  renameSync(part, target);

  const entry = {
    url: options.url,
    finalUrl: response.url || options.url,
    file,
    bytes,
    sha256,
    retrieved: new Date().toISOString(),
    contentType,
    license: options.license,
    note: options.note
  };
  const manifest = join(destDir, 'SOURCES.json');
  const existing = existsSync(manifest) ? readFileSync(manifest, 'utf8') : null;
  writeFileSync(manifest, mergeManifest(existing, entry));
  return { path: target, ...entry };
}

function manifestsUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...manifestsUnder(full));
    else if (entry.name === 'SOURCES.json') found.push(full);
  }
  return found;
}

/** Rebuild missing files from their manifests. A hash mismatch is kept aside, never installed. */
export async function restoreResearch(dir) {
  const results = [];
  for (const manifest of manifestsUnder(resolve(dir))) {
    const folder = dirname(manifest);
    const plan = restorePlan(readFileSync(manifest, 'utf8'), (file) => existsSync(join(folder, file)));
    for (const skip of plan.skipped) results.push({ file: join(folder, skip.file), status: `skipped: ${skip.reason}` });
    for (const item of plan.fetch) {
      const target = join(folder, item.file);
      const maxMb = Math.max(50, Math.ceil((item.bytes * 1.1) / (1024 * 1024)));
      try {
        const response = await request(item.url, maxMb * 1024 * 1024, maxMb);
        const part = `${target}.part`;
        const { sha256 } = await streamTo(response, part, maxMb * 1024 * 1024, maxMb);
        if (sha256 === item.sha256) {
          renameSync(part, target);
          results.push({ file: target, status: 'restored' });
        } else {
          renameSync(part, `${target}.mismatch`);
          results.push({ file: target, status: `sha256 mismatch: the source changed; new copy left at ${target}.mismatch` });
        }
      } catch (error) {
        results.push({ file: target, status: `failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
  return results;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.mode === 'restore') {
      const results = await restoreResearch(options.dir);
      if (!results.length) console.log('nothing missing: every recorded file is present');
      for (const r of results) console.log(`${r.status}  ${r.file}`);
      if (results.some((r) => !r.status.startsWith('restored'))) process.exitCode = 1;
    } else {
      const result = await fetchResearch(options);
      console.log(`saved ${result.path} (${result.bytes} bytes, sha256 ${result.sha256.slice(0, 12)}…)`);
    }
  } catch (error) {
    console.error(`fetch-research: ${error instanceof Error ? error.message : String(error)}`);
    // exitCode, not exit(): a cancelled response body is still closing its socket, and exiting
    // mid-close trips a libuv assertion on Windows (seen 2026-09-11). Let the loop drain.
    process.exitCode = 1;
  }
}
