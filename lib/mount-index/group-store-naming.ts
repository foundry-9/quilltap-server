/**
 * Group Document Store Naming
 *
 * When a group has multiple linked document stores — its own auto-created one
 * plus any the user has manually linked through the Scriptorium UI — we need a
 * way to tell "the group's own store" apart from "manually linked stores" so
 * reads and writes land in the same place.
 *
 * This module is **client-safe** — it contains only pure functions over
 * already-fetched store rows. The runtime helper that creates / adopts a
 * group's official store lives in `lib/mount-index/ensure-group-store.ts`
 * and pulls in repository code (Node-only). Keep that split: anything that
 * needs `getRepositories()` MUST NOT live here, or the FileBrowser bundle
 * picks up `child_process`.
 *
 * @module mount-index/group-store-naming
 */

export const GROUP_OWN_STORE_NAME_PREFIX = 'Group Files: ';

export function isGroupOwnStoreName(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.startsWith(GROUP_OWN_STORE_NAME_PREFIX);
}

export interface StoreLike {
  name: string;
  mountType: 'filesystem' | 'obsidian' | 'database';
  storeType?: 'documents' | 'character';
}

/**
 * Select the group's "own" document store from a list of linked stores.
 *
 * Prefers a database-backed documents store whose name matches the
 * "Group Files: ..." convention. Falls back to the first eligible store if
 * none match the name — this preserves behavior for groups whose only link
 * was added by hand (e.g. newly-created groups that the user linked a
 * store to) and for groups whose auto-created store was renamed after
 * initial creation. Filesystem / obsidian mounts and character stores are
 * ignored either way since they don't participate in the group-store
 * redirect.
 *
 * Used as a startup-heal heuristic only. After v4.10 the canonical resolver
 * is `Group.officialMountPointId`; this helper is consulted when that FK
 * is null and we need to backfill it.
 */
export function pickPrimaryGroupStore<T extends StoreLike>(stores: readonly T[]): T | null {
  const eligible = stores.filter(
    s => s.mountType === 'database' && (s.storeType ?? 'documents') === 'documents'
  );
  if (eligible.length === 0) return null;
  return eligible.find(s => isGroupOwnStoreName(s.name)) ?? eligible[0];
}
