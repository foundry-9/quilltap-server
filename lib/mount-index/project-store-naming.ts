/**
 * Project Document Store Naming
 *
 * The Stage 1 migration gives every project's auto-created Scriptorium store
 * the name "Project Files: <project name>". When a project has multiple
 * linked document stores — its own auto-created one plus any the user has
 * manually linked through the Scriptorium UI — we need a way to tell
 * "the project's own store" apart from "manually linked stores" so reads
 * and writes land in the same place the Files card shows.
 *
 * This module is **client-safe** — it contains only pure functions over
 * already-fetched store rows. The runtime helper that creates / adopts a
 * project's official store lives in
 * `lib/mount-index/ensure-project-store.ts` and pulls in repository code
 * (Node-only). Keep that split: anything that needs `getRepositories()`
 * MUST NOT live here, or the FileBrowser bundle picks up `child_process`.
 *
 * @module mount-index/project-store-naming
 */

export const PROJECT_OWN_STORE_NAME_PREFIX = 'Project Files: ';

export function isProjectOwnStoreName(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.startsWith(PROJECT_OWN_STORE_NAME_PREFIX);
}

export interface StoreLike {
  name: string;
  mountType: 'filesystem' | 'obsidian' | 'database';
  storeType?: 'documents' | 'character';
}

/**
 * Select the project's "own" document store from a list of linked stores.
 *
 * Prefers a database-backed documents store whose name matches the migration's
 * "Project Files: ..." convention. Falls back to the first eligible store if
 * none match the name — this preserves behavior for projects whose only link
 * was added by hand (e.g. newly-created projects that the user linked a
 * store to) and for projects whose auto-created store was renamed after the
 * migration. Filesystem / obsidian mounts and character stores are ignored
 * either way since they don't participate in the project-store redirect.
 *
 * Used as a startup-heal heuristic only. After v4.10 the canonical resolver
 * is `Project.officialMountPointId`; this helper is consulted when that FK
 * is null and we need to backfill it.
 */
export function pickPrimaryProjectStore<T extends StoreLike>(stores: readonly T[]): T | null {
  const eligible = stores.filter(
    s => s.mountType === 'database' && (s.storeType ?? 'documents') === 'documents'
  );
  if (eligible.length === 0) return null;
  return eligible.find(s => isProjectOwnStoreName(s.name)) ?? eligible[0];
}
