/**
 * Mount-index DB schema-alignment helpers
 *
 * Migrations create the doc_mount_* tables with `CREATE TABLE IF NOT EXISTS`,
 * which is a no-op when the table already exists. Instances whose mount-index
 * DB was created before a column was introduced therefore never gain that
 * column, so any later INSERT/UPDATE that references it fails.
 *
 * `alignDocMountPointsSchema()` reads PRAGMA table_info and runs an idempotent
 * `ALTER TABLE ADD COLUMN` for every expected column that's missing and that
 * can be safely added (i.e. has a default or is nullable). NOT-NULL columns
 * without defaults are skipped because SQLite forbids adding them to a
 * non-empty table; those columns predate every drift case we know about.
 */

import type { Database as DatabaseType } from 'better-sqlite3';

interface AddableColumn {
  name: string;
  definition: string;
}

const DOC_MOUNT_POINTS_ADDABLE_COLUMNS: AddableColumn[] = [
  { name: 'basePath',         definition: `"basePath" TEXT NOT NULL DEFAULT ''` },
  { name: 'mountType',        definition: `"mountType" TEXT NOT NULL DEFAULT 'filesystem'` },
  { name: 'storeType',        definition: `"storeType" TEXT NOT NULL DEFAULT 'documents'` },
  { name: 'includePatterns',  definition: `"includePatterns" TEXT NOT NULL DEFAULT '[]'` },
  { name: 'excludePatterns',  definition: `"excludePatterns" TEXT NOT NULL DEFAULT '[]'` },
  { name: 'enabled',          definition: `"enabled" INTEGER NOT NULL DEFAULT 1` },
  { name: 'lastScannedAt',    definition: `"lastScannedAt" TEXT` },
  { name: 'scanStatus',       definition: `"scanStatus" TEXT NOT NULL DEFAULT 'idle'` },
  { name: 'lastScanError',    definition: `"lastScanError" TEXT` },
  { name: 'conversionStatus', definition: `"conversionStatus" TEXT NOT NULL DEFAULT 'idle'` },
  { name: 'conversionError',  definition: `"conversionError" TEXT` },
  { name: 'fileCount',        definition: `"fileCount" INTEGER NOT NULL DEFAULT 0` },
  { name: 'chunkCount',       definition: `"chunkCount" INTEGER NOT NULL DEFAULT 0` },
  { name: 'totalSizeBytes',   definition: `"totalSizeBytes" INTEGER NOT NULL DEFAULT 0` },
];

export function alignDocMountPointsSchema(db: DatabaseType): void {
  const tableRow = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'doc_mount_points'`
  ).get();
  if (!tableRow) return;

  const existing = db.prepare(`PRAGMA table_info("doc_mount_points")`).all() as Array<{ name: string }>;
  const existingNames = new Set(existing.map(c => c.name));

  for (const col of DOC_MOUNT_POINTS_ADDABLE_COLUMNS) {
    if (existingNames.has(col.name)) continue;
    db.exec(`ALTER TABLE "doc_mount_points" ADD COLUMN ${col.definition}`);
  }
}
