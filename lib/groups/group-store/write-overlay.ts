/**
 * Write overlay for the group document store.
 *
 * Symmetric counterpart to the read overlay. When a `repos.groups.update()`
 * patch carries store-resident fields, route them to the group's official
 * store files instead of DB columns, and return the unmanaged remainder.
 *
 * Also re-exports {@link writeGroupStoreManagedFields}, the full-group writer
 * used by create, the startup backfill, the import path, and the cutover
 * migration to populate all four files from an in-memory group.
 *
 * The behaviour lives in the generic engine (`lib/database/document-store-overlay`);
 * this module re-exports the group-bound write operations.
 *
 * @module groups/group-store/write-overlay
 */

export {
  readGroupStoreProperties,
  writeGroupStoreManagedFields,
  applyGroupStoreWriteOverlay,
} from './overlay';
