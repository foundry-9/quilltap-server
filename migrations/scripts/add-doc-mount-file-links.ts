/**
 * Migration: Split doc_mount_files into content + link rows
 *
 * Pre-refactor, every doc_mount_files row carried both content fingerprint
 * (sha256, fileSizeBytes, fileType, source) and link-level metadata
 * (mountPointId, relativePath, fileName, folderId, conversionStatus,
 * conversionError, plainTextLength, chunkCount, lastModified). That coupling
 * meant a single underlying file could only live at one (mountPointId,
 * relativePath); duplicating bytes was the only way to surface them
 * elsewhere.
 *
 * This migration introduces doc_mount_file_links — the join — and recasts
 * doc_mount_files as a content row. Existing rows split 1:1 (every file
 * becomes one content + one link); future writes dedup by sha256.
 * Per-link state (display name, folder, conversion + extraction lifecycle,
 * extracted text from doc_mount_blobs) moves to the link row so two
 * consumers can hold differing views of the same bytes. Chunks rekey from
 * fileId to linkId for the same reason — each link owns its own chunks
 * and embeddings.
 *
 * After this migration:
 *   - doc_mount_files: id, sha256, fileSizeBytes, fileType, source, ts (PK id, INDEX sha256)
 *   - doc_mount_file_links (NEW): id, fileId, mountPointId, relativePath, fileName, folderId,
 *       per-link blob metadata, conversion lifecycle, extraction lifecycle, chunkCount, lastModified, ts
 *   - doc_mount_documents: id, fileId UNIQUE, content, contentSha256, plainTextLength, ts
 *   - doc_mount_blobs: id, fileId UNIQUE, sha256, sizeBytes, storedMimeType, data, ts
 *   - doc_mount_chunks: id, linkId (was fileId), mountPointId, chunkIndex, content, tokenCount,
 *       headingContext, embedding, ts
 *
 * No dedup at migration time — existing duplicate sha rows stay as distinct
 * file rows (each with one link). The sha256 INDEX is not UNIQUE for the
 * same reason. Application-level findOrCreateByContent dedups going
 * forward.
 *
 * Migration ID: add-doc-mount-file-links-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { getMountIndexDatabasePath } from '../../lib/paths';

const MIGRATION_ID = 'add-doc-mount-file-links-v1';

function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath();
  if (!fs.existsSync(path.dirname(dbPath))) return null;
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    // Foreign keys stay OFF during the migration. We rebuild three tables
    // back-to-back and need to drop/rename without FK refusal mid-flight.
    db.pragma('foreign_keys = OFF');
    return db;
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

function tableExists(db: DatabaseType, name: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(name) as { name: string } | undefined;
  return row !== undefined;
}

function hasColumn(db: DatabaseType, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

interface OldFileRow {
  id: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  fileType: string;
  sha256: string;
  fileSizeBytes: number;
  lastModified: string;
  source: string | null;
  folderId: string | null;
  conversionStatus: string;
  conversionError: string | null;
  plainTextLength: number | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

interface OldBlobRow {
  id: string;
  mountPointId: string;
  relativePath: string;
  originalFileName: string | null;
  originalMimeType: string | null;
  description: string | null;
  descriptionUpdatedAt: string | null;
  extractedText: string | null;
  extractedTextSha256: string | null;
  extractionStatus: string | null;
  extractionError: string | null;
}

export const addDocMountFileLinksMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Split doc_mount_files into content + link rows so a single file can be hard-linked from multiple mount points; rekey doc_mount_chunks to linkId and make doc_mount_documents / doc_mount_blobs content-addressable',
  introducedInVersion: '4.5.0',
  dependsOn: [],

  async shouldRun(): Promise<boolean> {
    const dbPath = getMountIndexDatabasePath();
    if (!fs.existsSync(dbPath)) return false;
    const db = openMountIndexDb();
    if (!db) return false;
    try {
      if (!tableExists(db, 'doc_mount_files')) return false;
      // Pre-refactor schema carries mountPointId on doc_mount_files; post-
      // refactor schema does not. We only need to run if the old column is
      // still there. Likewise we re-run if the chunks table still keys by
      // fileId (a partially completed migration).
      const filesHasMountPointId = hasColumn(db, 'doc_mount_files', 'mountPointId');
      const chunksHasFileId = tableExists(db, 'doc_mount_chunks')
        && hasColumn(db, 'doc_mount_chunks', 'fileId');
      return filesHasMountPointId || chunksHasFileId;
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = openMountIndexDb();
    if (!db) {
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 0,
        message: 'No mount-index database present; nothing to migrate',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    let linksCreated = 0;
    let chunksRekeyed = 0;
    let documentsRekeyed = 0;
    let blobsRekeyed = 0;

    try {
      // ============================================================================
      // Step 1: Create doc_mount_file_links (link/join table) if absent
      // ============================================================================
      db.exec(`
        CREATE TABLE IF NOT EXISTS "doc_mount_file_links" (
          "id" TEXT PRIMARY KEY,
          "fileId" TEXT NOT NULL,
          "mountPointId" TEXT NOT NULL,
          "relativePath" TEXT NOT NULL,
          "fileName" TEXT NOT NULL,
          "folderId" TEXT,
          "originalFileName" TEXT,
          "originalMimeType" TEXT,
          "description" TEXT NOT NULL DEFAULT '',
          "descriptionUpdatedAt" TEXT,
          "conversionStatus" TEXT NOT NULL DEFAULT 'pending',
          "conversionError" TEXT,
          "plainTextLength" INTEGER,
          "extractedText" TEXT,
          "extractedTextSha256" TEXT,
          "extractionStatus" TEXT NOT NULL DEFAULT 'none',
          "extractionError" TEXT,
          "chunkCount" INTEGER NOT NULL DEFAULT 0,
          "lastModified" TEXT NOT NULL,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          FOREIGN KEY ("fileId") REFERENCES "doc_mount_files" ("id") ON DELETE CASCADE,
          FOREIGN KEY ("mountPointId") REFERENCES "doc_mount_points" ("id") ON DELETE CASCADE
        )
      `);
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_file_links_mp_path" ` +
        `ON "doc_mount_file_links" ("mountPointId", "relativePath")`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_doc_mount_file_links_fileId" ` +
        `ON "doc_mount_file_links" ("fileId")`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_doc_mount_file_links_mountPointId" ` +
        `ON "doc_mount_file_links" ("mountPointId")`
      );

      // ============================================================================
      // Step 2: Populate links from existing doc_mount_files (joining blobs)
      // ============================================================================
      const filesHasMountPointId = hasColumn(db, 'doc_mount_files', 'mountPointId');

      if (filesHasMountPointId) {
        const totalRow = db.prepare('SELECT COUNT(*) AS n FROM "doc_mount_files"').get() as { n: number };
        const totalFiles = totalRow?.n ?? 0;

        // Stream files in batches. We need to also map oldFileId → newLinkId
        // for the chunk rekey step, so collect that map as we go.
        const fileIdToLinkId = new Map<string, string>();

        // Detect which optional blob columns exist (in-repo migrations may
        // have added some/all of these in pre-existing instances).
        const blobHasExtracted = tableExists(db, 'doc_mount_blobs')
          && hasColumn(db, 'doc_mount_blobs', 'extractedText');

        const findBlobStmt = tableExists(db, 'doc_mount_blobs')
          ? db.prepare(
              blobHasExtracted
                ? `SELECT id, mountPointId, relativePath, originalFileName, originalMimeType,
                          description, descriptionUpdatedAt,
                          extractedText, extractedTextSha256, extractionStatus, extractionError
                   FROM "doc_mount_blobs" WHERE mountPointId = ? AND relativePath = ?`
                : `SELECT id, mountPointId, relativePath, originalFileName, originalMimeType,
                          description, descriptionUpdatedAt
                   FROM "doc_mount_blobs" WHERE mountPointId = ? AND relativePath = ?`
            )
          : null;

        const insertLinkStmt = db.prepare(
          `INSERT INTO "doc_mount_file_links" (
            id, fileId, mountPointId, relativePath, fileName, folderId,
            originalFileName, originalMimeType,
            description, descriptionUpdatedAt,
            conversionStatus, conversionError, plainTextLength,
            extractedText, extractedTextSha256, extractionStatus, extractionError,
            chunkCount, lastModified, createdAt, updatedAt
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?
          )`
        );

        // Materialise all file rows up front rather than iterating a live
        // cursor. better-sqlite3 forbids running another query (the blob
        // lookup, the link insert) while a cursor is mid-iteration on the
        // same connection — "This database connection is busy executing a
        // query." For multi-thousand-row migrations the memory cost of an
        // array is acceptable.
        const allFiles = db.prepare(
          `SELECT id, mountPointId, relativePath, fileName, fileType, sha256,
                  fileSizeBytes, lastModified, source, folderId,
                  conversionStatus, conversionError, plainTextLength, chunkCount,
                  createdAt, updatedAt
           FROM "doc_mount_files"`
        ).all() as OldFileRow[];

        const tx = db.transaction(() => {
          let i = 0;
          for (const row of allFiles) {
            const linkId = randomUUID();

            let blob: OldBlobRow | undefined;
            if (findBlobStmt && row.fileType === 'blob') {
              blob = findBlobStmt.get(row.mountPointId, row.relativePath) as OldBlobRow | undefined;
            }

            insertLinkStmt.run(
              linkId,
              row.id,
              row.mountPointId,
              row.relativePath,
              row.fileName,
              row.folderId,
              blob?.originalFileName ?? null,
              blob?.originalMimeType ?? null,
              blob?.description ?? '',
              blob?.descriptionUpdatedAt ?? null,
              row.conversionStatus,
              row.conversionError,
              row.plainTextLength,
              blob?.extractedText ?? null,
              blob?.extractedTextSha256 ?? null,
              blob?.extractionStatus ?? 'none',
              blob?.extractionError ?? null,
              row.chunkCount,
              row.lastModified,
              row.createdAt,
              row.updatedAt
            );

            fileIdToLinkId.set(row.id, linkId);
            linksCreated += 1;
            i += 1;
            if (i % 100 === 0) {
              reportProgress(i, totalFiles, 'files');
            }
          }
          reportProgress(totalFiles, totalFiles, 'files');
        });
        tx();

        // ============================================================================
        // Step 3: Rebuild doc_mount_chunks with linkId instead of fileId
        // ============================================================================
        if (tableExists(db, 'doc_mount_chunks') && hasColumn(db, 'doc_mount_chunks', 'fileId')) {
          db.exec(`
            CREATE TABLE "doc_mount_chunks_new" (
              "id" TEXT PRIMARY KEY,
              "linkId" TEXT NOT NULL,
              "mountPointId" TEXT NOT NULL,
              "chunkIndex" INTEGER NOT NULL,
              "content" TEXT NOT NULL,
              "tokenCount" INTEGER NOT NULL,
              "headingContext" TEXT,
              "embedding" BLOB,
              "createdAt" TEXT NOT NULL,
              "updatedAt" TEXT NOT NULL,
              FOREIGN KEY ("linkId") REFERENCES "doc_mount_file_links" ("id") ON DELETE CASCADE
            )
          `);

          // Insert by joining each chunk to its file's new link row.
          // (file_id, link_id) is 1:1 at migration time so this is safe.
          const chunksRes = db.prepare(
            `INSERT INTO "doc_mount_chunks_new" (
              id, linkId, mountPointId, chunkIndex, content, tokenCount,
              headingContext, embedding, createdAt, updatedAt
            )
            SELECT c.id, l.id, c.mountPointId, c.chunkIndex, c.content, c.tokenCount,
                   c.headingContext, c.embedding, c.createdAt, c.updatedAt
            FROM "doc_mount_chunks" c
            JOIN "doc_mount_file_links" l ON l.fileId = c.fileId`
          ).run();
          chunksRekeyed = chunksRes.changes;

          db.exec(`DROP TABLE "doc_mount_chunks"`);
          db.exec(`ALTER TABLE "doc_mount_chunks_new" RENAME TO "doc_mount_chunks"`);
          db.exec(
            `CREATE INDEX IF NOT EXISTS "idx_doc_mount_chunks_linkId" ` +
            `ON "doc_mount_chunks" ("linkId")`
          );
          db.exec(
            `CREATE INDEX IF NOT EXISTS "idx_doc_mount_chunks_mp" ` +
            `ON "doc_mount_chunks" ("mountPointId")`
          );
        }

        // ============================================================================
        // Step 4: Rebuild doc_mount_documents content-addressable (drop mountPointId etc.)
        // ============================================================================
        if (tableExists(db, 'doc_mount_documents') && hasColumn(db, 'doc_mount_documents', 'mountPointId')) {
          db.exec(`
            CREATE TABLE "doc_mount_documents_new" (
              "id" TEXT PRIMARY KEY,
              "fileId" TEXT NOT NULL,
              "content" TEXT NOT NULL,
              "contentSha256" TEXT NOT NULL,
              "plainTextLength" INTEGER NOT NULL,
              "createdAt" TEXT NOT NULL,
              "updatedAt" TEXT NOT NULL,
              FOREIGN KEY ("fileId") REFERENCES "doc_mount_files" ("id") ON DELETE CASCADE
            )
          `);
          const docRes = db.prepare(
            `INSERT INTO "doc_mount_documents_new" (
              id, fileId, content, contentSha256, plainTextLength, createdAt, updatedAt
            )
            SELECT d.id, f.id, d.content, d.contentSha256, d.plainTextLength, d.createdAt, d.updatedAt
            FROM "doc_mount_documents" d
            JOIN "doc_mount_files" f
              ON f.mountPointId = d.mountPointId
             AND LOWER(f.relativePath) = LOWER(d.relativePath)`
          ).run();
          documentsRekeyed = docRes.changes;

          db.exec(`DROP TABLE "doc_mount_documents"`);
          db.exec(`ALTER TABLE "doc_mount_documents_new" RENAME TO "doc_mount_documents"`);
          db.exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_documents_fileId" ` +
            `ON "doc_mount_documents" ("fileId")`
          );
        }

        // ============================================================================
        // Step 5: Rebuild doc_mount_blobs content-addressable (drop link-level columns)
        // ============================================================================
        if (tableExists(db, 'doc_mount_blobs') && hasColumn(db, 'doc_mount_blobs', 'mountPointId')) {
          db.exec(`
            CREATE TABLE "doc_mount_blobs_new" (
              "id" TEXT PRIMARY KEY,
              "fileId" TEXT NOT NULL,
              "sha256" TEXT NOT NULL,
              "sizeBytes" INTEGER NOT NULL,
              "storedMimeType" TEXT NOT NULL,
              "data" BLOB NOT NULL,
              "createdAt" TEXT NOT NULL,
              "updatedAt" TEXT NOT NULL,
              FOREIGN KEY ("fileId") REFERENCES "doc_mount_files" ("id") ON DELETE CASCADE
            )
          `);
          const blobRes = db.prepare(
            `INSERT INTO "doc_mount_blobs_new" (
              id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt
            )
            SELECT b.id, f.id, b.sha256, b.sizeBytes, b.storedMimeType, b.data, b.createdAt, b.updatedAt
            FROM "doc_mount_blobs" b
            JOIN "doc_mount_files" f
              ON f.mountPointId = b.mountPointId
             AND LOWER(f.relativePath) = LOWER(b.relativePath)`
          ).run();
          blobsRekeyed = blobRes.changes;

          db.exec(`DROP TABLE "doc_mount_blobs"`);
          db.exec(`ALTER TABLE "doc_mount_blobs_new" RENAME TO "doc_mount_blobs"`);
          db.exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_blobs_fileId" ` +
            `ON "doc_mount_blobs" ("fileId")`
          );
        }

        // ============================================================================
        // Step 6: Rebuild doc_mount_files with content-only columns
        // ============================================================================
        db.exec(`
          CREATE TABLE "doc_mount_files_new" (
            "id" TEXT PRIMARY KEY,
            "sha256" TEXT NOT NULL,
            "fileSizeBytes" INTEGER NOT NULL,
            "fileType" TEXT NOT NULL,
            "source" TEXT NOT NULL DEFAULT 'filesystem',
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL
          )
        `);
        db.exec(
          `INSERT INTO "doc_mount_files_new" (id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt)
           SELECT id, sha256, fileSizeBytes, fileType,
                  COALESCE(source, 'filesystem'),
                  createdAt, updatedAt
           FROM "doc_mount_files"`
        );
        db.exec(`DROP TABLE "doc_mount_files"`);
        db.exec(`ALTER TABLE "doc_mount_files_new" RENAME TO "doc_mount_files"`);
        db.exec(
          `CREATE INDEX IF NOT EXISTS "idx_doc_mount_files_sha256" ` +
          `ON "doc_mount_files" ("sha256")`
        );
      } else if (tableExists(db, 'doc_mount_chunks') && hasColumn(db, 'doc_mount_chunks', 'fileId')) {
        // Files table already migrated, but chunks were left half-done by an
        // earlier interrupted run. This branch finishes that work.
        const linkByFile = db.prepare(
          'SELECT fileId, id AS linkId FROM "doc_mount_file_links"'
        ).all() as Array<{ fileId: string; linkId: string }>;
        if (linkByFile.length > 0) {
          db.exec(`
            CREATE TABLE "doc_mount_chunks_new" (
              "id" TEXT PRIMARY KEY,
              "linkId" TEXT NOT NULL,
              "mountPointId" TEXT NOT NULL,
              "chunkIndex" INTEGER NOT NULL,
              "content" TEXT NOT NULL,
              "tokenCount" INTEGER NOT NULL,
              "headingContext" TEXT,
              "embedding" BLOB,
              "createdAt" TEXT NOT NULL,
              "updatedAt" TEXT NOT NULL,
              FOREIGN KEY ("linkId") REFERENCES "doc_mount_file_links" ("id") ON DELETE CASCADE
            )
          `);
          const chunksRes = db.prepare(
            `INSERT INTO "doc_mount_chunks_new" (
              id, linkId, mountPointId, chunkIndex, content, tokenCount,
              headingContext, embedding, createdAt, updatedAt
            )
            SELECT c.id, l.id, c.mountPointId, c.chunkIndex, c.content, c.tokenCount,
                   c.headingContext, c.embedding, c.createdAt, c.updatedAt
            FROM "doc_mount_chunks" c
            JOIN "doc_mount_file_links" l ON l.fileId = c.fileId`
          ).run();
          chunksRekeyed = chunksRes.changes;

          db.exec(`DROP TABLE "doc_mount_chunks"`);
          db.exec(`ALTER TABLE "doc_mount_chunks_new" RENAME TO "doc_mount_chunks"`);
          db.exec(
            `CREATE INDEX IF NOT EXISTS "idx_doc_mount_chunks_linkId" ` +
            `ON "doc_mount_chunks" ("linkId")`
          );
          db.exec(
            `CREATE INDEX IF NOT EXISTS "idx_doc_mount_chunks_mp" ` +
            `ON "doc_mount_chunks" ("mountPointId")`
          );
        }
      }

      const message =
        `Created ${linksCreated} link row(s); ` +
        `rekeyed ${chunksRekeyed} chunk(s), ${documentsRekeyed} document(s), ${blobsRekeyed} blob(s)`;
      logger.info(message, {
        context: `migration.${MIGRATION_ID}`,
        linksCreated,
        chunksRekeyed,
        documentsRekeyed,
        blobsRekeyed,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: linksCreated + chunksRekeyed + documentsRekeyed + blobsRekeyed,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('add-doc-mount-file-links migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: linksCreated,
        message: 'add-doc-mount-file-links migration aborted',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  },
};
