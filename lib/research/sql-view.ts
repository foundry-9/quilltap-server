/**
 * The `qt_documents` view (research kit §5.8): one row per file in a store,
 * with its text, so `run_sql`'s fallback path needs no three-table join.
 *
 *   qt_documents(store, storeId, path, text, modifiedAt, fileId)
 *
 * It is a `TEMP VIEW`, made only on `run_sql`'s read-only mount-index
 * connection when that connection opens (before `query_only` is switched
 * on — the one moment a read-only connection accepts it). Nothing is stored:
 * no DDL in the database file, no migration, no export.
 *
 * @module lib/research/sql-view
 */

import type { Database as DatabaseType } from 'better-sqlite3'

export const QT_DOCUMENTS_VIEW = 'qt_documents'

export const QT_DOCUMENTS_VIEW_DDL = `CREATE TEMP VIEW IF NOT EXISTS ${QT_DOCUMENTS_VIEW} AS
SELECT mp.name AS store,
       l.mountPointId AS storeId,
       l.relativePath AS path,
       COALESCE(d.content, l.extractedText) AS text,
       l.lastModified AS modifiedAt,
       l.fileId AS fileId
  FROM main.doc_mount_file_links l
  JOIN main.doc_mount_points mp ON mp.id = l.mountPointId
  LEFT JOIN main.doc_mount_documents d ON d.fileId = l.fileId`

/** Make the view on a mount-index connection (a no-op where its tables are missing). */
export function createResearchDocumentsView(db: DatabaseType): void {
  const tables = db
    .prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name IN ('doc_mount_file_links', 'doc_mount_points', 'doc_mount_documents')`)
    .all() as Array<{ name: string }>
  if (tables.length < 3) return
  db.exec(QT_DOCUMENTS_VIEW_DDL)
}
