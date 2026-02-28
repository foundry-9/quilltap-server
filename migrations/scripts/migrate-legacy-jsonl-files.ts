/**
 * Migration: Migrate Legacy JSONL Files to SQLite
 *
 * This migration imports file entries from the legacy public/data/files/files.jsonl
 * format into the SQLite database. It also copies physical files from
 * public/data/files/storage/ to the centralized files directory.
 *
 * Legacy files stored in public/data/files/ were served as static assets,
 * which breaks in Docker's standalone build where public/ is baked into the
 * image at build time and the runtime data volume is separate.
 *
 * This migration:
 * 1. Reads entries from public/data/files/files.jsonl
 * 2. Inserts missing entries into the SQLite files table
 * 3. Copies physical files to the centralized files directory
 * 4. Sets storageKey so files are served through the API route
 *
 * Migration ID: migrate-legacy-jsonl-files-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import fs from 'fs';
import path from 'path';
import {
  getFilesDir,
} from '../../lib/paths';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  querySQLite,
  sqliteTableExists,
} from '../lib/database-utils';

interface LegacyFileEntry {
  id: string;
  userId: string;
  sha256?: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  isPlainText?: boolean;
  linkedTo?: string[];
  source?: string;
  category?: string;
  generationPrompt?: string;
  generationModel?: string;
  generationRevisedPrompt?: string;
  description?: string;
  tags?: string[];
  projectId?: string;
  folderPath?: string;
  s3Key?: string;
  s3Bucket?: string;
  storageKey?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Get the path to the legacy JSONL files
 */
function getLegacyJsonlPath(): string {
  return path.join(process.cwd(), 'public', 'data', 'files', 'files.jsonl');
}

/**
 * Get the legacy storage directory
 */
function getLegacyStorageDir(): string {
  return path.join(process.cwd(), 'public', 'data', 'files', 'storage');
}

/**
 * Read and parse the JSONL file
 */
function readJsonlFile(filePath: string): LegacyFileEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: LegacyFileEntry[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      entries.push(JSON.parse(trimmed));
    } catch (error) {
      logger.warn('Failed to parse JSONL line', {
        context: 'migration.legacy-jsonl-files',
        line: trimmed.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return entries;
}

/**
 * Get the extension from a filename
 */
function getExtension(filename: string): string {
  if (!filename.includes('.')) return '';
  return filename.substring(filename.lastIndexOf('.'));
}

/**
 * Copy a legacy file to the centralized files directory
 */
function copyLegacyFile(
  fileId: string,
  filename: string,
  storageKey: string,
  filesDir: string,
  legacyStorageDir: string
): boolean {
  const ext = getExtension(filename);
  const legacyPath = path.join(legacyStorageDir, `${fileId}${ext}`);

  if (!fs.existsSync(legacyPath)) {
    logger.debug('Legacy file not found on disk, skipping copy', {
      context: 'migration.legacy-jsonl-files',
      fileId,
      legacyPath,
    });
    return false;
  }

  // Build target path from storageKey (e.g., "users/{userId}/files/{fileId}{ext}")
  const targetPath = path.join(filesDir, storageKey);
  const targetDir = path.dirname(targetPath);

  if (fs.existsSync(targetPath)) {
    logger.debug('File already exists at target, skipping copy', {
      context: 'migration.legacy-jsonl-files',
      fileId,
      targetPath,
    });
    return true;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.copyFileSync(legacyPath, targetPath);
  return true;
}

export const migrateLegacyJsonlFilesMigration: Migration = {
  id: 'migrate-legacy-jsonl-files-v1',
  description: 'Import legacy JSONL file entries into SQLite and copy files to centralized directory',
  introducedInVersion: '2.12.0',
  dependsOn: ['migrate-to-centralized-data-dir-v1'],

  async shouldRun(): Promise<boolean> {
    const jsonlPath = getLegacyJsonlPath();

    if (!fs.existsSync(jsonlPath)) {
      logger.debug('No legacy JSONL files found, skipping migration', {
        context: 'migration.legacy-jsonl-files',
        path: jsonlPath,
      });
      return false;
    }

    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('files')) {
      return false;
    }

    // Check if there are entries in the JSONL that are not in SQLite
    const entries = readJsonlFile(jsonlPath);
    if (entries.length === 0) {
      return false;
    }

    // Check if any entries are missing from the database
    const db = getSQLiteDatabase();
    const existingIds = new Set(
      querySQLite<{ id: string }>('SELECT id FROM files').map(r => r.id)
    );

    const missingEntries = entries.filter(e => !existingIds.has(e.id));

    if (missingEntries.length === 0) {
      logger.info('All legacy JSONL entries already exist in database', {
        context: 'migration.legacy-jsonl-files',
        totalEntries: entries.length,
      });
      return false;
    }

    logger.info('Legacy JSONL entries need migration', {
      context: 'migration.legacy-jsonl-files',
      totalEntries: entries.length,
      missingEntries: missingEntries.length,
    });

    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let itemsAffected = 0;

    const jsonlPath = getLegacyJsonlPath();
    const legacyStorageDir = getLegacyStorageDir();
    const filesDir = getFilesDir();

    logger.info('Starting legacy JSONL files migration', {
      context: 'migration.legacy-jsonl-files',
      jsonlPath,
      legacyStorageDir,
      filesDir,
    });

    const entries = readJsonlFile(jsonlPath);
    const existingIds = new Set(
      querySQLite<{ id: string }>('SELECT id FROM files').map(r => r.id)
    );

    const db = getSQLiteDatabase();
    const insertStmt = db.prepare(`
      INSERT INTO files (
        id, userId, sha256, originalFilename, mimeType, size,
        width, height, isPlainText, linkedTo, source, category,
        generationPrompt, generationModel, generationRevisedPrompt,
        description, tags, projectId, folderPath,
        storageKey, createdAt, updatedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    for (const entry of entries) {
      if (existingIds.has(entry.id)) {
        continue;
      }

      try {
        // Determine storageKey: use existing s3Key, or construct one
        const ext = getExtension(entry.originalFilename);
        const storageKey = entry.storageKey || entry.s3Key || `users/${entry.userId}/files/${entry.id}${ext}`;
        const now = new Date().toISOString();

        insertStmt.run(
          entry.id,
          entry.userId,
          entry.sha256 || '',
          entry.originalFilename,
          entry.mimeType,
          entry.size,
          entry.width ?? null,
          entry.height ?? null,
          entry.isPlainText ? 1 : null,
          JSON.stringify(entry.linkedTo || []),
          entry.source || 'upload',
          entry.category || 'image',
          entry.generationPrompt ?? null,
          entry.generationModel ?? null,
          entry.generationRevisedPrompt ?? null,
          entry.description ?? null,
          JSON.stringify(entry.tags || []),
          entry.projectId ?? null,
          entry.folderPath ?? null,
          storageKey,
          entry.createdAt || now,
          entry.updatedAt || now,
        );

        // Copy the physical file to the centralized directory
        copyLegacyFile(entry.id, entry.originalFilename, storageKey, filesDir, legacyStorageDir);

        itemsAffected++;
        logger.debug('Migrated legacy file entry', {
          context: 'migration.legacy-jsonl-files',
          fileId: entry.id,
          filename: entry.originalFilename,
          storageKey,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`File ${entry.id}: ${errorMsg}`);
        logger.error('Failed to migrate legacy file entry', {
          context: 'migration.legacy-jsonl-files',
          fileId: entry.id,
          error: errorMsg,
        });
      }
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Legacy JSONL files migration completed', {
      context: 'migration.legacy-jsonl-files',
      success,
      itemsAffected,
      errorCount: errors.length,
      durationMs,
    });

    return {
      id: 'migrate-legacy-jsonl-files-v1',
      success,
      itemsAffected,
      message: success
        ? `Migrated ${itemsAffected} legacy file entries to SQLite`
        : `Migration completed with ${errors.length} errors`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
