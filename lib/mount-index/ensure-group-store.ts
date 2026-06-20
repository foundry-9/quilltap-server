/**
 * Group Store Lifecycle — server-only.
 *
 * Find / adopt / create a group's "group-official" document store and
 * persist the FK on the group row. Lives in its own module (separate from
 * `group-store-naming.ts`) because it imports the repository factory,
 * which transitively pulls in node-only modules (better-sqlite3,
 * child_process). Keeping this code out of `group-store-naming.ts`
 * preserves that file's status as a client-safe pure-function module that
 * the FileBrowser and other UI code can import.
 *
 * The find/adopt/create flow itself lives in the shared
 * `ensure-official-store.ts`; this module is a thin wrapper that supplies the
 * group-specific repository wiring and naming.
 *
 * Used by:
 *   - the startup hook (Phase 3.4) — heals every group on every boot;
 *   - the group-creation hook in `POST /api/v1/groups` — sets up new
 *     groups synchronously so the Files tab and Scenarios are available
 *     immediately;
 *   - the group-scenarios API endpoints — guarantees the store exists
 *     before listing/creating scenarios so the user can hit it before the
 *     next startup runs.
 *
 * @module mount-index/ensure-group-store
 */

import { getRepositories } from '@/lib/repositories/factory';
import {
  GROUP_OWN_STORE_NAME_PREFIX,
  isGroupOwnStoreName,
} from './group-store-naming';
import { ensureOfficialStore } from './ensure-official-store';

/**
 * Find or create the group's canonical "group-official" document store
 * and return its mount-point ID. Idempotent.
 *
 * Resolution order:
 *   1. If `group.officialMountPointId` is set and the mount point still
 *      exists, return it.
 *   2. If a group link exists matching `pickPrimaryGroupStore` semantics
 *      (database-backed `documents` store, prefer name-prefix match), adopt
 *      it: write its ID to `group.officialMountPointId` and return it.
 *   3. Otherwise create a fresh `Group Files: <name>` mount point (using
 *      `nextUniqueMountPointName` for collision handling), insert a
 *      `group_doc_mount_links` row, write the ID to
 *      `group.officialMountPointId`, and return it.
 *
 * Returns `{ mountPointId, created }` where `created` is true when this call
 * created a new mount point (vs. adopting/finding an existing one).
 */
export async function ensureGroupOfficialStore(
  groupId: string,
  groupName: string,
): Promise<{ mountPointId: string; created: boolean } | null> {
  const repos = getRepositories();

  return ensureOfficialStore(
    {
      entityLabel: 'group',
      entityLabelCapitalized: 'Group',
      entityIdLogKey: 'groupId',
      storeNamePrefix: GROUP_OWN_STORE_NAME_PREFIX,
      findEntityRaw: id => repos.groups.findByIdRaw(id),
      setOfficialMountPointId: (id, mpId) => repos.groups.setOfficialMountPointId(id, mpId),
      findLinks: id => repos.groupDocMountLinks.findByGroupId(id),
      link: (id, mpId) => repos.groupDocMountLinks.link(id, mpId),
      isOwnStoreName: isGroupOwnStoreName,
    },
    groupId,
    groupName,
  );
}
