/**
 * Write overlay for the group document store.
 *
 * Symmetric counterpart to the read overlay. When a `repos.groups.update()`
 * patch carries store-resident fields, route them to the group's official
 * store files instead of DB columns, and return the unmanaged remainder (only
 * `name`/`officialMountPointId`/timestamps ever survive to the row).
 *
 * Also exposes {@link writeGroupStoreManagedFields}, the full-group writer
 * used by create, the startup backfill, the import path, and the cutover
 * migration to populate all four files from an in-memory group.
 *
 * Per-mount-point writes are serialized through a promise chain (mirrors the
 * character wardrobe-sync pattern) so concurrent property/state writes can't
 * clobber each other's read-modify-write.
 *
 * @module groups/group-store/write-overlay
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { Group, GroupProperties } from '@/lib/schemas/group.types';
import {
  GroupPropertiesSchema,
  GROUP_STORE_MANAGED_FIELDS,
} from '@/lib/schemas/group.types';
import { writeDatabaseDocument, readDatabaseDocument } from '@/lib/mount-index/database-store';
import {
  GROUP_PROPERTIES_JSON_PATH,
  GROUP_DESCRIPTION_MD_PATH,
  GROUP_INSTRUCTIONS_MD_PATH,
  GROUP_STATE_JSON_PATH,
  GroupStoreUnavailableError,
} from './schema';

// ============================================================================
// Per-mount-point write serialization
//
// Chaining per mountPointId prevents two concurrent overlay/write calls from
// each reading a stale properties.json snapshot and writing files that lose one
// of the changes. Mirrors `wardrobeSyncChains` in the character vault overlay.
// ============================================================================

const groupStoreSyncChains = new Map<string, Promise<void>>();

async function runOnGroupStoreChain(
  mountPointId: string,
  work: () => Promise<void>,
): Promise<void> {
  const prev = groupStoreSyncChains.get(mountPointId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => work());
  groupStoreSyncChains.set(mountPointId, next);
  try {
    await next;
  } finally {
    if (groupStoreSyncChains.get(mountPointId) === next) {
      groupStoreSyncChains.delete(mountPointId);
    }
  }
}

/** The property-bag keys, derived from the schema so they can't drift. */
const PROPERTY_KEYS = Object.keys(GroupPropertiesSchema.shape) as (keyof GroupProperties)[];

/**
 * Read and validate the group's `properties.json`. Returns null when the file
 * is absent or unparseable (the caller seeds from the in-memory group then).
 */
export async function readGroupStoreProperties(
  mountPointId: string,
): Promise<GroupProperties | null> {
  try {
    const { content } = await readDatabaseDocument(mountPointId, GROUP_PROPERTIES_JSON_PATH);
    const parsed = GroupPropertiesSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ============================================================================
// FULL-GROUP WRITER
//
// Counterpart to the batched read overlay: given a group object (raw row +
// in-memory field values), project every store-managed field out to its file.
// Writes all four files unconditionally so after a successful call the store is
// a faithful snapshot of the group. Used by create / backfill / import /
// cutover migration.
// ============================================================================

export async function writeGroupStoreManagedFields(
  mountPointId: string,
  group: Group,
): Promise<void> {
  await runOnGroupStoreChain(mountPointId, async () => {
    await writeDatabaseDocument(
      mountPointId,
      GROUP_PROPERTIES_JSON_PATH,
      JSON.stringify(GroupPropertiesSchema.parse(group), null, 2),
    );
    await writeDatabaseDocument(
      mountPointId,
      GROUP_DESCRIPTION_MD_PATH,
      group.description ?? '',
    );
    await writeDatabaseDocument(
      mountPointId,
      GROUP_INSTRUCTIONS_MD_PATH,
      group.instructions ?? '',
    );
    await writeDatabaseDocument(
      mountPointId,
      GROUP_STATE_JSON_PATH,
      JSON.stringify(group.state ?? {}, null, 2),
    );
  });
  logger.debug('Wrote group store managed fields', { groupId: group.id, mountPointId });
}

// ============================================================================
// WRITE OVERLAY
// ============================================================================

/**
 * Route the store-resident fields of an update patch to the group's store
 * files, and return the DB-bound remainder (the managed keys stripped out).
 *
 * Throws `GroupStoreUnavailableError` if the group has a null
 * `officialMountPointId` — provisioning is airtight (create-time + startup
 * backfill), so a write observing null is a bug worth surfacing, not a routine
 * state. The caller should NOT proceed with the DB write if this throws.
 */
export async function applyGroupStoreWriteOverlay(
  groupId: string,
  patch: Partial<Group>,
): Promise<Partial<Group>> {
  const repos = getRepositories();
  const group = await repos.groups.findByIdRaw(groupId);
  if (!group) {
    // Caller will hit the same not-found in _update; let it surface there.
    return patch;
  }

  const dbPatch: Partial<Group> = { ...patch };
  const touchedProps = PROPERTY_KEYS.filter((k) => (k as string) in patch);
  const touchesDescription = 'description' in patch;
  const touchesInstructions = 'instructions' in patch;
  const touchesState = 'state' in patch;
  const touchesStore =
    touchedProps.length > 0 || touchesDescription || touchesInstructions || touchesState;

  if (touchesStore) {
    const mountPointId = group.officialMountPointId;
    if (!mountPointId) {
      logger.error(
        'applyGroupStoreWriteOverlay: group has null officialMountPointId but the patch carries store-resident fields',
        {
          groupId,
          storeFieldsInPatch: [
            ...touchedProps.map(String),
            ...(touchesDescription ? ['description'] : []),
            ...(touchesInstructions ? ['instructions'] : []),
            ...(touchesState ? ['state'] : []),
          ],
        },
      );
      throw new GroupStoreUnavailableError(
        groupId,
        mountPointId,
        'write attempted with null officialMountPointId',
      );
    }

    await runOnGroupStoreChain(mountPointId, async () => {
      if (touchesDescription) {
        const value = (patch.description ?? '') as string;
        await writeDatabaseDocument(mountPointId, GROUP_DESCRIPTION_MD_PATH, value);
        logger.debug('Wrote group description.md', { groupId, bytes: value.length });
      }
      if (touchesInstructions) {
        const value = (patch.instructions ?? '') as string;
        await writeDatabaseDocument(mountPointId, GROUP_INSTRUCTIONS_MD_PATH, value);
        logger.debug('Wrote group instructions.md', { groupId, bytes: value.length });
      }
      if (touchesState) {
        const value = JSON.stringify(patch.state ?? {}, null, 2);
        await writeDatabaseDocument(mountPointId, GROUP_STATE_JSON_PATH, value);
        logger.debug('Wrote group state.json', { groupId, bytes: value.length });
      }
      if (touchedProps.length > 0) {
        // Read-modify-write so a partial patch doesn't blow away unspecified
        // keys. Seed from the in-memory group when no file exists yet.
        const current = (await readGroupStoreProperties(mountPointId)) ??
          GroupPropertiesSchema.parse(group);
        const next: GroupProperties = { ...current };
        for (const k of touchedProps) {
          (next as Record<string, unknown>)[k as string] = (patch as Record<string, unknown>)[
            k as string
          ];
        }
        const value = JSON.stringify(GroupPropertiesSchema.parse(next), null, 2);
        await writeDatabaseDocument(mountPointId, GROUP_PROPERTIES_JSON_PATH, value);
        logger.debug('Wrote group properties.json', {
          groupId,
          touched: touchedProps.map(String),
          bytes: value.length,
        });
      }
    });
  }

  // Strip every store-resident key from the DB-bound patch so it never reaches
  // a (post-cutover nonexistent) column. Deleting keys not present is a no-op.
  for (const f of GROUP_STORE_MANAGED_FIELDS) {
    delete (dbPatch as Record<string, unknown>)[f as string];
  }
  return dbPatch;
}
