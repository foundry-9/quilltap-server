/**
 * Migration: Convert Project File Storage to Per-Project Document Stores
 *
 * Stage 1 of consolidating all project file storage onto the Scriptorium
 * document-store pipeline. For every project that still has an on-disk
 * `<files>/{projectId}/...` directory, this migration:
 *
 *   1. Creates a database-backed DocMountPoint named `Project Files: <name>`
 *      in the mount-index DB (storeType='documents', mountType='database').
 *   2. Walks the project directory and imports every file:
 *        - Text (.md/.markdown/.txt/.json/.jsonl/.ndjson)
 *            → doc_mount_documents + doc_mount_files mirror (source='database')
 *        - PDF/DOCX → doc_mount_blobs with extracted text + doc_mount_files
 *            mirror (fileType='pdf'/'docx', source='database')
 *        - Everything else (images, arbitrary binaries)
 *            → doc_mount_blobs (no extracted text) + doc_mount_files mirror
 *            (fileType='blob', conversionStatus='skipped')
 *      Folder hierarchy is mirrored into doc_mount_folders so the Scriptorium
 *      tree view renders the same shape the user had on disk.
 *   3. Links the project to the new mount point via project_doc_mount_links.
 *   4. Renames the original `<files>/{projectId}` directory to
 *      `<files>/{projectId}_doc_store_archive` as a safety net.
 *
 * Chunking and embedding are deferred: once the migration finishes, the user
 * (or an automated rescan) can hit "scan" on the new mount point to chunk and
 * embed text documents and extract text from any PDFs/DOCX that failed here.
 *
 * Legacy FileEntry and Folder rows in the main DB are deliberately left in
 * place in this stage; Stage 2 will rewire the file APIs and clean them up.
 *
 * Idempotent per-project: a project is considered migrated when its
 * `_doc_store_archive` sibling directory already exists, so re-running the
 * migration is a no-op for projects already handled.
 *
 * Migration ID: convert-project-files-to-document-stores-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { alignDocMountPointsSchema } from '../lib/mount-index-schema';
import { getFilesDir, getMountIndexDatabasePath } from '../../lib/paths';
import { convertBufferToPlainText } from '../../lib/mount-index/converters';
import { PROJECT_OWN_STORE_NAME_PREFIX } from '../../lib/mount-index/project-store-naming';

// ============================================================================
// DDL — matches the Zod schemas in lib/schemas/mount-index.types.ts and the
// hand-written DDL in lib/database/repositories/doc-mount-blobs.repository.ts.
// CREATE TABLE IF NOT EXISTS means coexistence with later repo-driven DDL is
// safe: whichever runs first wins, both produce the same shape.
// ============================================================================

const TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "doc_mount_points" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "basePath" TEXT NOT NULL DEFAULT '',
    "mountType" TEXT NOT NULL DEFAULT 'filesystem',
    "storeType" TEXT NOT NULL DEFAULT 'documents',
    "includePatterns" TEXT NOT NULL DEFAULT '[]',
    "excludePatterns" TEXT NOT NULL DEFAULT '[]',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "lastScannedAt" TEXT,
    "scanStatus" TEXT NOT NULL DEFAULT 'idle',
    "lastScanError" TEXT,
    "conversionStatus" TEXT NOT NULL DEFAULT 'idle',
    "conversionError" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "totalSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "doc_mount_folders" (
    "id" TEXT PRIMARY KEY,
    "mountPointId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_folders_mp_path" ON "doc_mount_folders" ("mountPointId", "path")`,
  `CREATE INDEX IF NOT EXISTS "idx_doc_mount_folders_mp" ON "doc_mount_folders" ("mountPointId")`,

  `CREATE TABLE IF NOT EXISTS "doc_mount_files" (
    "id" TEXT PRIMARY KEY,
    "mountPointId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "lastModified" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'filesystem',
    "folderId" TEXT,
    "conversionStatus" TEXT NOT NULL DEFAULT 'pending',
    "conversionError" TEXT,
    "plainTextLength" INTEGER,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_files_mp_path" ON "doc_mount_files" ("mountPointId", "relativePath")`,
  `CREATE INDEX IF NOT EXISTS "idx_doc_mount_files_mp" ON "doc_mount_files" ("mountPointId")`,

  `CREATE TABLE IF NOT EXISTS "doc_mount_documents" (
    "id" TEXT PRIMARY KEY,
    "mountPointId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "plainTextLength" INTEGER NOT NULL,
    "folderId" TEXT,
    "lastModified" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_documents_mp_path" ON "doc_mount_documents" ("mountPointId", "relativePath")`,
  `CREATE INDEX IF NOT EXISTS "idx_doc_mount_documents_mp" ON "doc_mount_documents" ("mountPointId")`,

  `CREATE TABLE IF NOT EXISTS "doc_mount_blobs" (
    "id" TEXT PRIMARY KEY,
    "mountPointId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "originalMimeType" TEXT NOT NULL,
    "storedMimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "descriptionUpdatedAt" TEXT,
    "extractedText" TEXT,
    "extractedTextSha256" TEXT,
    "extractionStatus" TEXT NOT NULL DEFAULT 'none',
    "extractionError" TEXT,
    "data" BLOB NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_blobs_mp_path" ON "doc_mount_blobs" ("mountPointId", "relativePath")`,
  `CREATE INDEX IF NOT EXISTS "idx_doc_mount_blobs_mp" ON "doc_mount_blobs" ("mountPointId")`,

  `CREATE TABLE IF NOT EXISTS "project_doc_mount_links" (
    "id" TEXT PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "mountPointId" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_doc_mount_links_proj_mp" ON "project_doc_mount_links" ("projectId", "mountPointId")`,
];

// Files we never want to import into the document store, even if they linger
// in the project directory.
const EXCLUDE_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.meta.json']);
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash']);

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.jsonl', '.ndjson']);

// ============================================================================
// Helpers
// ============================================================================

function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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

function ensureMountIndexTables(db: DatabaseType): void {
  for (const sql of TABLE_DDL) {
    db.exec(sql);
  }
  // Bring older mount-index DBs in line with the current shape — CREATE TABLE
  // IF NOT EXISTS is a no-op when the table already exists, so columns added
  // after the original schema (e.g. storeType) must be backfilled here.
  alignDocMountPointsSchema(db);
}

function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256String(str: string): string {
  return createHash('sha256').update(str, 'utf-8').digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

type TextFileType = 'markdown' | 'txt' | 'json' | 'jsonl';
type BlobFileType = 'pdf' | 'docx' | 'blob';

function classifyExtension(ext: string): { kind: 'text'; type: TextFileType } | { kind: 'blob'; type: BlobFileType } {
  const e = ext.toLowerCase();
  switch (e) {
    case '.md':
    case '.markdown':
      return { kind: 'text', type: 'markdown' };
    case '.txt':
      return { kind: 'text', type: 'txt' };
    case '.json':
      return { kind: 'text', type: 'json' };
    case '.jsonl':
    case '.ndjson':
      return { kind: 'text', type: 'jsonl' };
    case '.pdf':
      return { kind: 'blob', type: 'pdf' };
    case '.docx':
      return { kind: 'blob', type: 'docx' };
    default:
      return { kind: 'blob', type: 'blob' };
  }
}

function guessMimeType(ext: string): string {
  const e = ext.toLowerCase();
  switch (e) {
    case '.pdf': return 'application/pdf';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.heic': case '.heif': return 'image/heic';
    case '.tiff': case '.tif': return 'image/tiff';
    case '.avif': return 'image/avif';
    case '.mp3': return 'audio/mpeg';
    case '.mp4': return 'video/mp4';
    case '.wav': return 'audio/wav';
    case '.zip': return 'application/zip';
    default: return 'application/octet-stream';
  }
}

interface WalkedFile {
  relativePath: string;   // POSIX, no leading slash
  absolutePath: string;
}

async function walkProjectDirectory(rootDir: string): Promise<WalkedFile[]> {
  const results: WalkedFile[] = [];
  async function recurse(currentDir: string, relativeBase: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      logger.warn('Unable to read directory during project migration walk', {
        context: 'migration.convert-project-files-to-document-stores',
        path: currentDir,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const name = entry.name;
      const relPath = relativeBase ? `${relativeBase}/${toPosix(name)}` : toPosix(name);
      const absPath = path.join(currentDir, name);
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(name)) continue;
        await recurse(absPath, relPath);
      } else if (entry.isFile()) {
        if (EXCLUDE_NAMES.has(name)) continue;
        results.push({ relativePath: relPath, absolutePath: absPath });
      }
    }
  }
  await recurse(rootDir, '');
  return results;
}

/**
 * Idempotently create all missing folder segments along the given POSIX path
 * for one mount point. Returns the leaf folder id, or null if folderPath is
 * empty/root. Mirrors ensureFolderPath() in lib/mount-index/folder-paths.ts.
 */
function ensureFolderPath(
  db: DatabaseType,
  mountPointId: string,
  folderPath: string
): string | null {
  const normalized = folderPath.replace(/^\/+|\/+$/g, '');
  if (!normalized) return null;

  const segments = normalized.split('/').filter(Boolean);
  let currentParentId: string | null = null;
  let currentPath = '';

  const findStmt = db.prepare(
    `SELECT id FROM "doc_mount_folders" WHERE mountPointId = ? AND path = ?`
  );
  const insertStmt = db.prepare(
    `INSERT INTO "doc_mount_folders" (id, mountPointId, parentId, name, path, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = findStmt.get(mountPointId, currentPath) as { id: string } | undefined;
    if (existing) {
      currentParentId = existing.id;
      continue;
    }
    const id = randomUUID();
    const now = nowIso();
    insertStmt.run(id, mountPointId, currentParentId, segment, currentPath, now, now);
    currentParentId = id;
  }

  return currentParentId;
}

interface ProjectRow {
  id: string;
  name: string;
}

interface ImportCounts {
  textDocuments: number;
  blobsWithText: number;
  blobsWithoutText: number;
  errors: number;
}

async function importProjectDirectory(
  mountDb: DatabaseType,
  projectId: string,
  mountPointId: string,
  projectDir: string,
  outerTier?: { current: number; total: number; unit: string }
): Promise<ImportCounts> {
  const counts: ImportCounts = {
    textDocuments: 0,
    blobsWithText: 0,
    blobsWithoutText: 0,
    errors: 0,
  };

  const files = await walkProjectDirectory(projectDir);
  let fileIndex = 0;

  const insertDocument = mountDb.prepare(
    `INSERT INTO "doc_mount_documents"
     (id, mountPointId, relativePath, fileName, fileType, content, contentSha256,
      plainTextLength, folderId, lastModified, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertFile = mountDb.prepare(
    `INSERT INTO "doc_mount_files"
     (id, mountPointId, relativePath, fileName, fileType, sha256, fileSizeBytes,
      lastModified, source, folderId, conversionStatus, conversionError,
      plainTextLength, chunkCount, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'database', ?, ?, ?, ?, 0, ?, ?)`
  );
  const insertBlob = mountDb.prepare(
    `INSERT INTO "doc_mount_blobs"
     (id, mountPointId, relativePath, originalFileName, originalMimeType, storedMimeType,
      sizeBytes, sha256, description, descriptionUpdatedAt,
      extractedText, extractedTextSha256, extractionStatus, extractionError,
      data, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const file of files) {
    fileIndex++;
    if (outerTier) {
      reportProgress([
        outerTier,
        { current: fileIndex, total: files.length, unit: 'files' },
      ]);
    } else {
      reportProgress(fileIndex, files.length, 'files');
    }
    try {
      const bytes = await fsPromises.readFile(file.absolutePath);
      const ext = path.extname(file.relativePath);
      const fileName = path.basename(file.relativePath);
      const folderDir = path.posix.dirname(file.relativePath);
      const folderId =
        folderDir && folderDir !== '.' ? ensureFolderPath(mountDb, mountPointId, folderDir) : null;
      const stat = await fsPromises.stat(file.absolutePath);
      const lastModified = stat.mtime.toISOString();
      const now = nowIso();
      const classification = classifyExtension(ext);

      if (classification.kind === 'text') {
        const content = bytes.toString('utf-8');
        const sha = sha256String(content);
        insertDocument.run(
          randomUUID(),
          mountPointId,
          file.relativePath,
          fileName,
          classification.type,
          content,
          sha,
          content.length,
          folderId,
          lastModified,
          now,
          now
        );
        insertFile.run(
          randomUUID(),
          mountPointId,
          file.relativePath,
          fileName,
          classification.type,
          sha,
          Buffer.byteLength(content, 'utf-8'),
          lastModified,
          folderId,
          'converted',
          null,
          content.length,
          now,
          now
        );
        counts.textDocuments += 1;
      } else {
        const sha = sha256Buffer(bytes);
        const originalMime = guessMimeType(ext);

        let extractedText: string | null = null;
        let extractedTextSha256: string | null = null;
        let extractionStatus: 'none' | 'converted' | 'failed' = 'none';
        let extractionError: string | null = null;

        if (classification.type === 'pdf' || classification.type === 'docx') {
          try {
            const text = await convertBufferToPlainText(bytes, classification.type);
            if (text && text.trim().length > 0) {
              extractedText = text;
              extractedTextSha256 = sha256String(text);
              extractionStatus = 'converted';
            } else {
              extractionStatus = 'failed';
              extractionError = 'Converter produced no text';
            }
          } catch (err) {
            extractionStatus = 'failed';
            extractionError = err instanceof Error ? err.message : String(err);
          }
        }

        insertBlob.run(
          randomUUID(),
          mountPointId,
          file.relativePath,
          fileName,
          originalMime,
          originalMime,
          bytes.length,
          sha,
          extractedText,
          extractedTextSha256,
          extractionStatus,
          extractionError,
          bytes,
          now,
          now
        );

        const hasText = extractionStatus === 'converted' && extractedText !== null;
        insertFile.run(
          randomUUID(),
          mountPointId,
          file.relativePath,
          fileName,
          classification.type,
          sha,
          bytes.length,
          lastModified,
          folderId,
          hasText ? 'converted' : 'skipped',
          extractionError,
          hasText ? extractedText!.length : null,
          now,
          now
        );

        if (hasText) counts.blobsWithText += 1;
        else counts.blobsWithoutText += 1;
      }
    } catch (err) {
      counts.errors += 1;
      logger.warn('Failed to import file into project document store', {
        context: 'migration.convert-project-files-to-document-stores',
        projectId,
        mountPointId,
        relativePath: file.relativePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return counts;
}

function uniqueMountPointName(mountDb: DatabaseType, desiredName: string): string {
  const countStmt = mountDb.prepare(
    `SELECT COUNT(*) as n FROM "doc_mount_points" WHERE name = ?`
  );
  let candidate = desiredName;
  let suffix = 2;
  while (((countStmt.get(candidate) as { n: number }).n) > 0) {
    candidate = `${desiredName} (${suffix++})`;
  }
  return candidate;
}

function updateMountPointTotals(mountDb: DatabaseType, mountPointId: string): void {
  const totals = mountDb.prepare(
    `SELECT COUNT(*) as fileCount, COALESCE(SUM(fileSizeBytes), 0) as totalSizeBytes
     FROM "doc_mount_files" WHERE mountPointId = ?`
  ).get(mountPointId) as { fileCount: number; totalSizeBytes: number };

  mountDb.prepare(
    `UPDATE "doc_mount_points"
     SET fileCount = ?, totalSizeBytes = ?, lastScannedAt = ?, updatedAt = ?
     WHERE id = ?`
  ).run(totals.fileCount, totals.totalSizeBytes, nowIso(), nowIso(), mountPointId);
}

// ============================================================================
// Migration
// ============================================================================

export const convertProjectFilesToDocumentStoresMigration: Migration = {
  id: 'convert-project-files-to-document-stores-v1',
  description:
    'Convert each project\'s on-disk file storage into a database-backed Scriptorium document store and archive the original directory',
  introducedInVersion: '4.4.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('projects')) return false;

    const filesDir = getFilesDir();
    if (!fs.existsSync(filesDir)) return false;

    const db = getSQLiteDatabase();
    const projects = db.prepare(`SELECT id FROM "projects"`).all() as Array<{ id: string }>;
    for (const { id } of projects) {
      const projectDir = path.join(filesDir, id);
      const archiveDir = `${projectDir}_doc_store_archive`;
      if (fs.existsSync(projectDir) && !fs.existsSync(archiveDir)) {
        return true;
      }
    }
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    let mountDb: DatabaseType | null = null;
    let projectsMigrated = 0;
    const failedProjects: Array<{ projectId: string; error: string }> = [];

    try {
      const filesDir = getFilesDir();
      const mainDb = getSQLiteDatabase();
      const projects = mainDb
        .prepare(`SELECT id, name FROM "projects" ORDER BY createdAt`)
        .all() as ProjectRow[];

      if (projects.length === 0) {
        return {
          id: 'convert-project-files-to-document-stores-v1',
          success: true,
          itemsAffected: 0,
          message: 'No projects to migrate',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      mountDb = openMountIndexDb();
      if (!mountDb) {
        throw new Error('Failed to open mount index database');
      }
      ensureMountIndexTables(mountDb);

      const insertMountPointStmt = mountDb.prepare(
        `INSERT INTO "doc_mount_points"
         (id, name, basePath, mountType, storeType, includePatterns, excludePatterns,
          enabled, lastScannedAt, scanStatus, lastScanError, conversionStatus, conversionError,
          fileCount, chunkCount, totalSizeBytes, createdAt, updatedAt)
         VALUES (?, ?, '', 'database', 'documents', ?, ?, 1, NULL, 'idle', NULL,
                 'idle', NULL, 0, 0, 0, ?, ?)`
      );
      const insertLinkStmt = mountDb.prepare(
        `INSERT INTO "project_doc_mount_links"
         (id, projectId, mountPointId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?)`
      );
      const deleteMountPointStmt = mountDb.prepare(
        `DELETE FROM "doc_mount_points" WHERE id = ?`
      );
      const deleteDocsStmt = mountDb.prepare(
        `DELETE FROM "doc_mount_documents" WHERE mountPointId = ?`
      );
      const deleteFilesStmt = mountDb.prepare(
        `DELETE FROM "doc_mount_files" WHERE mountPointId = ?`
      );
      const deleteFoldersStmt = mountDb.prepare(
        `DELETE FROM "doc_mount_folders" WHERE mountPointId = ?`
      );
      const deleteBlobsStmt = mountDb.prepare(
        `DELETE FROM "doc_mount_blobs" WHERE mountPointId = ?`
      );
      const deleteLinkStmt = mountDb.prepare(
        `DELETE FROM "project_doc_mount_links" WHERE mountPointId = ?`
      );

      let projectIndex = 0;
      for (const project of projects) {
        projectIndex++;
        const outerTier = { current: projectIndex, total: projects.length, unit: 'projects' };
        reportProgress([outerTier]);
        const projectDir = path.join(filesDir, project.id);
        const archiveDir = `${projectDir}_doc_store_archive`;

        if (!fs.existsSync(projectDir)) continue;
        if (fs.existsSync(archiveDir)) {
          logger.info('Skipping project with existing archive directory', {
            context: 'migration.convert-project-files-to-document-stores',
            projectId: project.id,
            archiveDir,
          });
          continue;
        }

        const mountPointId = randomUUID();
        const desiredName = `${PROJECT_OWN_STORE_NAME_PREFIX}${(project.name || 'Untitled').trim()}`.slice(0, 200);
        const mountPointName = uniqueMountPointName(mountDb, desiredName);
        const now = nowIso();

        try {
          insertMountPointStmt.run(
            mountPointId,
            mountPointName,
            JSON.stringify([]), // includePatterns — empty so migration-imported files aren't re-filtered
            JSON.stringify(['.git', 'node_modules', '.obsidian', '.trash']),
            now,
            now
          );

          const counts = await importProjectDirectory(
            mountDb,
            project.id,
            mountPointId,
            projectDir,
            outerTier
          );

          insertLinkStmt.run(randomUUID(), project.id, mountPointId, now, now);

          updateMountPointTotals(mountDb, mountPointId);

          // Final safety gate — only rename the on-disk directory after every
          // database write has succeeded. If the rename itself fails, roll
          // back the mount-point rows so a retry starts clean.
          try {
            await fsPromises.rename(projectDir, archiveDir);
          } catch (renameErr) {
            const renameMsg = renameErr instanceof Error ? renameErr.message : String(renameErr);
            logger.error('Failed to rename project directory after import', {
              context: 'migration.convert-project-files-to-document-stores',
              projectId: project.id,
              mountPointId,
              projectDir,
              archiveDir,
              error: renameMsg,
            });
            deleteLinkStmt.run(mountPointId);
            deleteBlobsStmt.run(mountPointId);
            deleteFoldersStmt.run(mountPointId);
            deleteDocsStmt.run(mountPointId);
            deleteFilesStmt.run(mountPointId);
            deleteMountPointStmt.run(mountPointId);
            throw renameErr;
          }

          projectsMigrated += 1;
          logger.info('Migrated project file storage to document store', {
            context: 'migration.convert-project-files-to-document-stores',
            projectId: project.id,
            mountPointId,
            mountPointName,
            textDocuments: counts.textDocuments,
            blobsWithText: counts.blobsWithText,
            blobsWithoutText: counts.blobsWithoutText,
            errors: counts.errors,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failedProjects.push({ projectId: project.id, error: message });
          try {
            deleteLinkStmt.run(mountPointId);
            deleteBlobsStmt.run(mountPointId);
            deleteFoldersStmt.run(mountPointId);
            deleteDocsStmt.run(mountPointId);
            deleteFilesStmt.run(mountPointId);
            deleteMountPointStmt.run(mountPointId);
          } catch (cleanupErr) {
            logger.warn('Failed to clean up partial migration state', {
              context: 'migration.convert-project-files-to-document-stores',
              projectId: project.id,
              mountPointId,
              error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
            });
          }
          logger.error('Project file storage migration failed; continuing with remaining projects', {
            context: 'migration.convert-project-files-to-document-stores',
            projectId: project.id,
            error: message,
          });
        }
      }

      const message = failedProjects.length === 0
        ? `Converted ${projectsMigrated} project file directory(ies) to document stores`
        : `Converted ${projectsMigrated} project directory(ies); ${failedProjects.length} failed: ${failedProjects.map(f => `${f.projectId}: ${f.error}`).join('; ')}`;

      return {
        id: 'convert-project-files-to-document-stores-v1',
        success: true,
        itemsAffected: projectsMigrated,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Project file storage migration aborted', {
        context: 'migration.convert-project-files-to-document-stores',
        error: errorMessage,
      });
      return {
        id: 'convert-project-files-to-document-stores-v1',
        success: false,
        itemsAffected: projectsMigrated,
        message: 'Project file storage migration aborted',
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
