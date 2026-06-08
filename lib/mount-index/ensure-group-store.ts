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

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  GROUP_OWN_STORE_NAME_PREFIX,
  isGroupOwnStoreName,
} from './group-store-naming';

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
 *      `uniqueMountPointName` for collision handling), insert a
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

  // Read the RAW row, never the overlay-applied `findById`. Provisioning runs
  // BEFORE the store files exist (group creation, startup backfill, and the
  // cutover migration all call this), so the store-only overlay would throw
  // `GroupStoreUnavailableError` (missing properties.json) or, mid-migration,
  // the schema-validating read can reject a legacy wide row. We only need the
  // group's existence, name, and `officialMountPointId` — all raw-row fields.
  const group = await repos.groups.findByIdRaw(groupId);
  if (!group) {
    logger.warn('ensureGroupOfficialStore: group not found', { groupId });
    return null;
  }

  // 1. Existing FK still valid?
  if (group.officialMountPointId) {
    const existing = await repos.docMountPoints.findById(group.officialMountPointId);
    if (existing) {
      return { mountPointId: existing.id, created: false };
    }
    logger.info('Group officialMountPointId points to a missing mount point; will heal', {
      groupId,
      staleMountPointId: group.officialMountPointId,
    });
  }

  // 2. Adopt an existing linked store if one matches.
  const links = await repos.groupDocMountLinks.findByGroupId(groupId);
  if (links.length > 0) {
    const linkedStores = await Promise.all(
      links.map(l => repos.docMountPoints.findById(l.mountPointId)),
    );
    const eligible = linkedStores.filter(
      (s): s is NonNullable<typeof s> =>
        !!s && s.mountType === 'database' && (s.storeType ?? 'documents') === 'documents',
    );
    const adoptable = eligible.find(s => isGroupOwnStoreName(s.name)) ?? eligible[0] ?? null;
    if (adoptable) {
      await repos.groups.update(groupId, { officialMountPointId: adoptable.id });
      logger.info('Adopted existing linked store as group official', {
        groupId,
        mountPointId: adoptable.id,
        storeName: adoptable.name,
      });
      return { mountPointId: adoptable.id, created: false };
    }
  }

  // 3. Create a fresh `Group Files: <name>` store and link it.
  const desiredName = `${GROUP_OWN_STORE_NAME_PREFIX}${(groupName || 'Untitled').trim()}`.slice(0, 200);
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

  await repos.groupDocMountLinks.link(groupId, mountPoint.id);
  await repos.groups.update(groupId, { officialMountPointId: mountPoint.id });

  logger.info('Created group-official document store', {
    groupId,
    mountPointId: mountPoint.id,
    storeName: finalName,
  });

  return { mountPointId: mountPoint.id, created: true };
}
