/**
 * One recursive filesystem watcher, shared by the document-store watcher
 * (`lib/mount-index/watcher.ts`) and the instance `files/` watcher
 * (`lib/file-storage/watcher.ts`). It owns everything the two do identically;
 * what is left in each of them is only the domain — what to do with a file
 * that changed, a path that vanished, or a folder that arrived.
 *
 * The backend is Node's recursive `fs.watch`: one FSEvents stream on macOS,
 * ReadDirectoryChangesW on Windows, inotify on Linux. Chokidar 5 held a
 * kqueue descriptor open for every file and folder it watched; a store on a
 * 24,000-file `~/Documents` reached 15,770 descriptors and Next.js could no
 * longer spawn its compile workers ("spawn EBADF"). `fs.watch` reports only a
 * path and "rename" / "change", so {@link resolveEvent} reads the disk to
 * decide what happened.
 *
 * Where `fs.watch` refuses a recursive watch (some network mounts), or when
 * `QUILLTAP_WATCHER_POLLING=1` forces it, the watcher polls instead: it calls
 * the domain's `snapshot` every `intervalMs`, diffs it against the walk before,
 * and sends each difference down the same debounced path as a native event.
 * Polling holds no descriptors between walks.
 *
 * Design of record: docs/developer/features/refactor-4-12-native-watcher-core.md
 *
 * @module files/recursive-watcher
 */

import path from 'path';
import { watch as fsWatch, type Stats } from 'fs';
import { lstat } from 'fs/promises';
import { isEvictedCloudPlaceholder } from './cloud-placeholder';

/** Per-path debounce — coalesces an editor's save cycle into one event. */
export const WATCH_DEBOUNCE_MS = 750;

/** Pause between walks when polling. */
export const POLL_INTERVAL_MS = 2000;

/** What one polling walk saw of a file. */
export interface PolledFile {
  mtimeMs: number;
  size: number;
}

/** The slice of a module logger the watcher writes to. */
export interface WatcherLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface RecursiveWatcherSpec {
  /** Absolute directory to watch. */
  root: string;
  /**
   * A native event's filename as the domain's relative key (mount: native
   * separators; files: '/'-separated storage keys). Empty, `.` and anything
   * climbing out with `..` are refused after this.
   */
  normalize: (filename: string) => string;
  /** Paths the domain never wants to hear about. */
  ignore: (rel: string) => boolean;
  /** Per-path debounce; defaults to {@link WATCH_DEBOUNCE_MS}. */
  debounceMs?: number;
  polling: {
    /** Defaults to {@link POLL_INTERVAL_MS}. */
    intervalMs?: number;
    /** Every file the domain cares about, keyed like `normalize`'s output. */
    snapshot: () => Promise<Map<string, PolledFile>>;
  };
  on: {
    /** A file exists: not a symlink, not an evicted cloud placeholder. */
    file: (rel: string, stat: Stats) => Promise<void>;
    /**
     * The path is gone. `sawRename` is true when a "rename" arrived in the
     * debounce window — only then can the path have been a folder that left.
     */
    gone: (rel: string, sawRename: boolean) => Promise<void>;
    /** A folder appeared by rename (created, or moved in). */
    dirArrived: (rel: string) => Promise<void>;
    /** An evicted cloud placeholder was seen and left unread. */
    inCloud?: (rel: string) => void;
  };
  log: WatcherLogger;
  /** Extra fields for every log line (e.g. the store's id). */
  logContext?: Record<string, unknown>;
}

export interface RecursiveWatcher {
  readonly mode: 'native' | 'polling';
  /** Clears every pending timer and stops watching. Idempotent. */
  close(): void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Start watching `spec.root`. Throws only if polling itself cannot start,
 * which it always can; a refused native watch falls back to polling.
 */
export function createRecursiveWatcher(spec: RecursiveWatcherSpec): RecursiveWatcher {
  const { root, log } = spec;
  const ctx = { root, ...spec.logContext };
  const debounceMs = spec.debounceMs ?? WATCH_DEBOUNCE_MS;
  const timers = new Map<string, NodeJS.Timeout>();
  /**
   * Paths that saw a native "rename" inside the current debounce window. Only
   * a rename can be a folder arriving or leaving; a bare "change" on a folder
   * (its metadata) must not trigger a walk.
   */
  const pendingRenames = new Set<string>();
  let closed = false;

  const resolveEvent = async (rel: string, sawRename: boolean): Promise<void> => {
    let stat: Stats;
    try {
      stat = await lstat(path.join(root, rel));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
      await spec.on.gone(rel, sawRename);
      return;
    }

    // Symlinks are skipped, as every scanner skips them.
    if (stat.isSymbolicLink()) return;

    if (stat.isFile()) {
      // iCloud / OneDrive evicting a file fires an event. Reading it would
      // download it straight back; the download that brings it home fires
      // another, which is handled then.
      if (isEvictedCloudPlaceholder(stat)) {
        if (spec.on.inCloud) spec.on.inCloud(rel);
        else log.debug('Watcher left a cloud-evicted file unread', { ...ctx, relativePath: rel });
        return;
      }
      await spec.on.file(rel, stat);
      return;
    }

    if (stat.isDirectory() && sawRename) {
      await spec.on.dirArrived(rel);
    }
  };

  const schedule = (rel: string, rename: boolean): void => {
    if (closed) return;
    if (rename) pendingRenames.add(rel);
    const existing = timers.get(rel);
    if (existing) clearTimeout(existing);
    timers.set(
      rel,
      setTimeout(async () => {
        timers.delete(rel);
        const sawRename = pendingRenames.delete(rel);
        try {
          await resolveEvent(rel, sawRename);
        } catch (err) {
          log.warn('Error in debounced watcher handler', {
            ...ctx,
            relativePath: rel,
            error: errorMessage(err),
          });
        }
      }, debounceMs),
    );
  };

  let closeBackend: () => void = () => undefined;
  let mode: 'native' | 'polling' = process.env.QUILLTAP_WATCHER_POLLING === '1' ? 'polling' : 'native';

  if (mode === 'native') {
    try {
      closeBackend = startNative();
    } catch (err) {
      // A filesystem without recursive change notifications (some network
      // mounts) refuses here; polling still works there.
      log.warn('Native recursive watch unavailable, falling back to polling', {
        ...ctx,
        error: errorMessage(err),
      });
      mode = 'polling';
    }
  }
  if (mode === 'polling') closeBackend = startPolling();

  log.debug('Recursive watcher started', { ...ctx, mode });

  function startNative(): () => void {
    const instance = fsWatch(root, { recursive: true, persistent: true }, (eventType, filename) => {
      if (filename == null) {
        // Linux can drop the name when its event queue overflows; the next
        // startup scan reconciles whatever was missed.
        log.debug('Watcher event arrived without a path', { ...ctx, eventType });
        return;
      }
      const rel = spec.normalize(filename.toString());
      if (!rel || rel === '.' || rel.startsWith('..')) return;
      if (spec.ignore(rel)) return;
      schedule(rel, eventType === 'rename');
    });
    instance.on('error', (err: unknown) => {
      log.error('Watcher error', { ...ctx, error: errorMessage(err) });
    });
    return () => instance.close();
  }

  /**
   * The first walk is the baseline (the startup scan covers it); every later
   * walk diffs against the one before. A path that left goes down as a
   * rename, so the domain hears it as one that vanished.
   */
  function startPolling(): () => void {
    const intervalMs = spec.polling.intervalMs ?? POLL_INTERVAL_MS;
    let timer: NodeJS.Timeout | null = null;
    let previous: Map<string, PolledFile> | null = null;

    const tick = async (): Promise<void> => {
      try {
        const current = await spec.polling.snapshot();
        if (closed) return;
        if (previous) {
          for (const [rel, seen] of current) {
            const before = previous.get(rel);
            if (before && before.mtimeMs === seen.mtimeMs && before.size === seen.size) continue;
            schedule(rel, false);
          }
          for (const rel of previous.keys()) {
            if (!current.has(rel)) schedule(rel, true);
          }
        }
        previous = current;
      } catch (err) {
        log.error('Watcher polling walk failed', { ...ctx, error: errorMessage(err) });
      }
      if (!closed) timer = setTimeout(tick, intervalMs);
    };
    void tick();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }

  return {
    get mode() {
      return mode;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pendingRenames.clear();
      try {
        closeBackend();
      } catch (err) {
        log.warn('Error closing watcher', { ...ctx, error: errorMessage(err) });
      }
      log.debug('Recursive watcher closed', { ...ctx, mode });
    },
  };
}
