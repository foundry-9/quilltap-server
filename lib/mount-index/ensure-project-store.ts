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

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  PROJECT_OWN_STORE_NAME_PREFIX,
  isProjectOwnStoreName,
} from './project-store-naming';

/**
 * Append `(2)`, `(3)`, etc. to `desiredName` until it does not collide with an
 * existing mount-point name. Mirrors the helper in
 * `migrations/scripts/convert-project-files-to-document-stores.ts:521` so
 * runtime auto-creation and the one-time migration use the same naming policy.
 */
async function uniqueMountPointName(desiredName: string): Promise<string> {
  const repos = getRepositories();
  const all = await repos.docMountPoints.findAll();
  const taken = new Set(all.map(mp => mp.name));
  if (!taken.has(desiredName)) return desiredName;
  let suffix = 2;
  while (taken.has(`${desiredName} (${suffix})`)) suffix++;
  return `${desiredName} (${suffix})`;
}

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
 *      `uniqueMountPointName` for collision handling), insert a
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

  const project = await repos.projects.findById(projectId);
  if (!project) {
    logger.warn('ensureProjectOfficialStore: project not found', { projectId });
    return null;
  }

  // 1. Existing FK still valid?
  if (project.officialMountPointId) {
    const existing = await repos.docMountPoints.findById(project.officialMountPointId);
    if (existing) {
      return { mountPointId: existing.id, created: false };
    }
    logger.info('Project officialMountPointId points to a missing mount point; will heal', {
      projectId,
      staleMountPointId: project.officialMountPointId,
    });
  }

  // 2. Adopt an existing linked store if one matches.
  const links = await repos.projectDocMountLinks.findByProjectId(projectId);
  if (links.length > 0) {
    const linkedStores = await Promise.all(
      links.map(l => repos.docMountPoints.findById(l.mountPointId)),
    );
    const eligible = linkedStores.filter(
      (s): s is NonNullable<typeof s> =>
        !!s && s.mountType === 'database' && (s.storeType ?? 'documents') === 'documents',
    );
    const adoptable = eligible.find(s => isProjectOwnStoreName(s.name)) ?? eligible[0] ?? null;
    if (adoptable) {
      await repos.projects.update(projectId, { officialMountPointId: adoptable.id });
      logger.info('Adopted existing linked store as project official', {
        projectId,
        mountPointId: adoptable.id,
        storeName: adoptable.name,
      });
      return { mountPointId: adoptable.id, created: false };
    }
  }

  // 3. Create a fresh `Project Files: <name>` store and link it.
  const desiredName = `${PROJECT_OWN_STORE_NAME_PREFIX}${(projectName || 'Untitled').trim()}`.slice(0, 200);
  const finalName = await uniqueMountPointName(desiredName);

  const mountPoint = await repos.docMountPoints.create({
    name: finalName,
    basePath: '',
    mountType: 'database',
    storeType: 'documents',
    includePatterns: [],
    excludePatterns: ['.git', 'node_modules', '.obsidian', '.trash'],
    enabled: true,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
  });

  await repos.projectDocMountLinks.link(projectId, mountPoint.id);
  await repos.projects.update(projectId, { officialMountPointId: mountPoint.id });

  logger.info('Created project-official document store', {
    projectId,
    mountPointId: mountPoint.id,
    storeName: finalName,
  });

  return { mountPointId: mountPoint.id, created: true };
}
