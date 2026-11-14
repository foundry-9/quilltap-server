/**
 * Boot step: re-point projects at the built-in roleplay templates' fixed ids.
 *
 * The migration `rekey-built-in-roleplay-templates-v1` gave each built-in a
 * fixed id and re-pointed everything in the main database. A project's
 * `defaultRoleplayTemplateId` lives in its store's `properties.json`, which
 * only the store-backed repository writes safely, so the migration left its
 * old → new map in `instance_settings` for this step. It updates each project
 * that names an old id through `repos.projects.update`, then clears the map.
 *
 * Idempotent: with no map present it returns at once. A project that fails to
 * update keeps the map in place, so the next boot tries again.
 *
 * @module startup/rekey-project-roleplay-template-pointers
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';

const logger = createServiceLogger('Startup:RekeyProjectRoleplayTemplates');

/** Written by the migration; must match `BUILT_IN_REKEYS_SETTING_KEY` there. */
const REKEYS_SETTING_KEY = 'builtInRoleplayTemplateRekeys';

export interface ProjectTemplateRekeyResult {
  scanned: number;
  updated: number;
  errors: number;
}

function readRekeys(): Record<string, string> | null {
  const db = getRawDatabase();
  if (!db) return null;
  try {
    const row = db
      .prepare(`SELECT "value" FROM "instance_settings" WHERE "key" = ?`)
      .get(REKEYS_SETTING_KEY) as { value: string } | undefined;
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : null;
  } catch (err) {
    logger.warn('Failed to read the built-in template re-key map; leaving it for the next boot', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function clearRekeys(): void {
  const db = getRawDatabase();
  if (!db) return;
  db.prepare(`DELETE FROM "instance_settings" WHERE "key" = ?`).run(REKEYS_SETTING_KEY);
}

export async function rekeyProjectRoleplayTemplatePointers(): Promise<ProjectTemplateRekeyResult> {
  const result: ProjectTemplateRekeyResult = { scanned: 0, updated: 0, errors: 0 };
  const rekeys = readRekeys();
  if (!rekeys) return result;

  const repos = getRepositories();
  const projects = await repos.projects.findAll();
  result.scanned = projects.length;
  logger.debug('Re-pointing projects at the built-in roleplay templates\' fixed ids', {
    projects: projects.length,
    rekeys: Object.keys(rekeys).length,
  });

  for (const project of projects) {
    const current = project.defaultRoleplayTemplateId;
    if (!current || !rekeys[current]) continue;
    try {
      await repos.projects.update(project.id, { defaultRoleplayTemplateId: rekeys[current] });
      result.updated++;
    } catch (err) {
      result.errors++;
      logger.warn('Failed to re-point a project at a built-in roleplay template', {
        projectId: project.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.errors === 0) clearRekeys();
  logger.info('Project roleplay template pointers re-keyed', { ...result });
  return result;
}
