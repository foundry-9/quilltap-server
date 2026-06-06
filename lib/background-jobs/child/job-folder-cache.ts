/**
 * Per-job folder-ensure memo (AsyncLocalStorage).
 *
 * Deliberately dependency-free so it can be imported from
 * `lib/mount-index/folder-paths.ts` without dragging the repositories barrel
 * (and its heavy transitive imports) into that module's dependency graph.
 *
 * A fresh map is established once per background job by `runWithJobScope`
 * (which nests `runWithJobFolderCache`). `ensureFolderPath` uses the map to
 * avoid buffering a duplicate `docMountFolders.create` for a folder it already
 * ensured in the same job — in the forked child, repository writes are
 * buffered and reads use a readonly connection, so the existence check can't
 * see a same-job buffered create and the duplicate would violate the
 * (mountPointId, parentId, name) unique index when the parent applies the
 * batch, atomically rolling back the whole job. Outside a job scope (the
 * parent HTTP path) the store is empty and the accessor returns null, where
 * read-your-writes makes the memo unnecessary.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const folderCacheStore = new AsyncLocalStorage<Map<string, string>>();

/**
 * Run `fn` with a fresh per-job folder-ensure memo in scope. Nested inside
 * `runWithJobScope` so every job handler gets one.
 */
export function runWithJobFolderCache<T>(fn: () => Promise<T>): Promise<T> {
  return folderCacheStore.run(new Map<string, string>(), fn);
}

/**
 * The current job's folder-ensure memo, keyed by `${mountPointId}:${path}` →
 * folderId. Null outside a job scope.
 */
export function getJobFolderEnsureCache(): Map<string, string> | null {
  return folderCacheStore.getStore() ?? null;
}
