/**
 * Migration: Re-absorb leftover project files into the database-backed
 * official store.
 *
 * `convert-project-files-to-document-stores-v1` converted each project's
 * `<filesDir>/<projectId>/` directory into a database-backed mount point
 * and renamed the source directory to `<projectId>_doc_store_archive`. But
 * because `lib/doc-edit/path-resolver.ts:resolveProjectPath` continued to
 * point `scope: 'project'` at the legacy filesystem location, every later
 * `doc_write_file({ scope: 'project' })` (and similar tool calls) silently
 * recreated the directory and wrote into it, while Document Mode UI / the
 * Scriptorium reads from the database mount. The two stores diverged.
 *
 * Stage 2 plugs the leak in code (resolveProjectPath now dispatches through
 * the official mount). This migration cleans up the wreckage on instances
 * where the divergence already happened: for every project that has an
 * `officialMountPointId` and a leftover directory at `<filesDir>/<projectId>/`,
 * import any file not already in the database mount (compared by
 * `relativePath`), then rename the directory to a fresh
 * `<projectId>_doc_store_archive_v2` so the resolver fallback can no longer
 * see it. Projects without an `officialMountPointId` are skipped — the
 * resolver fallback is the right answer for them until a future migration
 * provisions an official mount.
 *
 * Idempotent: a project is considered handled when its on-disk directory no
 * longer exists. Already-imported files are skipped via the unique-path
 * check rather than creating duplicates.
 *
 * Migration ID: reabsorb-leftover-project-files-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';
import { getFilesDir, getMountIndexDatabasePath } from '../../lib/paths';
import { convertBufferToPlainText } from '../../lib/mount-index/converters';

const EXCLUDE_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.meta.json']);
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash']);

function nowIso(): string {
  return new Date().toISOString();
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256String(str: string): string {
  return createHash('sha256').update(str, 'utf-8').digest('hex');
}

type TextFileType = 'markdown' | 'txt' | 'json' | 'jsonl';
type BlobFileType = 'pdf' | 'docx' | 'blob';

function classifyExtension(
  ext: string
): { kind: 'text'; type: TextFileType } | { kind: 'blob'; type: BlobFileType } {
  switch (ext.toLowerCase()) {
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
  switch (ext.toLowerCase()) {
    case '.pdf': return 'application/pdf';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.heic':
    case '.heif': return 'image/heic';
    case '.tiff':
    case '.tif': return 'image/tiff';
    case '.avif': return 'image/avif';
    case '.mp3': return 'audio/mpeg';
    case '.mp4': return 'video/mp4';
    case '.wav': return 'audio/wav';
    case '.zip': return 'application/zip';
    default: return 'application/octet-stream';
  }
}

interface WalkedFile {
  relativePath: string;
  absolutePath: string;
}

async function walkDirectory(rootDir: string): Promise<WalkedFile[]> {
  const results: WalkedFile[] = [];
  async function recurse(currentDir: string, relativeBase: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      logger.warn('Unable to read directory during reabsorb walk', {
        context: 'migration.reabsorb-leftover-project-files',
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

function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) return null;
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
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

function pickArchiveDir(projectDir: string): string {
  const base = `${projectDir}_doc_store_archive`;
  if (!fs.existsSync(base)) return base;
  // Prior migration already used the un-suffixed name. Pick the first numeric
  // suffix that is free so we don't collide with previous archives.
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}_v${i}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  // Pathological fallback — append a UUID. Unlikely to ever fire.
  return `${base}_${randomUUID()}`;
}

interface ImportCounts {
  textDocuments: number;
  blobsWithText: number;
  blobsWithoutText: number;
  skippedAlreadyPresent: number;
  errors: number;
}

async function importLeftoverFiles(
  mountDb: DatabaseType,
  projectId: string,
  mountPointId: string,
  projectDir: string
): Promise<ImportCounts> {
  const counts: ImportCounts = {
    textDocuments: 0,
    blobsWithText: 0,
    blobsWithoutText: 0,
    skippedAlreadyPresent: 0,
    errors: 0,
  };

  const files = await walkDirectory(projectDir);

  const existsStmt = mountDb.prepare(
    `SELECT 1 FROM "doc_mount_files" WHERE mountPointId = ? AND relativePath = ?`
  );

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
    try {
      if (existsStmt.get(mountPointId, file.relativePath)) {
        counts.skippedAlreadyPresent += 1;
        continue;
      }

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
      logger.warn('Failed to reabsorb file into project document store', {
        context: 'migration.reabsorb-leftover-project-files',
        projectId,
        mountPointId,
        relativePath: file.relativePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return counts;
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

interface ProjectRow {
  id: string;
  officialMountPointId: string | null;
}

function listProjectsWithLeftovers(): ProjectRow[] {
  const filesDir = getFilesDir();
  if (!fs.existsSync(filesDir)) return [];
  const colNames = new Set(getSQLiteTableColumns('projects').map(c => c.name));
  if (!colNames.has('officialMountPointId')) return [];

  const db = getSQLiteDatabase();
  const rows = db.prepare(
    `SELECT id, officialMountPointId FROM "projects"`
  ).all() as ProjectRow[];

  return rows.filter(row => {
    if (!row.officialMountPointId) return false;
    const projectDir = path.join(filesDir, row.id);
    return fs.existsSync(projectDir);
  });
}

export const reabsorbLeftoverProjectFilesMigration: Migration = {
  id: 'reabsorb-leftover-project-files-v1',
  description:
    'Re-absorb any project files left on disk after convert-project-files-to-document-stores-v1 into the project\'s database-backed official store, then archive the leftover directory',
  introducedInVersion: '4.5.0',
  dependsOn: [
    'sqlite-initial-schema-v1',
    'convert-project-files-to-document-stores-v1',
    'add-project-official-mount-point-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('projects')) return false;
    return listProjectsWithLeftovers().length > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const projectsWithLeftovers = listProjectsWithLeftovers();

    if (projectsWithLeftovers.length === 0) {
      return {
        id: 'reabsorb-leftover-project-files-v1',
        success: true,
        itemsAffected: 0,
        message: 'No leftover project directories to reabsorb',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const filesDir = getFilesDir();
    let mountDb: DatabaseType | null = null;
    let projectsHandled = 0;
    let totalFilesImported = 0;
    let totalFilesSkipped = 0;
    const failedProjects: Array<{ projectId: string; error: string }> = [];

    try {
      mountDb = openMountIndexDb();
      if (!mountDb) {
        throw new Error('Failed to open mount index database');
      }

      for (const project of projectsWithLeftovers) {
        if (!project.officialMountPointId) continue;

        const projectDir = path.join(filesDir, project.id);
        const archiveDir = pickArchiveDir(projectDir);

        try {
          // Sanity check: the official mount point must still exist and be
          // database-backed. Filesystem mount-backed officials don't need
          // this migration — they share the same on-disk path semantics.
          const mp = mountDb.prepare(
            `SELECT id, mountType FROM "doc_mount_points" WHERE id = ?`
          ).get(project.officialMountPointId) as { id: string; mountType: string } | undefined;

          if (!mp) {
            logger.warn('Official mount point row not found; skipping reabsorb', {
              context: 'migration.reabsorb-leftover-project-files',
              projectId: project.id,
              officialMountPointId: project.officialMountPointId,
            });
            continue;
          }

          if (mp.mountType !== 'database') {
            logger.info('Official mount is not database-backed; skipping reabsorb', {
              context: 'migration.reabsorb-leftover-project-files',
              projectId: project.id,
              mountType: mp.mountType,
            });
            continue;
          }

          const counts = await importLeftoverFiles(
            mountDb,
            project.id,
            project.officialMountPointId,
            projectDir
          );

          updateMountPointTotals(mountDb, project.officialMountPointId);

          // Only rename after every database write succeeded. If the rename
          // fails, leave the directory in place so the next run retries.
          await fsPromises.rename(projectDir, archiveDir);

          projectsHandled += 1;
          totalFilesImported += counts.textDocuments + counts.blobsWithText + counts.blobsWithoutText;
          totalFilesSkipped += counts.skippedAlreadyPresent;

          logger.info('Reabsorbed leftover project files', {
            context: 'migration.reabsorb-leftover-project-files',
            projectId: project.id,
            mountPointId: project.officialMountPointId,
            archiveDir,
            textDocuments: counts.textDocuments,
            blobsWithText: counts.blobsWithText,
            blobsWithoutText: counts.blobsWithoutText,
            skippedAlreadyPresent: counts.skippedAlreadyPresent,
            errors: counts.errors,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failedProjects.push({ projectId: project.id, error: message });
          logger.error('Reabsorb failed for project; continuing with remaining projects', {
            context: 'migration.reabsorb-leftover-project-files',
            projectId: project.id,
            error: message,
          });
        }
      }

      const message =
        failedProjects.length === 0
          ? `Reabsorbed ${totalFilesImported} file(s) (${totalFilesSkipped} already present) across ${projectsHandled} project directory(ies)`
          : `Reabsorbed ${totalFilesImported} file(s) across ${projectsHandled} project(s); ${failedProjects.length} failed: ${failedProjects.map(f => `${f.projectId}: ${f.error}`).join('; ')}`;

      return {
        id: 'reabsorb-leftover-project-files-v1',
        success: true,
        itemsAffected: projectsHandled,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Reabsorb migration aborted', {
        context: 'migration.reabsorb-leftover-project-files',
        error: errorMessage,
      });
      return {
        id: 'reabsorb-leftover-project-files-v1',
        success: false,
        itemsAffected: projectsHandled,
        message: 'Reabsorb migration aborted',
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
