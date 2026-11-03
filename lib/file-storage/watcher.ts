/**
 * Filesystem Watcher
 *
 * Watches the files directory for real-time changes through the shared
 * {@link createRecursiveWatcher} (`lib/files/recursive-watcher.ts`), which
 * owns the native recursive `fs.watch`, the per-path debounce, resolving each
 * event against the disk, the cloud-placeholder guard and the polling
 * fallback (`QUILLTAP_WATCHER_POLLING=1`, or a filesystem that refuses a
 * recursive watch). This module keeps only the `files/` domain: when files
 * are added, changed, or removed on disk, it synchronizes the database.
 *
 * - Added files without DB records are created as 'orphaned' status
 * - Changed files get their sha256/size/mtime updated
 * - Removed files have their DB records deleted (after checking sha256 match elsewhere)
 * - Directories are tracked via folder records
 *
 * The _thumbnails/ directory is ignored.
 *
 * @module file-storage/watcher
 */

import { join, basename, normalize, sep } from 'path';
import { createLogger } from '@/lib/logging/create-logger';
import { getFilesDir } from '@/lib/paths';
import { computeSha256, detectMimeType, scanDirectory } from './scanner';
import { preservesContentDigest } from './digest-policy';
import { deriveFolderPathFromStorageKey } from '@/lib/files/folder-utils';
import { isEvictedCloudPlaceholder } from '@/lib/files/cloud-placeholder';
import {
  createRecursiveWatcher,
  type PolledFile,
  type RecursiveWatcher,
} from '@/lib/files/recursive-watcher';
import { stat } from 'fs/promises';

const logger = createLogger('file-storage:watcher');

// ============================================================================
// STATE
// ============================================================================

let watcher: RecursiveWatcher | null = null;

/** Buffer for pending unlink events to detect file moves (unlink + add pair) */
interface PendingUnlink {
  record: any;
  timer: NodeJS.Timeout;
}
const pendingUnlinks = new Map<string, PendingUnlink>();
const PENDING_UNLINK_MS = 3000;

// ============================================================================
// HELPERS
// ============================================================================

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

/**
 * Check if a path should be ignored by the watcher
 */
function shouldIgnore(relativePath: string): boolean {
  // Ignore _thumbnails directory
  if (relativePath.startsWith('_thumbnails/') || relativePath === '_thumbnails') {
    return true;
  }
  // Ignore migration archive directories (created by v4.3 / v4.4 sweeps —
  // safety-net copies of files now living in document-store mounts).
  for (const segment of relativePath.split('/')) {
    if (segment.endsWith('_doc_store_archive') || segment.endsWith('_archive')) {
      return true;
    }
  }
  // Ignore hidden files and legacy sidecars
  const name = basename(relativePath);
  if (name.startsWith('.') || name.endsWith('.meta.json')) {
    return true;
  }
  return false;
}

/**
 * An evicted cloud placeholder (iCloud, OneDrive) is left unread: hashing it
 * would make the provider download it. The core watcher already drops a
 * direct event for one; this catches the files of a folder that arrived.
 */
function isCloudEvicted(relativePath: string, stats: { size: number; blocks: number }): boolean {
  if (!isEvictedCloudPlaceholder(stats)) return false;
  logger.debug('Filesystem watcher left a cloud-evicted file unread', { relativePath });
  return true;
}

/**
 * Get repos lazily to avoid circular imports during startup
 */
async function getRepos() {
  const { getRepositories } = await import('@/lib/database/repositories');
  return getRepositories();
}

/**
 * Get the single-user userId from DB
 */
async function getSingleUserId(): Promise<string> {
  const { getOrCreateSingleUser } = await import('@/lib/auth/single-user');
  const user = await getOrCreateSingleUser();
  return user.id;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle file addition — create DB record if none exists
 */
async function handleFileAdd(filesDir: string, relativePath: string): Promise<void> {
  if (shouldIgnore(relativePath)) return;

  try {
    const repos = await getRepos();
    const absolutePath = join(filesDir, relativePath);

    // Check if a DB record already exists for this storageKey
    const existing = await repos.files.findByStorageKey(relativePath);
    if (existing) {
      return;
    }

    // Compute metadata
    const stats = await stat(absolutePath);
    if (isCloudEvicted(relativePath, stats)) return;
    const sha256 = await computeSha256(absolutePath);
    const mimeType = detectMimeType(relativePath);
    const userId = await getSingleUserId();
    const name = basename(relativePath);

    // Parse projectId and folderPath from the storage key
    const parts = relativePath.split('/');
    const projectOrGeneral = parts[0];
    const projectId = UUID_REGEX.test(projectOrGeneral) ? projectOrGeneral : null;
    const folderPath = deriveFolderPathFromStorageKey(relativePath);

    // Check pending unlinks for a SHA-256 match (file move: unlink + add)
    for (const [oldKey, pending] of pendingUnlinks.entries()) {
      if (pending.record.sha256 === sha256) {
        // Found a match — this is a move, not a delete + create
        clearTimeout(pending.timer);
        pendingUnlinks.delete(oldKey);

        await repos.files.update(pending.record.id, {
          storageKey: relativePath,
          folderPath,
          projectId,
          originalFilename: name,
        });

        logger.info('Detected file move via pending unlink sha256 match', {
          fileId: pending.record.id,
          oldKey,
          newKey: relativePath,
        });
        return;
      }
    }

    // Check if sha256 matches a record that lost its file (moved?)
    const sha256Matches = await repos.files.findBySha256(sha256);
    const movedRecord = sha256Matches?.find((f: any) => f.storageKey !== relativePath);
    if (movedRecord) {
      // The record's old path may still be waiting out its deferred delete;
      // it has moved, so the delete must not land.
      for (const [oldKey, pending] of pendingUnlinks.entries()) {
        if (pending.record.id === movedRecord.id) {
          clearTimeout(pending.timer);
          pendingUnlinks.delete(oldKey);
        }
      }
      // Update existing record with new storageKey (file was moved on disk)
      await repos.files.update(movedRecord.id, {
        storageKey: relativePath,
        folderPath,
        projectId,
      });
      logger.info('Detected file move via sha256 match, updated storageKey', {
        fileId: movedRecord.id,
        oldKey: movedRecord.storageKey,
        newKey: relativePath,
      });
      return;
    }

    // Create new record as orphaned
    await repos.files.create({
      userId,
      sha256,
      originalFilename: name,
      mimeType,
      size: stats.size,
      linkedTo: [],
      source: 'UPLOADED',
      category: mimeType.startsWith('image/') ? 'IMAGE' : 'DOCUMENT',
      storageKey: relativePath,
      projectId,
      folderPath,
      tags: [],
      fileStatus: 'orphaned',
    });

    logger.info('Created orphaned file record for untracked file on disk', {
      storageKey: relativePath,
      sha256: sha256.slice(0, 12) + '...',
      size: stats.size,
    });
  } catch (error) {
    logger.warn('Error handling file add event', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle file change — update DB record
 */
async function handleFileChange(filesDir: string, relativePath: string): Promise<void> {
  if (shouldIgnore(relativePath)) return;

  try {
    const repos = await getRepos();
    const absolutePath = join(filesDir, relativePath);

    const existing = await repos.files.findByStorageKey(relativePath);
    if (!existing) {
      // No DB record — treat as an add
      await handleFileAdd(filesDir, relativePath);
      return;
    }

    // Recompute sha256 and size
    const stats = await stat(absolutePath);
    if (isCloudEvicted(relativePath, stats)) return;
    const sha256 = await computeSha256(absolutePath);

    // Bug 69: an archived character's bundle records the PLAINTEXT digest
    // while the disk bytes are encrypted, so re-deriving `sha256` here
    // replaces the content digest with a ciphertext one and the next
    // rehydrate refuses the bundle as corrupt. Size is still fair game.
    const keepDigest = preservesContentDigest(existing.category);

    if ((!keepDigest && sha256 !== existing.sha256) || stats.size !== existing.size) {
      await repos.files.update(existing.id, {
        ...(keepDigest ? {} : { sha256 }),
        size: stats.size,
      });

      logger.info('Updated file record after on-disk change', {
        fileId: existing.id,
        storageKey: relativePath,
        oldSha256: existing.sha256?.slice(0, 12) + '...',
        newSha256: keepDigest ? 'preserved (content digest)' : sha256.slice(0, 12) + '...',
      });
    }
  } catch (error) {
    logger.warn('Error handling file change event', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle file removal — defer deletion to allow move detection.
 *
 * When a file is moved on disk, the old path disappears and the new one appears.
 * Instead of deleting immediately, we stash the record in pendingUnlinks
 * for a short window. If a matching `add` arrives (same SHA-256),
 * we treat it as a move and preserve all metadata.
 *
 * @returns whether a record existed at this exact key
 */
async function handleFileUnlink(relativePath: string): Promise<boolean> {
  if (shouldIgnore(relativePath)) return false;

  try {
    const repos = await getRepos();

    const existing = await repos.files.findByStorageKey(relativePath);
    if (!existing) {
      return false;
    }

    // Defer the deletion — stash in pending buffer
    const timer = setTimeout(async () => {
      pendingUnlinks.delete(relativePath);
      try {
        await repos.files.delete(existing.id);
        logger.info('Deleted file record after on-disk removal (deferred)', {
          fileId: existing.id,
          storageKey: relativePath,
          filename: existing.originalFilename,
        });
      } catch (err) {
        logger.warn('Error executing deferred file deletion', {
          relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, PENDING_UNLINK_MS);

    pendingUnlinks.set(relativePath, { record: existing, timer });
    return true;
  } catch (error) {
    logger.warn('Error handling file unlink event', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Handle directory addition — create folder record if needed
 */
async function handleDirAdd(relativePath: string): Promise<void> {
  if (shouldIgnore(relativePath)) return;

  try {
    const repos = await getRepos();
    const userId = await getSingleUserId();

    // Parse projectId and folderPath from the relative path
    const parts = relativePath.split('/');
    const projectOrGeneral = parts[0];
    const projectId = UUID_REGEX.test(projectOrGeneral) ? projectOrGeneral : null;

    if (parts.length < 2) {
      // Top-level project directory — no folder record needed
      return;
    }

    const folderName = parts[parts.length - 1];
    const folderPath = '/' + parts.slice(1).join('/') + '/';

    // Find-or-create through the repository chokepoint. The watcher can see
    // the same directory arrive more than once, and a job may be creating
    // the very same folder row concurrently (bug 114).
    await repos.folders.ensureByPath({
      userId,
      path: folderPath,
      name: folderName,
      parentFolderId: null,
      projectId,
    });

    logger.info('Ensured folder record for directory on disk', {
      folderPath,
      projectId,
    });
  } catch (error) {
    logger.warn('Error handling directory add event', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A folder left the files directory (deleted, or moved out). The native watch
 * reports the folder alone, so every record beneath it goes through the
 * deferred unlink — which still lets a move within the directory match up.
 */
async function handleDirUnlink(relativePath: string): Promise<void> {
  try {
    const repos = await getRepos();
    const userId = await getSingleUserId();
    const prefix = relativePath + '/';
    const doomed = (await repos.files.findByUserId(userId))
      .map((f) => f.storageKey)
      .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix));
    if (doomed.length === 0) return;

    logger.debug('Folder left the files directory', {
      relativePath,
      files: doomed.length,
    });
    for (const storageKey of doomed) {
      await handleFileUnlink(storageKey);
    }
  } catch (error) {
    logger.warn('Error handling directory removal', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A folder arrived by rename (created, or moved in). The native watch reports
 * the folder alone, so record it and everything beneath it.
 */
async function handleDirArrival(filesDir: string, relativePath: string): Promise<void> {
  await handleDirAdd(relativePath);
  const entries = await scanDirectory(filesDir, relativePath);
  logger.debug('Folder arrived in the files directory', {
    relativePath,
    entries: entries.length,
  });
  for (const entry of entries) {
    if (entry.isDirectory) {
      await handleDirAdd(entry.relativePath);
    } else {
      await handleFileAdd(filesDir, entry.relativePath);
    }
  }
}

/**
 * A path the watcher found gone: defer-delete its record. After a rename of a
 * path that had no record of its own, also every record beneath it, in case
 * it was a folder — the native watch reports a folder that left by itself. A
 * plain file delete (its record found) never reads the whole table.
 */
async function handleGone(relativePath: string, sawRename: boolean): Promise<void> {
  const hadRecord = await handleFileUnlink(relativePath);
  if (sawRename && !hadRecord) await handleDirUnlink(relativePath);
}

/** A native event's filename as a storage key: relative, '/'-separated. */
function toStorageKey(filename: string): string {
  return normalize(filename).split(sep).join('/');
}

/**
 * The polling snapshot: every file the startup scan would see, keyed by
 * storage key.
 */
async function snapshotFiles(filesDir: string): Promise<Map<string, PolledFile>> {
  const snapshot = new Map<string, PolledFile>();
  for (const entry of await scanDirectory(filesDir)) {
    if (entry.isDirectory) continue;
    snapshot.set(entry.relativePath, { mtimeMs: entry.mtime.getTime(), size: entry.size });
  }
  return snapshot;
}

// ============================================================================
// START / STOP
// ============================================================================

/**
 * Start the filesystem watcher
 *
 * Watches the files directory for changes and syncs with the database.
 */
export function startWatcher(): void {
  if (watcher) {
    logger.warn('File watcher already running, skipping start');
    return;
  }

  const filesDir = getFilesDir();

  logger.info('Starting filesystem watcher', { filesDir });

  try {
    watcher = createRecursiveWatcher({
      root: filesDir,
      normalize: toStorageKey,
      ignore: shouldIgnore,
      polling: { snapshot: () => snapshotFiles(filesDir) },
      on: {
        file: (rel) => handleFileChange(filesDir, rel),
        gone: handleGone,
        dirArrived: (rel) => handleDirArrival(filesDir, rel),
      },
      log: logger,
    });
  } catch (error) {
    // Startup reconciliation and Sync Now still work without a watcher.
    logger.warn('Filesystem watcher could not start', {
      filesDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  logger.info('Filesystem watcher started successfully', {
    filesDir,
    polling: watcher.mode === 'polling',
  });
}

/**
 * Stop the filesystem watcher.
 *
 * The watch closes and every timer clears before anything awaits, so the
 * shutdown hook in `instrumentation.ts` has stopped all disk reactions before
 * the database handlers close their connections. Pending deferred deletes are
 * flushed unless `flushPendingDeletes` is false — at process shutdown the
 * database is closing under us, and the next startup reconciliation removes a
 * record whose file is gone anyway.
 */
export async function stopWatcher(
  options: { flushPendingDeletes?: boolean } = {}
): Promise<void> {
  if (!watcher) {
    return;
  }

  logger.info('Stopping filesystem watcher');

  watcher.close();
  watcher = null;

  const pending = Array.from(pendingUnlinks.entries());
  for (const [, entry] of pending) clearTimeout(entry.timer);
  pendingUnlinks.clear();

  if (options.flushPendingDeletes !== false && pending.length > 0) {
    const repos = await getRepos();
    for (const [storageKey, entry] of pending) {
      try {
        await repos.files.delete(entry.record.id);
      } catch (err) {
        logger.warn('Error flushing pending unlink deletion', {
          storageKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else if (pending.length > 0) {
    logger.debug('Left pending deletes to startup reconciliation', { count: pending.length });
  }

  logger.info('Filesystem watcher stopped');
}
