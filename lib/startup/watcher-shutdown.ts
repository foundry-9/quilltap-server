/**
 * Stop both filesystem watchers when the process is told to stop.
 *
 * Registered beside the watchers' start calls in `instrumentation.ts`. The
 * handler is *prepended* to SIGTERM / SIGINT so it runs before the database
 * shutdown handlers (`setupSQLiteShutdownHandlers`) close the connections: a
 * debounce timer firing after that would reach for a closed database. Both
 * stops close their watches and clear their timers synchronously; the `files/`
 * watcher's deferred deletes are left to the next startup reconciliation,
 * which removes a record whose file is gone, rather than written against a
 * connection that is closing.
 *
 * @module startup/watcher-shutdown
 */

import { logger } from '@/lib/logger';
import { stopWatcher } from '@/lib/file-storage/watcher';
import { stopMountWatchers } from '@/lib/mount-index/watcher';

declare global {
  var __quilltapWatcherShutdownHandlersRegistered: boolean | undefined;
}

export function registerWatcherShutdownHandlers(): void {
  // Hot reload re-runs instrumentation; one pair of listeners is enough.
  if (globalThis.__quilltapWatcherShutdownHandlersRegistered) return;
  globalThis.__quilltapWatcherShutdownHandlersRegistered = true;

  const handleShutdown = (signal: string): void => {
    logger.debug('Stopping filesystem watchers for shutdown', {
      context: 'watcher-shutdown',
      signal,
    });
    try {
      stopMountWatchers();
    } catch (err) {
      logger.warn('Error stopping mount watchers at shutdown', {
        context: 'watcher-shutdown',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    stopWatcher({ flushPendingDeletes: false }).catch((err) => {
      logger.warn('Error stopping the files watcher at shutdown', {
        context: 'watcher-shutdown',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };

  process.prependListener('SIGTERM', () => handleShutdown('SIGTERM'));
  process.prependListener('SIGINT', () => handleShutdown('SIGINT'));
}
