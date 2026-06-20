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
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import {
  ensureGroupScenariosFolder,
  ensureGroupKnowledgeFolder,
} from '@/lib/mount-index/group-scenarios';

export async function ensureGroupScenariosForAllGroups(): Promise<{
  total: number;
  healed: number;
  created: number;
  failed: number;
}> {
  const repos = getRepositories();
  let total = 0;
  let healed = 0;
  let created = 0;
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
    return { total: 0, healed: 0, created: 0, failed: 1 };
  }

  total = groups.length;

  for (const group of groups) {
    try {
      const result = await ensureGroupOfficialStore(group.id, group.name);
      if (!result) {
        failed++;
        continue;
      }
      if (result.created) {
        created++;
      } else if (group.officialMountPointId !== result.mountPointId) {
        healed++;
      }
      await ensureGroupScenariosFolder(result.mountPointId);
      await ensureGroupKnowledgeFolder(result.mountPointId);
    } catch (error) {
      failed++;
      logger.warn('ensure-group-scenarios: failed for group; continuing', {
        groupId: group.id,
        groupName: group.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('ensure-group-scenarios: complete', { total, healed, created, failed });
  return { total, healed, created, failed };
}
