/**
 * Owner Store Lifecycle — server-only.
 *
 * Find / adopt / create the official document store of a project or a group
 * and persist the FK on the owner's row. The two owners differ only in their
 * repository wiring and naming, which is all this module supplies; the
 * find/adopt/create flow itself is `ensure-official-store.ts`.
 *
 * Lives apart from the client-safe naming modules (`project-store-naming.ts`,
 * `group-store-naming.ts`) because it imports the repository factory, which
 * pulls in node-only modules.
 *
 * Used by the startup heal passes (every owner, every boot), the
 * project/group creation hooks, and every route that is about to read or
 * write an owner's store (scenarios, wardrobe) before the next heal pass runs.
 *
 * @module mount-index/ensure-owner-store
 */

import { getRepositories } from '@/lib/repositories/factory';
import { PROJECT_OWN_STORE_NAME_PREFIX, isProjectOwnStoreName } from './project-store-naming';
import { GROUP_OWN_STORE_NAME_PREFIX, isGroupOwnStoreName } from './group-store-naming';
import { ensureOfficialStore } from './ensure-official-store';

/** The two owners that have an official store. */
export type StoreOwnerKind = 'project' | 'group';

/**
 * Find or create the owner's canonical official document store and return its
 * mount-point ID. Idempotent.
 *
 * Resolution order:
 *   1. `owner.officialMountPointId`, when set and the mount point still exists.
 *   2. An existing linked database-backed store (preferring the name-prefix
 *      match), adopted by writing its id to `owner.officialMountPointId`.
 *   3. Otherwise a fresh `Project Files: <name>` / `Group Files: <name>` store
 *      (collision-safe name), linked and recorded on the owner.
 *
 * Returns `{ mountPointId, created }`, or null when the owner row is missing.
 */
export async function ensureOwnerOfficialStore(
  kind: StoreOwnerKind,
  ownerId: string,
  ownerName: string,
): Promise<{ mountPointId: string; created: boolean } | null> {
  const repos = getRepositories();

  if (kind === 'project') {
    return ensureOfficialStore(
      {
        entityLabel: 'project',
        entityLabelCapitalized: 'Project',
        entityIdLogKey: 'projectId',
        storeNamePrefix: PROJECT_OWN_STORE_NAME_PREFIX,
        findEntityRaw: id => repos.projects.findByIdRaw(id),
        setOfficialMountPointId: (id, mpId) => repos.projects.setOfficialMountPointId(id, mpId),
        findLinks: id => repos.projectDocMountLinks.findByProjectId(id),
        link: (id, mpId) => repos.projectDocMountLinks.link(id, mpId),
        isOwnStoreName: isProjectOwnStoreName,
      },
      ownerId,
      ownerName,
    );
  }

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
    ownerId,
    ownerName,
  );
}
