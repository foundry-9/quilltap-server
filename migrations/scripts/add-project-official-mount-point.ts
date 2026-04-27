/**
 * Migration: Add officialMountPointId to Projects + Backfill from Name Convention
 *
 * Replaces the runtime name-prefix heuristic (`Project Files: <name>`) with a
 * real foreign key on the project row pointing at its canonical document store.
 * After this migration, all read/write paths that need "the project's own
 * document store" use `project.officialMountPointId` directly, and the legacy
 * `pickPrimaryProjectStore` helper survives only as a startup-heal fallback.
 *
 * Steps:
 *   1. Add `officialMountPointId` TEXT NULL column to `projects` (idempotent).
 *   2. For every project that doesn't already have the FK populated:
 *        a. Open the mount-index DB.
 *        b. Find linked database-backed `documents` mount points for the project
 *           via `project_doc_mount_links`.
 *        c. Prefer one whose name starts with `Project Files: ` (matching
 *           `isProjectOwnStoreName`). Fall back to the first eligible
 *           database-backed documents store, mirroring `pickPrimaryProjectStore`.
 *        d. If a match is found, write its id into
 *           `projects.officialMountPointId`.
 *        e. Otherwise leave it null — the startup hook + project-creation hook
 *           introduced alongside this migration will create one on the next
 *           boot for projects that have no eligible store at all.
 *
 * Idempotent: rerunning is a no-op once every project either has the FK
 * populated or has no eligible store to backfill from.
 *
 * Migration ID: add-project-official-mount-point-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';
import { getMountIndexDatabasePath } from '../../lib/paths';
import { PROJECT_OWN_STORE_NAME_PREFIX } from '../../lib/mount-index/project-store-naming';

function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    return null;
  }
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

interface LinkedStoreRow {
  id: string;
  name: string;
  mountType: string;
  storeType: string;
}

function findOfficialStoreId(mountDb: DatabaseType, projectId: string): string | null {
  const rows = mountDb.prepare(
    `SELECT mp.id as id, mp.name as name, mp.mountType as mountType, mp.storeType as storeType
     FROM "project_doc_mount_links" link
     JOIN "doc_mount_points" mp ON mp.id = link.mountPointId
     WHERE link.projectId = ?
     ORDER BY link.createdAt ASC`
  ).all(projectId) as LinkedStoreRow[];

  const eligible = rows.filter(
    (r) => r.mountType === 'database' && (r.storeType ?? 'documents') === 'documents'
  );
  if (eligible.length === 0) return null;

  const preferred = eligible.find((r) =>
    typeof r.name === 'string' && r.name.startsWith(PROJECT_OWN_STORE_NAME_PREFIX)
  );
  return (preferred ?? eligible[0]).id;
}

export const addProjectOfficialMountPointMigration: Migration = {
  id: 'add-project-official-mount-point-v1',
  description:
    'Add officialMountPointId column to projects and backfill from existing `Project Files: <name>` document stores',
  introducedInVersion: '4.10.0',
  dependsOn: ['convert-project-files-to-document-stores-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('projects')) return false;

    const columns = getSQLiteTableColumns('projects');
    if (!columns.some((c) => c.name === 'officialMountPointId')) return true;

    // Column exists — only re-run if at least one project has a null FK and a
    // candidate store is reachable. Cheap pre-check: any null FK at all.
    const db = getSQLiteDatabase();
    const row = db.prepare(
      `SELECT COUNT(*) as n FROM "projects" WHERE officialMountPointId IS NULL`
    ).get() as { n: number };
    return row.n > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnAdded = false;
    let projectsBackfilled = 0;
    let projectsWithoutStore = 0;
    let mountDb: DatabaseType | null = null;

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('projects');

      if (!columns.some((c) => c.name === 'officialMountPointId')) {
        db.exec(`ALTER TABLE "projects" ADD COLUMN "officialMountPointId" TEXT DEFAULT NULL`);
        columnAdded = true;
        logger.info('Added officialMountPointId column to projects table', {
          context: 'migration.add-project-official-mount-point',
        });
      }

      const projects = db
        .prepare(`SELECT id, name FROM "projects" WHERE officialMountPointId IS NULL`)
        .all() as Array<{ id: string; name: string }>;

      if (projects.length === 0) {
        return {
          id: 'add-project-official-mount-point-v1',
          success: true,
          itemsAffected: columnAdded ? 1 : 0,
          message: columnAdded
            ? 'Added officialMountPointId column; no projects needed backfill'
            : 'All projects already have officialMountPointId populated',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      mountDb = openMountIndexDb();
      if (!mountDb) {
        logger.info('Mount-index DB not present; skipping backfill (column added only)', {
          context: 'migration.add-project-official-mount-point',
          projectsAwaitingBackfill: projects.length,
        });
        return {
          id: 'add-project-official-mount-point-v1',
          success: true,
          itemsAffected: columnAdded ? 1 : 0,
          message: 'Added officialMountPointId column; mount-index DB unavailable for backfill',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const updateStmt = db.prepare(
        `UPDATE "projects" SET officialMountPointId = ?, updatedAt = ? WHERE id = ?`
      );

      for (const project of projects) {
        const storeId = findOfficialStoreId(mountDb, project.id);
        if (storeId) {
          updateStmt.run(storeId, new Date().toISOString(), project.id);
          projectsBackfilled++;
          logger.debug('Backfilled officialMountPointId for project', {
            context: 'migration.add-project-official-mount-point',
            projectId: project.id,
            mountPointId: storeId,
          });
        } else {
          projectsWithoutStore++;
          logger.info('Project has no eligible document store; leaving officialMountPointId null', {
            context: 'migration.add-project-official-mount-point',
            projectId: project.id,
            projectName: project.name,
          });
        }
      }

      const message =
        `Added officialMountPointId column${columnAdded ? '' : ' (already present)'}; ` +
        `backfilled ${projectsBackfilled} project(s); ` +
        `${projectsWithoutStore} project(s) await startup-time creation`;

      logger.info('Migration add-project-official-mount-point completed', {
        context: 'migration.add-project-official-mount-point',
        columnAdded,
        projectsBackfilled,
        projectsWithoutStore,
      });

      return {
        id: 'add-project-official-mount-point-v1',
        success: true,
        itemsAffected: projectsBackfilled + (columnAdded ? 1 : 0),
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Migration add-project-official-mount-point failed', {
        context: 'migration.add-project-official-mount-point',
        error: errorMessage,
      });
      return {
        id: 'add-project-official-mount-point-v1',
        success: false,
        itemsAffected: projectsBackfilled,
        message: 'Failed to add officialMountPointId or backfill',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      if (mountDb) {
        try { mountDb.close(); } catch { /* ignore */ }
      }
    }
  },
};
