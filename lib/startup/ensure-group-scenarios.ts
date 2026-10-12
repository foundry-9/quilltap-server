/**
 * Startup-time idempotent reconciliation of group document stores and
 * Scenarios/Knowledge folders.
 *
 * For every group:
 *   1. Ensure `group.officialMountPointId` points at a real, eligible
 *      mount point — adopting an existing linked store via
 *      `pickPrimaryGroupStore` semantics, or creating a fresh
 *      `Group Files: <name>` store as a fallback.
 *   2. Ensure the `Scenarios/` folder exists in that store.
 *   3. Ensure the `Knowledge/` folder exists in that store.
 *
 * Errors are caught per-group so one bad group doesn't block startup.
 *
 * Runs as Phase 3.4 in instrumentation.ts, between document mount point
 * scan (3.3) and background schedulers (3.5). Synchronous (awaited) so
 * the API is consistent before the first request lands — the cost is
 * one query per group plus, at most, one mount-point create per
 * never-touched legacy group.
 *
 * Also called inline from `POST /api/v1/groups` after `repos.groups.create`
 * so newly-created groups don't need a server restart to gain their store.
 *
 * @module startup/ensure-group-scenarios
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { SINGLE_USER_ID } from '@/lib/auth/single-user';
import { resolveScenarioLocation } from '@/lib/scenarios/location';
import { ensureGroupKnowledgeFolder } from '@/lib/mount-index/group-knowledge';

export async function ensureGroupScenariosForAllGroups(): Promise<{
  total: number;
  /** A store was found, adopted or created for an owner that recorded none. */
  provisioned: number;
  /** The recorded store pointer was stale and has been replaced. */
  healed: number;
  /** No store could be resolved, or a folder could not be created. */
  failed: number;
}> {
  const repos = getRepositories();
  let total = 0;
  let provisioned = 0;
  let healed = 0;
  let failed = 0;

  let groups;
  try {
    // Raw reads: the store overlay would throw/drop storeless groups, and
    // this hook only needs the row fields (id, name, officialMountPointId).
    groups = await repos.groups.findAllRaw();
  } catch (error) {
    logger.error('ensure-group-scenarios: failed to list groups', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { total: 0, provisioned: 0, healed: 0, failed: 1 };
  }

  total = groups.length;

  for (const group of groups) {
    try {
      // `ensure: true` finds, adopts or creates the official store and heals
      // the `Scenarios/` folder inside it; a folder failure throws, and is
      // counted as a failure below rather than reported as healthy.
      const location = await resolveScenarioLocation('group', group.id, repos, SINGLE_USER_ID, { ensure: true });
      if (!location) {
        failed++;
        continue;
      }
      if (!group.officialMountPointId) {
        provisioned++;
      } else if (group.officialMountPointId !== location.mountPointId) {
        healed++;
      }
      await ensureGroupKnowledgeFolder(location.mountPointId);
    } catch (error) {
      failed++;
      logger.warn('ensure-group-scenarios: failed for group; continuing', {
        groupId: group.id,
        groupName: group.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('ensure-group-scenarios: complete', { total, provisioned, healed, failed });
  return { total, provisioned, healed, failed };
}
