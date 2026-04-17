/**
 * Mount Point Filesystem Watcher
 *
 * Watches each enabled document mount point's basePath for real-time
 * filesystem changes using chokidar. When a file is added, modified, or
 * removed externally, the watcher updates the mount index and schedules
 * re-embedding for any chunks that need it.
 *
 * One chokidar instance is maintained per mount point so that enabling,
 * disabling, or reconfiguring a single mount point does not disturb the
 * others. The API routes that mutate mount points (POST/PATCH/DELETE)
 * call {@link attachMountPoint}, {@link refreshMountPoint}, and
 * {@link detachMountPoint} to keep watchers in sync with the database.
 *
 * The initial startup scan (PHASE 3.3 in instrumentation.ts) remains the
 * source of truth for baseline indexing — this watcher uses
 * `ignoreInitial: true` so it only reacts to events that occur after the
 * watcher is running.
 *
 * Escape hatch for network filesystems (iCloud, SMB, NFS) where fsevents
 * may miss events: set `QUILLTAP_WATCHER_POLLING=1` to enable polling.
 *
 * @module mount-index/watcher
 */

import chokidar from 'chokidar';
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
} from './scanner';
import { enqueueEmbeddingJobsForMountPoint } from './embedding-scheduler';
import { DocMountPoint } from '@/lib/schemas/mount-index.types';

const logger = createServiceLogger('MountIndex:Watcher');

// ============================================================================
// STATE
// ============================================================================

interface MountWatcher {
  mountPoint: DocMountPoint;
  instance: ReturnType<typeof chokidar.watch>;
  fileTimers: Map<string, NodeJS.Timeout>;
  embeddingTimer: NodeJS.Timeout | null;
  pendingEmbedding: boolean;
}

const watchers = new Map<string, MountWatcher>();

/** Per-file debounce — coalesces rapid save cycles from editors */
const FILE_DEBOUNCE_MS = 750;

/** Per-mount-point debounce — batches embedding enqueue after a burst of edits */
const EMBEDDING_DEBOUNCE_MS = 2000;

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
      logger.debug('Embedding enqueue completed after watcher changes', {
        mountPointId: watcher.mountPoint.id,
        enqueued,
      });
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
      logger.debug('Mount watcher skipped empty file', {
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

// ============================================================================
// WATCHER LIFECYCLE
// ============================================================================

async function startWatcherFor(mountPoint: DocMountPoint): Promise<void> {
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

  const instance = chokidar.watch(mountPoint.basePath, {
    persistent: true,
    ignoreInitial: true, // Baseline is covered by the startup scan
    followSymlinks: false,
    depth: 20,
    awaitWriteFinish: {
      stabilityThreshold: 600,
      pollInterval: 100,
    },
    usePolling,
    interval: usePolling ? 2000 : undefined,
    ignored: (filePath: string) => {
      const rel = path.relative(mountPoint.basePath, filePath);
      if (!rel || rel.startsWith('..')) return false; // basePath itself
      // Honour exclude patterns on any path segment
      return mountPoint.excludePatterns.some(p => matchesPattern(rel, p));
    },
  });

  const watcher: MountWatcher = {
    mountPoint,
    instance,
    fileTimers: new Map(),
    embeddingTimer: null,
    pendingEmbedding: false,
  };
  watchers.set(mountPoint.id, watcher);

  instance
    .on('add', (filePath: string) => {
      const rel = path.relative(mountPoint.basePath, filePath);
      debounceFileEvent(watcher, rel, () => handleAddOrChange(watcher, filePath, rel));
    })
    .on('change', (filePath: string) => {
      const rel = path.relative(mountPoint.basePath, filePath);
      debounceFileEvent(watcher, rel, () => handleAddOrChange(watcher, filePath, rel));
    })
    .on('unlink', (filePath: string) => {
      const rel = path.relative(mountPoint.basePath, filePath);
      debounceFileEvent(watcher, rel, () => handleUnlink(watcher, rel));
    })
    .on('error', (err: unknown) => {
      logger.error('Mount watcher error', {
        mountPointId: mountPoint.id,
        basePath: mountPoint.basePath,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  logger.info('Mount watcher started', {
    mountPointId: mountPoint.id,
    name: mountPoint.name,
    basePath: mountPoint.basePath,
    polling: usePolling,
  });
}

async function stopWatcherFor(mountPointId: string): Promise<void> {
  const watcher = watchers.get(mountPointId);
  if (!watcher) return;

  for (const timer of watcher.fileTimers.values()) clearTimeout(timer);
  watcher.fileTimers.clear();
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

/**
 * Test helper — returns the mount point IDs currently being watched.
 */
export function getWatchedMountPointIds(): string[] {
  return Array.from(watchers.keys());
}
