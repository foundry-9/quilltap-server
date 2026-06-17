/**
 * Write overlay for the project document store.
 *
 * Symmetric counterpart to the read overlay. When a `repos.projects.update()`
 * patch carries store-resident fields, route them to the project's official
 * store files instead of DB columns, and return the unmanaged remainder.
 *
 * Also re-exports {@link writeProjectStoreManagedFields}, the full-project writer
 * used by create, the startup backfill, the import path, and the cutover
 * migration to populate all four files from an in-memory project.
 *
 * The behaviour lives in the generic engine (`lib/database/document-store-overlay`);
 * this module re-exports the project-bound write operations.
 *
 * @module projects/project-store/write-overlay
 */

export {
  readProjectStoreProperties,
  writeProjectStoreManagedFields,
  applyProjectStoreWriteOverlay,
} from './overlay';
