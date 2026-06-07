/**
 * Read overlay for the project document store.
 *
 * Re-assembles the hydrated, app-facing `Project` from the slim DB row plus the
 * project's official-store files (`description.md`, `instructions.md`,
 * `state.json`, `properties.json`). The store is the sole source of truth — this
 * overlay never falls back to legacy DB columns.
 *
 * Failure is asymmetric (a deliberate divergence from the character vault
 * overlay, which degrades gracefully):
 *   - {@link applyProjectStoreOverlayOne} (single, behind `findById`) THROWS
 *     `ProjectStoreUnavailableError`. The caller asked for that one project.
 *   - {@link applyProjectStoreOverlay} (batched, behind `findAll`/roster reads)
 *     logs at `error` and DROPS the offending project, so one corrupt row can't
 *     take down the whole project list / Salon. The startup backfill heals it.
 *
 * @module projects/project-store/read-overlay
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { Project } from '@/lib/schemas/project.types';
import { ProjectPropertiesSchema } from '@/lib/schemas/project.types';
import {
  PROJECT_SINGLE_FILE_OVERLAY_PATHS,
  PROJECT_PROPERTIES_JSON_PATH,
  PROJECT_DESCRIPTION_MD_PATH,
  PROJECT_INSTRUCTIONS_MD_PATH,
  PROJECT_STATE_JSON_PATH,
  ProjectStoreUnavailableError,
} from './schema';

/** Empty markdown file → null so nullable fields keep their unset semantics. */
function markdownToNullable(content: string): string | null {
  return content === '' ? null : content;
}

/** path → (mountPointId → file content) */
type ContentByPath = Map<string, Map<string, string>>;

async function loadStoreFiles(mountPointIds: string[]): Promise<ContentByPath> {
  const byPath: ContentByPath = new Map();
  for (const path of PROJECT_SINGLE_FILE_OVERLAY_PATHS) {
    byPath.set(path, new Map());
  }
  if (mountPointIds.length === 0) {
    return byPath;
  }
  const repos = getRepositories();
  const results = await Promise.all(
    PROJECT_SINGLE_FILE_OVERLAY_PATHS.map((path) =>
      repos.docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path),
    ),
  );
  for (let i = 0; i < PROJECT_SINGLE_FILE_OVERLAY_PATHS.length; i++) {
    const byMount = byPath.get(PROJECT_SINGLE_FILE_OVERLAY_PATHS[i])!;
    for (const doc of results[i]) {
      byMount.set(doc.mountPointId, doc.content);
    }
  }
  return byPath;
}

/**
 * Assemble one hydrated `Project` from its row + the loaded store files.
 * Throws `ProjectStoreUnavailableError` when the keystone invariant is broken
 * (null/unreadable mount, or missing/unparseable `properties.json`).
 */
function hydrateOne(row: Project, byPath: ContentByPath): Project {
  const mountId = row.officialMountPointId;
  if (!mountId) {
    throw new ProjectStoreUnavailableError(row.id, mountId, 'officialMountPointId is null');
  }

  const propsRaw = byPath.get(PROJECT_PROPERTIES_JSON_PATH)?.get(mountId);
  if (propsRaw === undefined) {
    throw new ProjectStoreUnavailableError(row.id, mountId, 'properties.json missing');
  }
  let properties;
  try {
    properties = ProjectPropertiesSchema.parse(JSON.parse(propsRaw));
  } catch (err) {
    throw new ProjectStoreUnavailableError(
      row.id,
      mountId,
      `properties.json unparseable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const descRaw = byPath.get(PROJECT_DESCRIPTION_MD_PATH)?.get(mountId);
  const instrRaw = byPath.get(PROJECT_INSTRUCTIONS_MD_PATH)?.get(mountId);
  const stateRaw = byPath.get(PROJECT_STATE_JSON_PATH)?.get(mountId);

  let state: unknown = {};
  if (stateRaw !== undefined) {
    try {
      state = JSON.parse(stateRaw) ?? {};
    } catch {
      // A corrupt state.json is non-fatal — treat as empty (state is not the
      // keystone invariant; only properties.json + the mount are).
      logger.warn('Project state.json unparseable; defaulting to {}', {
        projectId: row.id,
        officialMountPointId: mountId,
      });
      state = {};
    }
  }

  return {
    ...row,
    ...properties,
    description: descRaw !== undefined ? markdownToNullable(descRaw) : null,
    instructions: instrRaw !== undefined ? markdownToNullable(instrRaw) : null,
    state: state as Project['state'],
  };
}

/**
 * Batched overlay for project lists. Loads the four store files for every
 * distinct mount point in one query per file, then hydrates each row. Rows
 * whose store is unavailable are logged at `error` and dropped.
 */
export async function applyProjectStoreOverlay(rows: Project[]): Promise<Project[]> {
  if (rows.length === 0) {
    return rows;
  }
  const mountPointIds = [
    ...new Set(rows.map((r) => r.officialMountPointId).filter((id): id is string => !!id)),
  ];
  logger.debug('applyProjectStoreOverlay: hydrating projects from store', {
    projectCount: rows.length,
    mountPointCount: mountPointIds.length,
  });

  const byPath = await loadStoreFiles(mountPointIds);

  const out: Project[] = [];
  let dropped = 0;
  for (const row of rows) {
    try {
      out.push(hydrateOne(row, byPath));
    } catch (err) {
      if (err instanceof ProjectStoreUnavailableError) {
        dropped++;
        logger.error('Dropping project from list — document store unavailable', {
          projectId: row.id,
          officialMountPointId: row.officialMountPointId ?? null,
          reason: err.message,
        });
        continue;
      }
      throw err;
    }
  }
  if (dropped > 0) {
    logger.warn('applyProjectStoreOverlay dropped projects with unavailable stores', {
      dropped,
      of: rows.length,
    });
  }
  return out;
}

/**
 * Single-project overlay. Throws `ProjectStoreUnavailableError` when the store
 * is unavailable — the caller asked for this specific project, so fail loudly
 * rather than returning a silently-empty object.
 */
export async function applyProjectStoreOverlayOne(row: Project | null): Promise<Project | null> {
  if (!row) {
    return row;
  }
  const mountId = row.officialMountPointId;
  if (!mountId) {
    logger.error('applyProjectStoreOverlayOne: project has null officialMountPointId', {
      projectId: row.id,
    });
    throw new ProjectStoreUnavailableError(row.id, mountId, 'officialMountPointId is null');
  }
  const byPath = await loadStoreFiles([mountId]);
  return hydrateOne(row, byPath);
}
