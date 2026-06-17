/**
 * Project Store Lifecycle — server-only.
 *
 * Find / adopt / create a project's "project-official" document store and
 * persist the FK on the project row. Lives in its own module (separate from
 * `project-store-naming.ts`) because it imports the repository factory,
 * which transitively pulls in node-only modules (better-sqlite3,
 * child_process). Keeping this code out of `project-store-naming.ts`
 * preserves that file's status as a client-safe pure-function module that
 * the FileBrowser and other UI code can import.
 *
 * The find/adopt/create flow itself lives in the shared
 * `ensure-official-store.ts`; this module is a thin wrapper that supplies the
 * project-specific repository wiring and naming.
 *
 * Used by:
 *   - the startup hook (Phase 3.4) — heals every project on every boot;
 *   - the project-creation hook in `POST /api/v1/projects` — sets up new
 *     projects synchronously so the Files tab and Scenarios are available
 *     immediately;
 *   - the project-scenarios API endpoints — guarantees the store exists
 *     before listing/creating scenarios so the user can hit it before the
 *     next startup runs.
 *
 * @module mount-index/ensure-project-store
 */

import { getRepositories } from '@/lib/repositories/factory';
import {
  PROJECT_OWN_STORE_NAME_PREFIX,
  isProjectOwnStoreName,
} from './project-store-naming';
import { ensureOfficialStore } from './ensure-official-store';

/**
 * Find or create the project's canonical "project-official" document store
 * and return its mount-point ID. Idempotent.
 *
 * Resolution order:
 *   1. If `project.officialMountPointId` is set and the mount point still
 *      exists, return it.
 *   2. If a project link exists matching `pickPrimaryProjectStore` semantics
 *      (database-backed `documents` store, prefer name-prefix match), adopt
 *      it: write its ID to `project.officialMountPointId` and return it.
 *   3. Otherwise create a fresh `Project Files: <name>` mount point (using
 *      `nextUniqueMountPointName` for collision handling), insert a
 *      `project_doc_mount_links` row, write the ID to
 *      `project.officialMountPointId`, and return it.
 *
 * Returns `{ mountPointId, created }` where `created` is true when this call
 * created a new mount point (vs. adopting/finding an existing one).
 */
export async function ensureProjectOfficialStore(
  projectId: string,
  projectName: string,
): Promise<{ mountPointId: string; created: boolean } | null> {
  const repos = getRepositories();

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
    projectId,
    projectName,
  );
}
