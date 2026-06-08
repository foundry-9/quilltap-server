/**
 * Read overlay for the group document store.
 *
 * Re-assembles the hydrated, app-facing `Group` from the slim DB row plus the
 * group's official-store files (`description.md`, `instructions.md`,
 * `state.json`, `properties.json`). The store is the sole source of truth — this
 * overlay never falls back to legacy DB columns.
 *
 * Failure is asymmetric (a deliberate divergence from the character vault
 * overlay, which degrades gracefully):
 *   - {@link applyGroupStoreOverlayOne} (single, behind `findById`) THROWS
 *     `GroupStoreUnavailableError`. The caller asked for that one group.
 *   - {@link applyGroupStoreOverlay} (batched, behind `findAll`)
 *     logs at `error` and DROPS the offending group, so one corrupt row can't
 *     take down the whole group list. The startup backfill heals it.
 *
 * @module groups/group-store/read-overlay
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { Group } from '@/lib/schemas/group.types';
import { GroupPropertiesSchema } from '@/lib/schemas/group.types';
import {
  GROUP_SINGLE_FILE_OVERLAY_PATHS,
  GROUP_PROPERTIES_JSON_PATH,
  GROUP_DESCRIPTION_MD_PATH,
  GROUP_INSTRUCTIONS_MD_PATH,
  GROUP_STATE_JSON_PATH,
  GroupStoreUnavailableError,
} from './schema';

/** Empty markdown file → null so nullable fields keep their unset semantics. */
function markdownToNullable(content: string): string | null {
  return content === '' ? null : content;
}

/** path → (mountPointId → file content) */
type ContentByPath = Map<string, Map<string, string>>;

async function loadStoreFiles(mountPointIds: string[]): Promise<ContentByPath> {
  const byPath: ContentByPath = new Map();
  for (const path of GROUP_SINGLE_FILE_OVERLAY_PATHS) {
    byPath.set(path, new Map());
  }
  if (mountPointIds.length === 0) {
    return byPath;
  }
  const repos = getRepositories();
  const results = await Promise.all(
    GROUP_SINGLE_FILE_OVERLAY_PATHS.map((path) =>
      repos.docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path),
    ),
  );
  for (let i = 0; i < GROUP_SINGLE_FILE_OVERLAY_PATHS.length; i++) {
    const byMount = byPath.get(GROUP_SINGLE_FILE_OVERLAY_PATHS[i])!;
    for (const doc of results[i]) {
      byMount.set(doc.mountPointId, doc.content);
    }
  }
  return byPath;
}

/**
 * Assemble one hydrated `Group` from its row + the loaded store files.
 * Throws `GroupStoreUnavailableError` when the keystone invariant is broken
 * (null/unreadable mount, or missing/unparseable `properties.json`).
 */
function hydrateOne(row: Group, byPath: ContentByPath): Group {
  const mountId = row.officialMountPointId;
  if (!mountId) {
    throw new GroupStoreUnavailableError(row.id, mountId, 'officialMountPointId is null');
  }

  const propsRaw = byPath.get(GROUP_PROPERTIES_JSON_PATH)?.get(mountId);
  if (propsRaw === undefined) {
    throw new GroupStoreUnavailableError(row.id, mountId, 'properties.json missing');
  }
  let properties;
  try {
    properties = GroupPropertiesSchema.parse(JSON.parse(propsRaw));
  } catch (err) {
    throw new GroupStoreUnavailableError(
      row.id,
      mountId,
      `properties.json unparseable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const descRaw = byPath.get(GROUP_DESCRIPTION_MD_PATH)?.get(mountId);
  const instrRaw = byPath.get(GROUP_INSTRUCTIONS_MD_PATH)?.get(mountId);
  const stateRaw = byPath.get(GROUP_STATE_JSON_PATH)?.get(mountId);

  let state: unknown = {};
  if (stateRaw !== undefined) {
    try {
      state = JSON.parse(stateRaw) ?? {};
    } catch {
      // A corrupt state.json is non-fatal — treat as empty (state is not the
      // keystone invariant; only properties.json + the mount are).
      logger.warn('Group state.json unparseable; defaulting to {}', {
        groupId: row.id,
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
    state: state as Group['state'],
  };
}

/**
 * Batched overlay for group lists. Loads the four store files for every
 * distinct mount point in one query per file, then hydrates each row. Rows
 * whose store is unavailable are logged at `error` and dropped.
 */
export async function applyGroupStoreOverlay(rows: Group[]): Promise<Group[]> {
  if (rows.length === 0) {
    return rows;
  }
  const mountPointIds = [
    ...new Set(rows.map((r) => r.officialMountPointId).filter((id): id is string => !!id)),
  ];
  logger.debug('applyGroupStoreOverlay: hydrating groups from store', {
    groupCount: rows.length,
    mountPointCount: mountPointIds.length,
  });

  const byPath = await loadStoreFiles(mountPointIds);

  const out: Group[] = [];
  let dropped = 0;
  for (const row of rows) {
    try {
      out.push(hydrateOne(row, byPath));
    } catch (err) {
      if (err instanceof GroupStoreUnavailableError) {
        dropped++;
        logger.error('Dropping group from list — document store unavailable', {
          groupId: row.id,
          officialMountPointId: row.officialMountPointId ?? null,
          reason: err.message,
        });
        continue;
      }
      throw err;
    }
  }
  if (dropped > 0) {
    logger.warn('applyGroupStoreOverlay dropped groups with unavailable stores', {
      dropped,
      of: rows.length,
    });
  }
  return out;
}

/**
 * Single-group overlay. Throws `GroupStoreUnavailableError` when the store
 * is unavailable — the caller asked for this specific group, so fail loudly
 * rather than returning a silently-empty object.
 */
export async function applyGroupStoreOverlayOne(row: Group | null): Promise<Group | null> {
  if (!row) {
    return row;
  }
  const mountId = row.officialMountPointId;
  if (!mountId) {
    logger.error('applyGroupStoreOverlayOne: group has null officialMountPointId', {
      groupId: row.id,
    });
    throw new GroupStoreUnavailableError(row.id, mountId, 'officialMountPointId is null');
  }
  const byPath = await loadStoreFiles([mountId]);
  return hydrateOne(row, byPath);
}
