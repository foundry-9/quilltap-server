/**
 * Mount Point Filesystem Watcher
 *
 * Watches each enabled document mount point's basePath for real-time
 * filesystem changes. When a file is added, modified, or removed externally,
 * the watcher updates the mount index and schedules re-embedding for any
 * chunks that need it.
 *
 * One watcher is maintained per mount point so that enabling, disabling, or
 * reconfiguring a single mount point does not disturb the others. The API
 * routes that mutate mount points (POST/PATCH/DELETE) call
 * {@link attachMountPoint}, {@link refreshMountPoint}, and
 * {@link detachMountPoint} to keep watchers in sync with the database.
 *
 * Each store runs one {@link createRecursiveWatcher} (`lib/files/recursive-watcher.ts`),
 * which owns the native recursive `fs.watch`, the per-path debounce, the
 * resolution of each event against the disk, the cloud-placeholder guard and
 * the polling fallback. This module keeps only the document-store domain:
 * what a changed file, a vanished path or an arriving folder means for the
 * index.
 *
 * Whatever the watcher changes in the index (or a folder arriving or leaving)
 * is announced with {@link publishMountChange}, debounced per store, so an
 * open browser re-reads a store edited outside Quilltap.
 *
 * The initial startup scan (PHASE 3.3 in instrumentation.ts) remains the
 * source of truth for baseline indexing; the watcher only reacts to events
 * that occur after it is running.
 *
 * Escape hatch for network filesystems (SMB, NFS) where native events may be
 * missed: `QUILLTAP_WATCHER_POLLING=1` walks the store every couple of seconds
 * and compares each indexable file's mtime and size with the previous walk
 * (see {@link snapshotStore}). A store whose filesystem refuses a recursive
 * watch falls back to the same polling on its own.
 *
 * @module mount-index/watcher
 */

import path from 'path';
import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  detectFileType,
  matchesPattern,
  processMountFile,
  removeMountFile,
  updateMountPointTotals,
  walkDirectory,
} from './scanner';
import { enqueueEmbeddingJobsForMountPoint } from './embedding-scheduler';
import {
  onDocumentWritten,
  onDocumentDeleted,
  onDocumentMoved,
} from './db-store-events';
import { publishMountChange } from './realtime';
import { DocMountPoint } from '@/lib/schemas/mount-index.types';
import {
  createRecursiveWatcher,
  type PolledFile,
  type RecursiveWatcher,
} from '@/lib/files/recursive-watcher';

const logger = createServiceLogger('MountIndex:Watcher');

// ============================================================================
// STATE
// ============================================================================

interface MountWatcher {
  mountPoint: DocMountPoint;
  instance: RecursiveWatcher | null;
  embeddingTimer: NodeJS.Timeout | null;
  pendingEmbedding: boolean;
  /** Debounces the realtime hint across a burst of changes. */
  publishTimer: NodeJS.Timeout | null;
}

const watchers = new Map<string, MountWatcher>();

/** Per-mount-point debounce — batches embedding enqueue after a burst of edits */
const EMBEDDING_DEBOUNCE_MS = 2000;

/** Per-mount-point debounce — one realtime hint for a burst of changes */
const PUBLISH_DEBOUNCE_MS = 250;

// ============================================================================
// DATABASE-BACKED STORE EVENT BRIDGE
// ============================================================================
//
// Database-backed stores have no filesystem watcher — they emit events from
// database-store.ts when documents are written/deleted/moved. Bridge those
// events into the same embedding-enqueue debounce semantics the filesystem
// watcher uses, so downstream behaviour stays uniform.
//
// Chunking itself is NOT done here: `writeDatabaseDocument` re-chunks inline on
// write (and store-file / doc-edit chunk on their own paths), so by the time the
// debounce fires the chunks already exist and only need embedding. Doing the
// chunk here as well would delete and rebuild chunks those writers just created,
// needlessly discarding their embeddings.

interface DatabaseStoreDebouncer {
  timer: NodeJS.Timeout | null;
  pending: boolean;
}
const databaseStoreDebouncers = new Map<string, DatabaseStoreDebouncer>();

function scheduleDatabaseStoreEmbedding(mountPointId: string): void {
  let state = databaseStoreDebouncers.get(mountPointId);
  if (!state) {
    state = { timer: null, pending: false };
    databaseStoreDebouncers.set(mountPointId, state);
  }
  state.pending = true;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    state!.timer = null;
    if (!state!.pending) return;
    state!.pending = false;
    try {
      const enqueued = await enqueueEmbeddingJobsForMountPoint(mountPointId);
    } catch (err) {
      logger.warn('Failed to enqueue embedding jobs for database-backed store', {
        mountPointId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, EMBEDDING_DEBOUNCE_MS);
}

// Subscribe once at module load — the emitter lives for the process lifetime.
onDocumentWritten(event => scheduleDatabaseStoreEmbedding(event.mountPointId));
onDocumentDeleted(event => scheduleDatabaseStoreEmbedding(event.mountPointId));
onDocumentMoved(event => scheduleDatabaseStoreEmbedding(event.mountPointId));

// ============================================================================
// HELPERS
// ============================================================================

function shouldProcess(relativePath: string, mountPoint: DocMountPoint): boolean {
  // File must have a supported extension
  if (!detectFileType(relativePath)) return false;

  // Respect exclude patterns on any path segment
  if (mountPoint.excludePatterns.some(p => matchesPattern(relativePath, p))) {
    return false;
  }

  // Include patterns: empty list means "all", otherwise must match one
  if (
    mountPoint.includePatterns.length > 0 &&
    !mountPoint.includePatterns.some(p => matchesPattern(relativePath, p))
  ) {
    return false;
  }

  return true;
}

function scheduleEmbedding(watcher: MountWatcher): void {
  watcher.pendingEmbedding = true;
  if (watcher.embeddingTimer) {
    clearTimeout(watcher.embeddingTimer);
  }
  watcher.embeddingTimer = setTimeout(async () => {
    watcher.embeddingTimer = null;
    if (!watcher.pendingEmbedding) return;
    watcher.pendingEmbedding = false;
    try {
      const enqueued = await enqueueEmbeddingJobsForMountPoint(watcher.mountPoint.id);
    } catch (err) {
      logger.warn('Failed to enqueue embedding jobs after watcher changes', {
        mountPointId: watcher.mountPoint.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, EMBEDDING_DEBOUNCE_MS);
}

/** Tell open browsers this store changed on disk, once per burst. */
function schedulePublish(watcher: MountWatcher): void {
  if (watcher.publishTimer) clearTimeout(watcher.publishTimer);
  watcher.publishTimer = setTimeout(() => {
    watcher.publishTimer = null;
    logger.debug('Mount watcher announcing an outside change', { mountPointId: watcher.mountPoint.id });
    publishMountChange(watcher.mountPoint.id);
  }, PUBLISH_DEBOUNCE_MS);
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

async function handleAddOrChange(
  watcher: MountWatcher,
  absolutePath: string,
  relativePath: string
): Promise<void> {
  if (!shouldProcess(relativePath, watcher.mountPoint)) return;

  const outcome = await processMountFile(watcher.mountPoint, absolutePath, relativePath);

  switch (outcome.status) {
    case 'unchanged':
    case 'unsupported':
      return;
    case 'empty':
      return;
    case 'in-cloud':
      // iCloud / OneDrive evicting a file fires a change event. Reading it
      // would download it straight back; the download that brings it home
      // fires another, which indexes it.
      logger.debug('Mount watcher left a cloud-evicted file unread', {
        mountPointId: watcher.mountPoint.id,
        relativePath,
      });
      return;
    case 'new':
    case 'modified':
      logger.info('Mount watcher processed file change', {
        mountPointId: watcher.mountPoint.id,
        relativePath,
        status: outcome.status,
        chunksCreated: outcome.chunksCreated,
      });
      await updateMountPointTotals(watcher.mountPoint.id);
      scheduleEmbedding(watcher);
      schedulePublish(watcher);
      return;
  }
}

async function handleUnlink(
  watcher: MountWatcher,
  relativePath: string
): Promise<void> {
  if (!detectFileType(relativePath)) return;

  const removed = await removeMountFile(watcher.mountPoint.id, relativePath);
  if (removed) {
    logger.info('Mount watcher removed file from index', {
      mountPointId: watcher.mountPoint.id,
      relativePath,
    });
    await updateMountPointTotals(watcher.mountPoint.id);
    schedulePublish(watcher);
  }
}

/**
 * A path the watcher found gone. Drop it from the index; after a rename of a
 * path with no indexable extension, also drop everything indexed beneath it,
 * since a folder deleted or moved out of the store sends a single event for
 * the folder alone.
 */
async function handleGone(
  watcher: MountWatcher,
  relativePath: string,
  sawRename: boolean,
): Promise<void> {
  await handleUnlink(watcher, relativePath);
  if (sawRename && !detectFileType(relativePath)) {
    await removeIndexedBeneath(watcher, relativePath);
    // A folder that left, even an empty one, changes the listing.
    schedulePublish(watcher);
  }
}

/**
 * A folder appeared by rename: index every file in it, since a folder moved
 * in also sends a single event.
 */
async function handleDirArrived(watcher: MountWatcher, relativePath: string): Promise<void> {
  const { mountPoint } = watcher;
  const files = await walkDirectory(
    mountPoint.basePath,
    mountPoint.includePatterns,
    mountPoint.excludePatterns,
    relativePath,
  );
  logger.debug('Mount watcher indexing a folder that arrived', {
    mountPointId: mountPoint.id,
    relativePath,
    files: files.length,
  });
  for (const file of files) {
    await handleAddOrChange(watcher, file.absolutePath, file.relativePath);
  }
  // A folder that arrived, even an empty one, changes the listing.
  schedulePublish(watcher);
}

/** Drop every indexed file under a folder that has left the store. */
async function removeIndexedBeneath(
  watcher: MountWatcher,
  folderRelativePath: string,
): Promise<void> {
  const prefix = folderRelativePath + path.sep;
  const indexed = await getRepositories().docMountFiles.findByMountPointId(watcher.mountPoint.id);
  const doomed = indexed.filter(f => f.relativePath.startsWith(prefix));
  if (doomed.length === 0) return;

  for (const file of doomed) {
    await removeMountFile(watcher.mountPoint.id, file.relativePath);
  }
  logger.info('Mount watcher removed a departed folder from index', {
    mountPointId: watcher.mountPoint.id,
    relativePath: folderRelativePath,
    removed: doomed.length,
  });
  await updateMountPointTotals(watcher.mountPoint.id);
}

// ============================================================================
// WATCHER LIFECYCLE
// ============================================================================

async function startWatcherFor(mountPoint: DocMountPoint): Promise<void> {
  // Database-backed stores have no filesystem to watch — content changes
  // flow through db-store-events, which the module-level subscription in the
  // bridge above translates into the same embedding-scheduler enqueues the
  // filesystem watcher triggers.
  if (mountPoint.mountType === 'database') {
    return;
  }

  // Guard: basePath must exist and be accessible
  try {
    await fs.access(mountPoint.basePath);
  } catch {
    logger.warn('Skipping watcher for inaccessible mount point', {
      mountPointId: mountPoint.id,
      basePath: mountPoint.basePath,
    });
    return;
  }

  const watcher: MountWatcher = {
    mountPoint,
    instance: null,
    embeddingTimer: null,
    pendingEmbedding: false,
    publishTimer: null,
  };

  watcher.instance = createRecursiveWatcher({
    root: mountPoint.basePath,
    normalize: filename => path.normalize(filename),
    ignore: rel => isExcluded(rel, mountPoint),
    polling: { snapshot: () => snapshotStore(mountPoint) },
    on: {
      file: rel => handleAddOrChange(watcher, path.join(mountPoint.basePath, rel), rel),
      gone: (rel, sawRename) => handleGone(watcher, rel, sawRename),
      dirArrived: rel => handleDirArrived(watcher, rel),
      inCloud: rel => {
        logger.debug('Mount watcher left a cloud-evicted file unread', {
          mountPointId: mountPoint.id,
          relativePath: rel,
        });
      },
    },
    log: logger,
    logContext: { mountPointId: mountPoint.id },
  });
  watchers.set(mountPoint.id, watcher);

  logger.info('Mount watcher started', {
    mountPointId: mountPoint.id,
    name: mountPoint.name,
    basePath: mountPoint.basePath,
    polling: watcher.instance.mode === 'polling',
  });
}

/** Excluded by the store's patterns, on any path segment. */
function isExcluded(relativePath: string, mountPoint: DocMountPoint): boolean {
  return mountPoint.excludePatterns.some(p => matchesPattern(relativePath, p));
}

/**
 * The polling snapshot: walk the store and stat every file the scanner would
 * index. Files it would never index are left out, so they cost nothing per
 * walk.
 */
async function snapshotStore(mountPoint: DocMountPoint): Promise<Map<string, PolledFile>> {
  const files = await walkDirectory(
    mountPoint.basePath,
    mountPoint.includePatterns,
    mountPoint.excludePatterns,
  );
  const snapshot = new Map<string, PolledFile>();
  for (const file of files) {
    if (!detectFileType(file.relativePath)) continue;
    try {
      const stat = await fs.stat(file.absolutePath);
      snapshot.set(file.relativePath, { mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      // Gone between the walk and the stat; the next walk reports it.
    }
  }
  return snapshot;
}

function stopWatcherFor(mountPointId: string): void {
  const watcher = watchers.get(mountPointId);
  if (!watcher) return;

  if (watcher.embeddingTimer) clearTimeout(watcher.embeddingTimer);
  if (watcher.publishTimer) clearTimeout(watcher.publishTimer);
  watcher.instance?.close();
  watchers.delete(mountPointId);

  logger.info('Mount watcher stopped', { mountPointId });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Start watchers for every enabled mount point. Safe to call multiple
 * times — existing watchers are left in place.
 */
export async function startMountWatchers(): Promise<void> {
  try {
    const repos = getRepositories();
    const enabled = await repos.docMountPoints.findEnabled();

    logger.info('Starting mount watchers', { count: enabled.length });

    for (const mp of enabled) {
      if (watchers.has(mp.id)) continue;
      await startWatcherFor(mp);
    }
  } catch (err) {
    logger.error('Failed to start mount watchers', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Stop every running watcher. Synchronous, so the shutdown hook registered
 * beside the start call in `instrumentation.ts` finishes before the database
 * handlers close the connections a pending timer would reach for.
 */
export function stopMountWatchers(): void {
  logger.info('Stopping all mount watchers', { count: watchers.size });
  for (const id of Array.from(watchers.keys())) stopWatcherFor(id);
}

/**
 * Begin watching a newly-created or newly-enabled mount point.
 */
export async function attachMountPoint(mountPoint: DocMountPoint): Promise<void> {
  if (!mountPoint.enabled) return;
  if (watchers.has(mountPoint.id)) return;
  await startWatcherFor(mountPoint);
}

/**
 * Stop watching a mount point (deletion or disablement).
 */
export async function detachMountPoint(mountPointId: string): Promise<void> {
  stopWatcherFor(mountPointId);
}

/**
 * Restart a watcher after the mount point's configuration changed
 * (basePath, patterns, or enabled flag toggled).
 */
export async function refreshMountPoint(mountPoint: DocMountPoint): Promise<void> {
  stopWatcherFor(mountPoint.id);
  if (mountPoint.enabled) {
    await startWatcherFor(mountPoint);
  }
}

