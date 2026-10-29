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
 * The watcher is Node's recursive `fs.watch`: one FSEvents stream per store
 * on macOS, ReadDirectoryChangesW on Windows, inotify on Linux. Chokidar 5
 * has no FSEvents backend and held a kqueue descriptor open for every file
 * and folder it watched; a store on a 24,000-file `~/Documents` reached
 * 15,770 descriptors and Next.js could no longer spawn its compile workers
 * ("spawn EBADF"). `fs.watch` reports only a path and "rename" / "change",
 * so {@link handleNativeEvent} reads the disk to decide what happened.
 *
 * The initial startup scan (PHASE 3.3 in instrumentation.ts) remains the
 * source of truth for baseline indexing; the watcher only reacts to events
 * that occur after it is running.
 *
 * Escape hatch for network filesystems (SMB, NFS) where native events may be
 * missed: `QUILLTAP_WATCHER_POLLING=1` walks the store every
 * {@link POLL_INTERVAL_MS} and compares each indexable file's mtime and size
 * with the previous walk. It holds no descriptors between walks.
 *
 * @module mount-index/watcher
 */

import path from 'path';
import { watch as fsWatch } from 'fs';
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
import { DocMountPoint } from '@/lib/schemas/mount-index.types';

const logger = createServiceLogger('MountIndex:Watcher');

// ============================================================================
// STATE
// ============================================================================

/** What stopWatcherFor needs from either backend. */
interface WatchHandle {
  close(): unknown;
}

interface MountWatcher {
  mountPoint: DocMountPoint;
  instance: WatchHandle;
  fileTimers: Map<string, NodeJS.Timeout>;
  /**
   * Paths that saw a native "rename" inside the current debounce window. Only
   * a rename can be a folder arriving or leaving; a bare "change" on a folder
   * (its metadata) must not trigger a walk.
   */
  pendingRenames: Set<string>;
  embeddingTimer: NodeJS.Timeout | null;
  pendingEmbedding: boolean;
}

const watchers = new Map<string, MountWatcher>();

/** Per-file debounce — coalesces rapid save cycles from editors */
const FILE_DEBOUNCE_MS = 750;

/** Per-mount-point debounce — batches embedding enqueue after a burst of edits */
const EMBEDDING_DEBOUNCE_MS = 2000;

/** Pause between walks when polling */
const POLL_INTERVAL_MS = 2000;

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

function debounceFileEvent(
  watcher: MountWatcher,
  relativePath: string,
  handler: () => Promise<void>
): void {
  const existing = watcher.fileTimers.get(relativePath);
  if (existing) clearTimeout(existing);

  watcher.fileTimers.set(
    relativePath,
    setTimeout(async () => {
      watcher.fileTimers.delete(relativePath);
      try {
        await handler();
      } catch (err) {
        logger.warn('Error in debounced mount watcher handler', {
          mountPointId: watcher.mountPoint.id,
          relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, FILE_DEBOUNCE_MS)
  );
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
  }
}

/**
 * Resolve one debounced native event against the disk.
 *
 *  - a file that exists: index it (add or change are the same to us)
 *  - a path that is gone: drop it from the index; after a rename, also drop
 *    everything indexed beneath it, since a folder deleted or moved out of
 *    the store sends a single event for the folder alone
 *  - a folder that appeared by rename: index every file in it, since a
 *    folder moved in also sends a single event
 *
 * Symlinks are skipped, as the scanner skips them.
 */
async function handleNativeEvent(
  watcher: MountWatcher,
  relativePath: string,
  sawRename: boolean,
): Promise<void> {
  const { mountPoint } = watcher;
  const absolutePath = path.join(mountPoint.basePath, relativePath);

  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
    await handleUnlink(watcher, relativePath);
    if (sawRename && !detectFileType(relativePath)) {
      await removeIndexedBeneath(watcher, relativePath);
    }
    return;
  }

  if (stat.isSymbolicLink()) return;

  if (stat.isFile()) {
    await handleAddOrChange(watcher, absolutePath, relativePath);
    return;
  }

  if (stat.isDirectory() && sawRename) {
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
  }
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
  // flow through db-store-events, which the module-level subscription below
  // translates into the same embedding-scheduler enqueues the filesystem
  // watcher triggers.
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

  const usePolling = process.env.QUILLTAP_WATCHER_POLLING === '1';

  const watcher: MountWatcher = {
    mountPoint,
    instance: { close: () => undefined },
    fileTimers: new Map(),
    pendingRenames: new Set(),
    embeddingTimer: null,
    pendingEmbedding: false,
  };

  let backend: 'native' | 'polling' = usePolling ? 'polling' : 'native';
  if (!usePolling) {
    try {
      watcher.instance = startNativeWatcher(watcher);
    } catch (err) {
      // A filesystem without recursive change notifications (some network
      // mounts) refuses here; polling still works there.
      logger.warn('Native recursive watch unavailable, falling back to polling', {
        mountPointId: mountPoint.id,
        basePath: mountPoint.basePath,
        error: err instanceof Error ? err.message : String(err),
      });
      backend = 'polling';
    }
  }
  if (backend === 'polling') {
    watcher.instance = startPollingWatcher(watcher);
  }
  watchers.set(mountPoint.id, watcher);

  logger.info('Mount watcher started', {
    mountPointId: mountPoint.id,
    name: mountPoint.name,
    basePath: mountPoint.basePath,
    polling: backend === 'polling',
  });
}

/** Excluded by the store's patterns, on any path segment. */
function isExcluded(relativePath: string, mountPoint: DocMountPoint): boolean {
  return mountPoint.excludePatterns.some(p => matchesPattern(relativePath, p));
}

/**
 * Node's recursive `fs.watch`. Every event is debounced per path and resolved
 * against the disk by {@link handleNativeEvent}.
 */
function startNativeWatcher(watcher: MountWatcher): WatchHandle {
  const { mountPoint } = watcher;
  const instance = fsWatch(
    mountPoint.basePath,
    { recursive: true, persistent: true },
    (eventType, filename) => {
      if (filename == null) {
        // Linux can drop the name when its event queue overflows; the next
        // startup scan reconciles whatever was missed.
        logger.debug('Mount watcher event arrived without a path', {
          mountPointId: mountPoint.id,
          eventType,
        });
        return;
      }
      const rel = path.normalize(filename.toString());
      if (!rel || rel === '.' || rel.startsWith('..')) return;
      if (isExcluded(rel, mountPoint)) return;
      if (eventType === 'rename') watcher.pendingRenames.add(rel);
      debounceFileEvent(watcher, rel, () => {
        const sawRename = watcher.pendingRenames.delete(rel);
        return handleNativeEvent(watcher, rel, sawRename);
      });
    },
  );
  instance.on('error', (err: unknown) => {
    logger.error('Mount watcher error', {
      mountPointId: mountPoint.id,
      basePath: mountPoint.basePath,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return instance;
}

/** What one polling walk saw of a file. */
interface PolledFile {
  mtimeMs: number;
  size: number;
}

/**
 * Walk the store and stat every file the scanner would index. Files it would
 * never index are left out, so they cost nothing per walk.
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

/**
 * Polling, for filesystems where native events are unreliable. The first walk
 * is the baseline (the startup scan covers it); every later walk diffs against
 * the one before and debounces each difference like a native event.
 */
function startPollingWatcher(watcher: MountWatcher): WatchHandle {
  const { mountPoint } = watcher;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  let previous: Map<string, PolledFile> | null = null;

  const tick = async (): Promise<void> => {
    try {
      const current = await snapshotStore(mountPoint);
      if (closed) return;
      if (previous) {
        for (const [rel, seen] of current) {
          const before = previous.get(rel);
          if (before && before.mtimeMs === seen.mtimeMs && before.size === seen.size) continue;
          const absolutePath = path.join(mountPoint.basePath, rel);
          debounceFileEvent(watcher, rel, () => handleAddOrChange(watcher, absolutePath, rel));
        }
        for (const rel of previous.keys()) {
          if (current.has(rel)) continue;
          debounceFileEvent(watcher, rel, () => handleUnlink(watcher, rel));
        }
      }
      previous = current;
    } catch (err) {
      logger.error('Mount watcher polling walk failed', {
        mountPointId: mountPoint.id,
        basePath: mountPoint.basePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (!closed) timer = setTimeout(tick, POLL_INTERVAL_MS);
  };
  void tick();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  };
}

async function stopWatcherFor(mountPointId: string): Promise<void> {
  const watcher = watchers.get(mountPointId);
  if (!watcher) return;

  for (const timer of watcher.fileTimers.values()) clearTimeout(timer);
  watcher.fileTimers.clear();
  watcher.pendingRenames.clear();
  if (watcher.embeddingTimer) clearTimeout(watcher.embeddingTimer);

  try {
    await watcher.instance.close();
  } catch (err) {
    logger.warn('Error closing mount watcher', {
      mountPointId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
 * Stop all running watchers. Called during graceful shutdown.
 */
export async function stopMountWatchers(): Promise<void> {
  logger.info('Stopping all mount watchers', { count: watchers.size });
  const ids = Array.from(watchers.keys());
  await Promise.all(ids.map(stopWatcherFor));
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
  await stopWatcherFor(mountPointId);
}

/**
 * Restart a watcher after the mount point's configuration changed
 * (basePath, patterns, or enabled flag toggled).
 */
export async function refreshMountPoint(mountPoint: DocMountPoint): Promise<void> {
  await stopWatcherFor(mountPoint.id);
  if (mountPoint.enabled) {
    await startWatcherFor(mountPoint);
  }
}

