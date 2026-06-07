/**
 * Write overlay for the project document store.
 *
 * Symmetric counterpart to the read overlay. When a `repos.projects.update()`
 * patch carries store-resident fields, route them to the project's official
 * store files instead of DB columns, and return the unmanaged remainder (only
 * `name`/`officialMountPointId`/timestamps ever survive to the row).
 *
 * Also exposes {@link writeProjectStoreManagedFields}, the full-project writer
 * used by create, the startup backfill, the import path, and the cutover
 * migration to populate all four files from an in-memory project.
 *
 * Per-mount-point writes are serialized through a promise chain (mirrors the
 * character wardrobe-sync pattern) so concurrent property/state writes can't
 * clobber each other's read-modify-write.
 *
 * @module projects/project-store/write-overlay
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { Project, ProjectProperties } from '@/lib/schemas/project.types';
import {
  ProjectPropertiesSchema,
  PROJECT_STORE_MANAGED_FIELDS,
} from '@/lib/schemas/project.types';
import { writeDatabaseDocument, readDatabaseDocument } from '@/lib/mount-index/database-store';
import {
  PROJECT_PROPERTIES_JSON_PATH,
  PROJECT_DESCRIPTION_MD_PATH,
  PROJECT_INSTRUCTIONS_MD_PATH,
  PROJECT_STATE_JSON_PATH,
  ProjectStoreUnavailableError,
} from './schema';

// ============================================================================
// Per-mount-point write serialization
//
// Chaining per mountPointId prevents two concurrent overlay/write calls from
// each reading a stale properties.json snapshot and writing files that lose one
// of the changes. Mirrors `wardrobeSyncChains` in the character vault overlay.
// ============================================================================

const projectStoreSyncChains = new Map<string, Promise<void>>();

async function runOnProjectStoreChain(
  mountPointId: string,
  work: () => Promise<void>,
): Promise<void> {
  const prev = projectStoreSyncChains.get(mountPointId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => work());
  projectStoreSyncChains.set(mountPointId, next);
  try {
    await next;
  } finally {
    if (projectStoreSyncChains.get(mountPointId) === next) {
      projectStoreSyncChains.delete(mountPointId);
    }
  }
}

/** The 14 property-bag keys, derived from the schema so they can't drift. */
const PROPERTY_KEYS = Object.keys(ProjectPropertiesSchema.shape) as (keyof ProjectProperties)[];

/**
 * Read and validate the project's `properties.json`. Returns null when the file
 * is absent or unparseable (the caller seeds from the in-memory project then).
 */
export async function readProjectStoreProperties(
  mountPointId: string,
): Promise<ProjectProperties | null> {
  try {
    const { content } = await readDatabaseDocument(mountPointId, PROJECT_PROPERTIES_JSON_PATH);
    const parsed = ProjectPropertiesSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ============================================================================
// FULL-PROJECT WRITER
//
// Counterpart to the batched read overlay: given a project object (raw row +
// in-memory field values), project every store-managed field out to its file.
// Writes all four files unconditionally so after a successful call the store is
// a faithful snapshot of the project. Used by create / backfill / import /
// cutover migration.
// ============================================================================

export async function writeProjectStoreManagedFields(
  mountPointId: string,
  project: Project,
): Promise<void> {
  await runOnProjectStoreChain(mountPointId, async () => {
    await writeDatabaseDocument(
      mountPointId,
      PROJECT_PROPERTIES_JSON_PATH,
      JSON.stringify(ProjectPropertiesSchema.parse(project), null, 2),
    );
    await writeDatabaseDocument(
      mountPointId,
      PROJECT_DESCRIPTION_MD_PATH,
      project.description ?? '',
    );
    await writeDatabaseDocument(
      mountPointId,
      PROJECT_INSTRUCTIONS_MD_PATH,
      project.instructions ?? '',
    );
    await writeDatabaseDocument(
      mountPointId,
      PROJECT_STATE_JSON_PATH,
      JSON.stringify(project.state ?? {}, null, 2),
    );
  });
  logger.debug('Wrote project store managed fields', { projectId: project.id, mountPointId });
}

// ============================================================================
// WRITE OVERLAY
// ============================================================================

/**
 * Route the store-resident fields of an update patch to the project's store
 * files, and return the DB-bound remainder (the managed keys stripped out).
 *
 * Throws `ProjectStoreUnavailableError` if the project has a null
 * `officialMountPointId` — provisioning is airtight (create-time + startup
 * backfill), so a write observing null is a bug worth surfacing, not a routine
 * state. The caller should NOT proceed with the DB write if this throws.
 */
export async function applyProjectStoreWriteOverlay(
  projectId: string,
  patch: Partial<Project>,
): Promise<Partial<Project>> {
  const repos = getRepositories();
  const project = await repos.projects.findByIdRaw(projectId);
  if (!project) {
    // Caller will hit the same not-found in _update; let it surface there.
    return patch;
  }

  const dbPatch: Partial<Project> = { ...patch };
  const touchedProps = PROPERTY_KEYS.filter((k) => (k as string) in patch);
  const touchesDescription = 'description' in patch;
  const touchesInstructions = 'instructions' in patch;
  const touchesState = 'state' in patch;
  const touchesStore =
    touchedProps.length > 0 || touchesDescription || touchesInstructions || touchesState;

  if (touchesStore) {
    const mountPointId = project.officialMountPointId;
    if (!mountPointId) {
      logger.error(
        'applyProjectStoreWriteOverlay: project has null officialMountPointId but the patch carries store-resident fields',
        {
          projectId,
          storeFieldsInPatch: [
            ...touchedProps.map(String),
            ...(touchesDescription ? ['description'] : []),
            ...(touchesInstructions ? ['instructions'] : []),
            ...(touchesState ? ['state'] : []),
          ],
        },
      );
      throw new ProjectStoreUnavailableError(
        projectId,
        mountPointId,
        'write attempted with null officialMountPointId',
      );
    }

    await runOnProjectStoreChain(mountPointId, async () => {
      if (touchesDescription) {
        const value = (patch.description ?? '') as string;
        await writeDatabaseDocument(mountPointId, PROJECT_DESCRIPTION_MD_PATH, value);
        logger.debug('Wrote project description.md', { projectId, bytes: value.length });
      }
      if (touchesInstructions) {
        const value = (patch.instructions ?? '') as string;
        await writeDatabaseDocument(mountPointId, PROJECT_INSTRUCTIONS_MD_PATH, value);
        logger.debug('Wrote project instructions.md', { projectId, bytes: value.length });
      }
      if (touchesState) {
        const value = JSON.stringify(patch.state ?? {}, null, 2);
        await writeDatabaseDocument(mountPointId, PROJECT_STATE_JSON_PATH, value);
        logger.debug('Wrote project state.json', { projectId, bytes: value.length });
      }
      if (touchedProps.length > 0) {
        // Read-modify-write so a partial patch doesn't blow away unspecified
        // keys. Seed from the in-memory project when no file exists yet.
        const current = (await readProjectStoreProperties(mountPointId)) ??
          ProjectPropertiesSchema.parse(project);
        const next: ProjectProperties = { ...current };
        for (const k of touchedProps) {
          (next as Record<string, unknown>)[k as string] = (patch as Record<string, unknown>)[
            k as string
          ];
        }
        const value = JSON.stringify(ProjectPropertiesSchema.parse(next), null, 2);
        await writeDatabaseDocument(mountPointId, PROJECT_PROPERTIES_JSON_PATH, value);
        logger.debug('Wrote project properties.json', {
          projectId,
          touched: touchedProps.map(String),
          bytes: value.length,
        });
      }
    });
  }

  // Strip every store-resident key from the DB-bound patch so it never reaches
  // a (post-cutover nonexistent) column. Deleting keys not present is a no-op.
  for (const f of PROJECT_STORE_MANAGED_FIELDS) {
    delete (dbPatch as Record<string, unknown>)[f as string];
  }
  return dbPatch;
}
