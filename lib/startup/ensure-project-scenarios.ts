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
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import { ensureProjectScenariosFolder } from '@/lib/mount-index/project-scenarios';

export async function ensureProjectScenariosForAllProjects(): Promise<{
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

  let projects;
  try {
    projects = await repos.projects.findAll();
  } catch (error) {
    logger.error('ensure-project-scenarios: failed to list projects', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { total: 0, healed: 0, created: 0, failed: 1 };
  }

  total = projects.length;

  for (const project of projects) {
    try {
      const result = await ensureProjectOfficialStore(project.id, project.name);
      if (!result) {
        failed++;
        continue;
      }
      if (result.created) {
        created++;
      } else if (project.officialMountPointId !== result.mountPointId) {
        healed++;
      }
      await ensureProjectScenariosFolder(result.mountPointId);
    } catch (error) {
      failed++;
      logger.warn('ensure-project-scenarios: failed for project; continuing', {
        projectId: project.id,
        projectName: project.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('ensure-project-scenarios: complete', { total, healed, created, failed });
  return { total, healed, created, failed };
}
