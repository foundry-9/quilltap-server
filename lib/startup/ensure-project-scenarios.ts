/**
 * Startup-time idempotent reconciliation of project document stores and
 * Scenarios folders.
 *
 * For every project:
 *   1. Ensure `project.officialMountPointId` points at a real, eligible
 *      mount point — adopting an existing linked store via
 *      `pickPrimaryProjectStore` semantics, or creating a fresh
 *      `Project Files: <name>` store as a fallback.
 *   2. Ensure the `Scenarios/` folder exists in that store.
 *
 * Errors are caught per-project so one bad project doesn't block startup.
 *
 * Runs as Phase 3.4 in instrumentation.ts, between document mount point
 * scan (3.3) and background schedulers (3.5). Synchronous (awaited) so
 * the API is consistent before the first request lands — the cost is
 * one query per project plus, at most, one mount-point create per
 * never-touched legacy project.
 *
 * Also called inline from `POST /api/v1/projects` after `repos.projects.create`
 * so newly-created projects don't need a server restart to gain their store.
 *
 * @module startup/ensure-project-scenarios
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { SINGLE_USER_ID } from '@/lib/auth/single-user';
import { resolveScenarioLocation } from '@/lib/scenarios/location';

export async function ensureProjectScenariosForAllProjects(): Promise<{
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

  let projects;
  try {
    // Raw reads: the store overlay would throw/drop storeless projects, and
    // this hook only needs the row fields (id, name, officialMountPointId).
    projects = await repos.projects.findAllRaw();
  } catch (error) {
    logger.error('ensure-project-scenarios: failed to list projects', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { total: 0, provisioned: 0, healed: 0, failed: 1 };
  }

  total = projects.length;

  for (const project of projects) {
    try {
      // `ensure: true` finds, adopts or creates the official store and heals
      // the `Scenarios/` folder inside it; a folder failure throws, and is
      // counted as a failure below rather than reported as healthy.
      const location = await resolveScenarioLocation('project', project.id, repos, SINGLE_USER_ID, { ensure: true });
      if (!location) {
        failed++;
        continue;
      }
      if (!project.officialMountPointId) {
        provisioned++;
      } else if (project.officialMountPointId !== location.mountPointId) {
        healed++;
      }
    } catch (error) {
      failed++;
      logger.warn('ensure-project-scenarios: failed for project; continuing', {
        projectId: project.id,
        projectName: project.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('ensure-project-scenarios: complete', { total, provisioned, healed, failed });
  return { total, provisioned, healed, failed };
}
