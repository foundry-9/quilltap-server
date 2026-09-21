/**
 * `<target>/.quilltap-sync.json` — what the last run left on both sides.
 *
 * Without it "absent on one side" is ambiguous: a file may be new here or
 * deleted there, and the sync would either resurrect everything the operator
 * deleted or delete everything they added. The manifest is what turns that
 * into a decidable question, and the only thing that makes a genuine conflict
 * — both sides edited since the last agreement — detectable rather than
 * silently resolved by whichever clock happens to be ahead.
 *
 * It is also the authoritative carrier of `createdAt` on the disk side,
 * because birthtime cannot be set from user space on Linux and only obliquely
 * on macOS. The comparison stays right even where `stat` cannot be made to
 * agree.
 *
 * It lives in the target directory, is the one dot-entry the walk does not
 * ignore, and never enters the store.
 *
 * @module mount-index/sync/manifest
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import {
  SYNC_MANIFEST_FILENAME,
  SyncManifestSchema,
  type ManifestEntry,
  type SyncManifest,
} from './types';

export class ManifestMismatchError extends Error {
  constructor(public readonly foundStoreId: string, public readonly expectedStoreId: string) {
    super(
      `${SYNC_MANIFEST_FILENAME} in this directory belongs to store ${foundStoreId}, not ${expectedStoreId}. ` +
      `Sync to a different directory, or pass --no-manifest to ignore it.`
    );
    this.name = 'ManifestMismatchError';
  }
}

export function manifestPathFor(targetPath: string): string {
  return path.join(targetPath, SYNC_MANIFEST_FILENAME);
}

/**
 * Read the manifest, or return null when there is none (a first run).
 *
 * A manifest that does not parse is treated as absent and reported as a
 * warning: first-run rules create rather than delete, so the worst a corrupt
 * manifest can cost is a conflict the operator resolves by hand — never a
 * deletion nobody asked for.
 *
 * @throws ManifestMismatchError when the manifest belongs to another store.
 */
export async function readManifest(
  targetPath: string,
  storeId: string,
  warnings: string[]
): Promise<SyncManifest | null> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPathFor(targetPath), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push(`${SYNC_MANIFEST_FILENAME} is not valid JSON; treating this as a first run`);
    return null;
  }

  // The store check comes before schema validation so a manifest from another
  // store is named as such rather than reported as malformed.
  const claimedStoreId = (parsed as { storeId?: unknown })?.storeId;
  if (typeof claimedStoreId === 'string' && claimedStoreId !== storeId) {
    throw new ManifestMismatchError(claimedStoreId, storeId);
  }

  const result = SyncManifestSchema.safeParse(parsed);
  if (!result.success) {
    warnings.push(
      `${SYNC_MANIFEST_FILENAME} did not validate (${result.error.issues[0]?.message ?? 'unknown'}); treating this as a first run`
    );
    return null;
  }
  return result.data;
}

/**
 * Write the manifest atomically — temp file, fsync, rename — so an interrupted
 * run leaves either the previous manifest or the new one, never half of one.
 * A half-written manifest is worse than none: it would read as "these entries
 * existed at the last run" for a prefix of the tree and drive deletions on the
 * rest.
 */
export async function writeManifest(targetPath: string, manifest: SyncManifest): Promise<void> {
  const final = manifestPathFor(targetPath);
  const temp = `${final}.tmp`;
  const body = `${JSON.stringify(manifest, null, 2)}\n`;

  const handle = await fs.open(temp, 'w');
  try {
    await handle.writeFile(body, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, final);
  logger.debug('[Sync] Manifest written', { targetPath, entries: Object.keys(manifest.entries).length });
}

/** An empty base, used under `--no-manifest` and on a first run. */
export function emptyBase(): Map<string, ManifestEntry> {
  return new Map();
}

/** The manifest's entries, keyed by lower-cased path like the two walks. */
export function baseFromManifest(manifest: SyncManifest | null): Map<string, ManifestEntry> {
  const base = new Map<string, ManifestEntry>();
  if (!manifest) return base;
  for (const [key, entry] of Object.entries(manifest.entries)) {
    base.set(key.toLowerCase(), entry);
  }
  return base;
}
