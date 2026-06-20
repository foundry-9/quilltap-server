/**
 * Cloud-file pre-materialization (startup Phase -1, before the .dbkey is read).
 *
 * An instance can live in a cloud-synced folder — iCloud Drive on macOS today,
 * OneDrive / Google Drive File Stream on Windows tomorrow. Those providers
 * EVICT idle files to dataless placeholders to reclaim disk. If a database file
 * is still dataless when SQLite/SQLCipher opens it, the read either fails with
 * "file is not a database" or returns partially-materialized garbage. That has
 * wedged whole startups: recreated users, every character vault read as broken,
 * and a cascade of DEAD avatar/background image jobs.
 *
 * The fix is to force the top-level `data/` files to fully download BEFORE
 * anything reads them. Reading a dataless file synchronously faults it in
 * through the provider, so a streaming read to nowhere is all it takes.
 *
 * Design notes:
 * - DETECTION is the only platform-specific seam (see {@link isDatalessStat}).
 *   On macOS a dataless file reports a real `size` but `blocks === 0` (no local
 *   extents are allocated until the bytes arrive); this mirrors the SF_DATALESS
 *   file flag without spawning `stat`/`find` (whose output we'd have to parse
 *   out of space-laden iCloud paths). Windows placeholders use reparse-point
 *   attributes instead and will get their own branch.
 * - The STREAMING READ, the per-chunk STALL timer, and the progress reporting
 *   are platform-agnostic and shared.
 * - The stall guard is per-chunk, NOT per-file: the timer resets every time a
 *   chunk arrives, so a steadily-downloading multi-gigabyte database never trips
 *   it — only a genuinely wedged/offline fetch does. A per-file deadline would
 *   force us to guess a number large enough for the biggest DB on the slowest
 *   link; per-chunk idle is self-scaling.
 *
 * This module intentionally avoids importing lib/env, lib/logger, or anything
 * that triggers env validation — it runs before all of that. It uses Node
 * built-ins, the paths module, and the standalone migration logger (which is
 * what the sibling .dbkey phase uses).
 */

import fs from 'fs';
import path from 'path';
import { logger as migrationLogger } from '../../migrations/lib/logger';
import { getDataDir, getPlatform } from '@/lib/paths';

/** No bytes for this long during a read = treat the download as stalled. */
const DEFAULT_STALL_MS = 30_000;

/** Read in large chunks so a multi-hundred-MB DB doesn't fire a flood of events. */
const READ_CHUNK_BYTES = 8 * 1024 * 1024;

export interface MaterializeSummary {
  /** Top-level files inspected. */
  checked: number;
  /** Files that were dataless and got faulted in successfully. */
  downloaded: number;
  /** Files that were dataless but could not be retrieved (stalled / errored). */
  failed: number;
  /** Names of the files that failed, for the caller to log/surface. */
  failedNames: string[];
}

/**
 * macOS dataless heuristic: a real file (`size > 0`) with no allocated blocks
 * has not been materialized locally. Mirrors the SF_DATALESS flag. Zero-byte
 * files are never flagged — there is nothing to download.
 */
function isDatalessStat(stat: fs.Stats): boolean {
  return stat.size > 0 && stat.blocks === 0;
}

/**
 * Find the top-level `data/` files (no subdirectories — `backups/` is left
 * alone) that are currently dataless placeholders and need downloading.
 */
function findDatalessTopLevelFiles(
  dataDir: string,
): Array<{ name: string; full: string; size: number }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dataDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: Array<{ name: string; full: string; size: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue; // skip directories and symlinks
    const full = path.join(dataDir, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (isDatalessStat(stat)) {
      out.push({ name: entry.name, full, size: stat.size });
    }
  }
  return out;
}

/**
 * Stream the whole file, discarding bytes, to force the cloud provider to
 * materialize it. Resolves when fully read; rejects if no chunk arrives within
 * `stallMs` (download stalled) or on any read error.
 */
function streamMaterialize(filePath: string, stallMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: READ_CHUNK_BYTES });
    let timer: NodeJS.Timeout;

    const armStallTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stream.destroy(new Error(`stalled — no data for ${Math.round(stallMs / 1000)}s`));
      }, stallMs);
    };

    armStallTimer();
    stream.on('data', () => {
      // Discard the chunk; the read itself is what faults the bytes in.
      armStallTimer();
    });
    stream.on('end', () => {
      clearTimeout(timer);
      resolve();
    });
    stream.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Pre-materialize cloud-evicted top-level data files before any reader touches
 * them. Best-effort: it never throws and never blocks startup indefinitely (a
 * wedged download trips the stall guard and we move on, leaving the existing
 * "file is not a database → retry next restart" path as the backstop).
 *
 * No-op on a healthy instance, a non-cloud folder, or an unsupported platform —
 * detection returns nothing, so steady-state boots pay only one directory stat.
 */
export async function materializeDataDirFiles(options?: {
  dataDir?: string;
  stallMs?: number;
}): Promise<MaterializeSummary> {
  const summary: MaterializeSummary = {
    checked: 0,
    downloaded: 0,
    failed: 0,
    failedNames: [],
  };

  if (process.env.QUILLTAP_SKIP_CLOUD_MATERIALIZE === '1') {
    return summary;
  }

  // Detection is implemented for macOS today. Other platforms fall through as a
  // no-op until their placeholder model is wired in.
  if (getPlatform() !== 'darwin') {
    return summary;
  }

  const stallMs = Math.max(
    1_000,
    options?.stallMs ??
      (Number(process.env.QUILLTAP_CLOUD_MATERIALIZE_STALL_MS) || DEFAULT_STALL_MS),
  );

  let dataDir: string;
  try {
    dataDir = options?.dataDir ?? getDataDir();
  } catch {
    return summary;
  }

  const dataless = findDatalessTopLevelFiles(dataDir);
  summary.checked = dataless.length;
  if (dataless.length === 0) {
    return summary;
  }

  migrationLogger.info(
    `Some of your records have drifted up into the cloud — fetching ${dataless.length} back down before we begin`,
  );

  for (let i = 0; i < dataless.length; i++) {
    const file = dataless[i];
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    migrationLogger.info(
      `Coaxing «${file.name}» (${mb} MB) down from the æther — ${i + 1} of ${dataless.length}…`,
    );
    try {
      await streamMaterialize(file.full, stallMs);
      summary.downloaded++;
      migrationLogger.info(`  …«${file.name}» is safely ashore.`);
    } catch (err) {
      summary.failed++;
      summary.failedNames.push(file.name);
      migrationLogger.warn(
        `  …«${file.name}» would not come down (${
          err instanceof Error ? err.message : String(err)
        }); pressing on regardless.`,
      );
    }
  }

  return summary;
}
