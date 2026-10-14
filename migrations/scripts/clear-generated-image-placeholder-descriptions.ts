/**
 * Migration: Clear the placeholder descriptions stamped onto generated images
 *
 * Two image jobs wrote a label into the column every reader treats as "what this
 * picture shows". The story-background job stored `Story background for: <scene or
 * chat title>` and the wardrobe-portrait job stored `<Name> — wardrobe portrait`, on
 * the `files` row and on the Scriptorium link beside it. `describe_image` served
 * whatever sat in that column before it would look at the generation prompt or spend
 * a vision call, so a character asking what a backdrop depicted was told its chat
 * title (bug 132).
 *
 * The jobs no longer write the label, and `describe_image` now prefers the prompt.
 * This clears the labels already on disk — `files.description` to NULL and
 * `doc_mount_file_links.description` to its `''` default — so those rows fall through
 * to the prompt on file, and to a real vision description where there is none. Only
 * `source = 'GENERATED'` files are touched on the main side; the link side has no
 * source column, so it matches on the two exact label shapes and an image MIME type.
 *
 * Migration ID: clear-generated-image-placeholder-descriptions-v1
 */

import type { Migration, MigrationResult } from '../types';
import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
  openMountIndexDbIfPresent,
} from '../lib/database-utils';

const MIGRATION_ID = 'clear-generated-image-placeholder-descriptions-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

/**
 * The two labels, verbatim from the writers that produced them
 * (`lib/background-jobs/handlers/story-background.ts`, `character-avatar.ts`,
 * before this fix). Kept as one predicate so the count and the update agree.
 */
const PLACEHOLDER_PREDICATE = `(
  "description" LIKE 'Story background for: %'
  OR "description" LIKE '% — wardrobe portrait'
)`;

const FILES_WHERE = `"source" = 'GENERATED' AND ${PLACEHOLDER_PREDICATE}`;
const LINKS_WHERE = `"originalMimeType" LIKE 'image/%' AND ${PLACEHOLDER_PREDICATE}`;

function countFilesPlaceholders(db: DatabaseType): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "files" WHERE ${FILES_WHERE}`).get() as { n: number };
  return row.n;
}

function linksTableUsable(db: DatabaseType): boolean {
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'doc_mount_file_links'`)
    .get();
  if (!exists) return false;
  const cols = (db.prepare(`PRAGMA table_info("doc_mount_file_links")`).all() as { name: string }[]).map(
    (c) => c.name
  );
  return cols.includes('description') && cols.includes('originalMimeType');
}

function countLinkPlaceholders(db: DatabaseType): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM "doc_mount_file_links" WHERE ${LINKS_WHERE}`)
    .get() as { n: number };
  return row.n;
}

export const clearGeneratedImagePlaceholderDescriptionsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Clear the "Story background for: …" / "… — wardrobe portrait" labels that generated images carried as descriptions, so describe_image reads the prompt or looks for itself',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('files')) return false;
    const cols = getSQLiteTableColumns('files').map((c) => c.name);
    if (!cols.includes('description') || !cols.includes('source')) return false;

    if (countFilesPlaceholders(getSQLiteDatabase()) > 0) return true;

    // The link side can carry a label the files side no longer does (a
    // re-imported file, a link written before the FileEntry). Check it too.
    let mountDb: DatabaseType | null = null;
    try {
      mountDb = openMountIndexDbIfPresent();
      if (!mountDb || !linksTableUsable(mountDb)) return false;
      return countLinkPlaceholders(mountDb) > 0;
    } catch (error) {
      logger.warn('Could not inspect mount-index links for placeholder descriptions', {
        context: LOG_CONTEXT,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      if (mountDb) {
        try { mountDb.close(); } catch { /* ignore */ }
      }
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let mountDb: DatabaseType | null = null;

    try {
      const db = getSQLiteDatabase();

      const filesToClear = countFilesPlaceholders(db);
      logger.debug('Scanning generated images for placeholder descriptions', {
        context: LOG_CONTEXT,
        files: filesToClear,
      });

      let filesCleared = 0;
      if (filesToClear > 0) {
        // One synchronous statement: the progress tick lands once the rows are
        // written, which is as fine-grained as a single UPDATE can report.
        const result = db
          .prepare(`UPDATE "files" SET "description" = NULL, "updatedAt" = ? WHERE ${FILES_WHERE}`)
          .run(new Date().toISOString());
        filesCleared = result.changes;
        reportProgress(filesCleared, filesToClear, 'images');
      }

      let linksCleared = 0;
      let linksSkipped = false;
      try {
        mountDb = openMountIndexDbIfPresent();
        if (mountDb && linksTableUsable(mountDb)) {
          const linksToClear = countLinkPlaceholders(mountDb);
          if (linksToClear > 0) {
            const result = mountDb
              .prepare(`UPDATE "doc_mount_file_links" SET "description" = '' WHERE ${LINKS_WHERE}`)
              .run();
            linksCleared = result.changes;
            reportProgress(linksCleared, linksToClear, 'links');
          }
        } else {
          linksSkipped = true;
        }
      } catch (error) {
        // A link that keeps its label is a stale caption on a search hit, not a
        // wrong answer from describe_image (which reads the FileEntry), so an
        // unreadable mount index degrades the sweep rather than failing it.
        linksSkipped = true;
        logger.warn('Could not clear placeholder descriptions on mount-index links', {
          context: LOG_CONTEXT,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      logger.info('Cleared placeholder descriptions from generated images', {
        context: LOG_CONTEXT,
        filesCleared,
        linksCleared,
        linksSkipped,
      });

      const total = filesCleared + linksCleared;
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: total,
        message:
          total > 0
            ? `Cleared placeholder descriptions from ${filesCleared} generated image${filesCleared === 1 ? '' : 's'} and ${linksCleared} Scriptorium link${linksCleared === 1 ? '' : 's'}${linksSkipped ? ' (mount index not inspected)' : ''}`
            : 'No generated image carries a placeholder description',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to clear placeholder descriptions from generated images', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to clear placeholder descriptions from generated images',
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
