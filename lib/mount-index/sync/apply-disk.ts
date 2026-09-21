/**
 * The disk half of the applier: bytes, sidecars, directories, timestamps.
 *
 * Every write is temp-then-rename, so an interrupted run leaves either the
 * previous file or the new one and never a truncated document the next run
 * would read as an edit. Every path is re-resolved against the target and
 * refused if it escapes — the store's own paths are the input here, and a
 * `..` or an absolute segment in one of them must not be able to write outside
 * the directory the operator named.
 *
 * @module mount-index/sync/apply-disk
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import { renderSidecar, sidecarPathFor } from './sidecar';
import { DISK_TEMP_SUFFIX, type SyncAction } from './types';

export class DiskPathEscapeError extends Error {
  constructor(relativePath: string) {
    super(`Refusing to touch ${relativePath}: it resolves outside the target directory`);
    this.name = 'DiskPathEscapeError';
  }
}

/** Resolve a relative path inside the target, refusing anything that escapes. */
export function resolveInTarget(targetPath: string, relativePath: string): string {
  const base = path.resolve(targetPath);
  const absolute = path.resolve(base, relativePath);
  if (absolute !== base && !absolute.startsWith(base + path.sep)) {
    throw new DiskPathEscapeError(relativePath);
  }
  return absolute;
}

/**
 * Whether the target is there. A path that exists but is not a directory is
 * reported as absent here and refused by {@link ensureTargetDirectory}; under
 * `--dry-run` there is nothing to refuse, because nothing will be written.
 */
export async function targetExists(targetPath: string): Promise<boolean> {
  const stat = await fs.stat(targetPath).catch(() => null);
  return stat !== null && stat.isDirectory();
}

export async function ensureTargetDirectory(targetPath: string): Promise<void> {
  const stat = await fs.stat(targetPath).catch(() => null);
  if (stat && !stat.isDirectory()) {
    throw new Error(`${targetPath} exists and is not a directory`);
  }
  if (!stat) await fs.mkdir(targetPath, { recursive: true });
}

/** Write bytes atomically and stamp the file's clocks. */
export async function writeDiskFile(
  targetPath: string,
  relativePath: string,
  bytes: Buffer,
  times: { lastModified?: string; createdAt?: string | null }
): Promise<void> {
  const absolute = resolveInTarget(targetPath, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });

  const temp = `${absolute}${DISK_TEMP_SUFFIX}`;
  const handle = await fs.open(temp, 'w');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, absolute);
  await applyDiskTimes(absolute, times);
}

/**
 * Set a path's clocks.
 *
 * Node cannot set birthtime on any platform. On macOS (APFS and HFS+) the
 * kernel *lowers* birthtime to match when `utimes` sets an mtime earlier than
 * the current birthtime, so a two-step — creation date first, then the real
 * mtime — makes Finder and `stat` agree. On Linux birthtime is immutable from
 * user space and on Windows Node has no `SetFileTime`; there the first step is
 * simply a redundant `utimes` and the manifest carries the value instead, so
 * the *comparison* stays right even where the *display* cannot.
 */
export async function applyDiskTimes(
  absolutePath: string,
  times: { lastModified?: string; createdAt?: string | null }
): Promise<void> {
  const created = times.createdAt ? new Date(times.createdAt) : null;
  const modified = times.lastModified ? new Date(times.lastModified) : null;

  if (created && !Number.isNaN(created.getTime())) {
    await fs.utimes(absolutePath, created, created).catch(() => {});
  }
  if (modified && !Number.isNaN(modified.getTime())) {
    await fs.utimes(absolutePath, modified, modified);
  }
}

/** True when this platform can be made to report the birthtime we ask for. */
export function birthtimeIsSettable(): boolean {
  return process.platform === 'darwin';
}

export async function makeDiskDirectory(
  targetPath: string,
  relativePath: string,
  times: { lastModified?: string; createdAt?: string | null }
): Promise<void> {
  const absolute = resolveInTarget(targetPath, relativePath);
  await fs.mkdir(absolute, { recursive: true });
  await applyDiskTimes(absolute, times);
}

/**
 * Remove a file and the sidecar that belongs to it — a caption with no image
 * is litter, and on the next run it would read as an orphan warning forever.
 */
export async function removeDiskFile(targetPath: string, relativePath: string): Promise<void> {
  const absolute = resolveInTarget(targetPath, relativePath);
  await fs.rm(absolute, { force: true });
  await fs.rm(resolveInTarget(targetPath, sidecarPathFor(relativePath)), { force: true });
}

/**
 * Remove a directory, non-recursively — a directory that is not empty fails
 * loudly rather than taking unplanned content with it.
 */
export async function removeDiskDirectory(targetPath: string, relativePath: string): Promise<void> {
  const absolute = resolveInTarget(targetPath, relativePath);
  try {
    await fs.rmdir(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw err;
  }
}

/** Write (or remove) a binary's sidecar. An empty description removes it. */
export async function writeDiskSidecar(
  targetPath: string,
  partnerRelativePath: string,
  description: string,
  descriptionUpdatedAt?: string
): Promise<void> {
  const relativePath = sidecarPathFor(partnerRelativePath);
  const body = renderSidecar(description);
  if (body.length === 0) {
    await fs.rm(resolveInTarget(targetPath, relativePath), { force: true });
    return;
  }
  await writeDiskFile(targetPath, relativePath, Buffer.from(body, 'utf-8'), {
    lastModified: descriptionUpdatedAt,
  });
}

/** Apply one disk-side action. Bytes, where needed, are supplied by the caller. */
export async function applyDiskAction(
  targetPath: string,
  action: SyncAction,
  bytes: Buffer | null
): Promise<void> {
  switch (action.kind) {
    case 'mkdir':
      await makeDiskDirectory(targetPath, action.relativePath, action);
      return;
    case 'create':
    case 'modify':
      if (!bytes) throw new Error(`No bytes supplied for ${action.kind} ${action.relativePath}`);
      await writeDiskFile(targetPath, action.relativePath, bytes, action);
      return;
    case 'touch':
      await applyDiskTimes(resolveInTarget(targetPath, action.relativePath), action);
      return;
    case 'describe':
      await writeDiskSidecar(
        targetPath, action.relativePath, action.description ?? '', action.lastModified
      );
      return;
    case 'delete':
      await removeDiskFile(targetPath, action.relativePath);
      return;
    case 'rmdir':
      await removeDiskDirectory(targetPath, action.relativePath);
      return;
    default:
      logger.debug('[Sync] Disk applier ignoring action', { kind: action.kind });
  }
}
