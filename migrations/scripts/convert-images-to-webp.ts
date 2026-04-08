/**
 * Migration: Convert All Images to WebP
 *
 * Converts every non-WebP, non-SVG image in the instance's file storage to
 * WebP format. Updates the database record (storageKey, mimeType,
 * originalFilename, size, sha256) and deletes the old file only after
 * verifying the new WebP file exists on disk.
 *
 * Cached thumbnails for converted files are also cleaned up since they will
 * be regenerated on demand in WebP format (which they already were).
 *
 * Migration ID: convert-images-to-webp-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { getFilesDir } from '../../lib/paths';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  querySQLite,
  executeSQLite,
  sqliteTableExists,
} from '../lib/database-utils';

// ============================================================================
// Constants
// ============================================================================

/** WebP quality setting — matches the runtime conversion utility */
const WEBP_QUALITY = 90;

/** Common thumbnail sizes to clean up */
const COMMON_THUMBNAIL_SIZES = [120, 150, 300];

/** MIME types that should be converted to WebP */
const CONVERTIBLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/avif',
]);

// ============================================================================
// Types
// ============================================================================

interface ImageFileRecord {
  id: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  sha256: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Replace a file extension with .webp
 */
function replaceExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex > 0) {
    return `${filename.slice(0, dotIndex)}.webp`;
  }
  return `${filename}.webp`;
}

/**
 * Convert a buffer to WebP using sharp.
 * Sharp is imported dynamically since it's a native module.
 */
async function convertBufferToWebP(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(buffer)
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

// ============================================================================
// Migration
// ============================================================================

export const convertImagesToWebPMigration: Migration = {
  id: 'convert-images-to-webp-v1',
  description: 'Convert all non-WebP, non-SVG images to WebP format',
  introducedInVersion: '2.14.0',
  dependsOn: [
    'restructure-file-storage-v1',
    'restructure-file-storage-cleanup-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('files')) return false;

    // Check if there are any convertible images
    const mimeList = Array.from(CONVERTIBLE_MIME_TYPES).map(m => `'${m}'`).join(',');
    const rows = querySQLite<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE mimeType IN (${mimeList})`
    );
    return rows.length > 0 && rows[0].count > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let converted = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    const filesDir = getFilesDir();

    // Query all convertible images
    const mimeList = Array.from(CONVERTIBLE_MIME_TYPES).map(m => `'${m}'`).join(',');
    const imageFiles = querySQLite<ImageFileRecord>(
      `SELECT id, storageKey, originalFilename, mimeType, size, sha256
       FROM files
       WHERE mimeType IN (${mimeList})
       ORDER BY size ASC`
    );

    logger.info('[WebP Migration] Found images to convert', {
      context: 'migrations.convert-images-to-webp',
      totalImages: imageFiles.length,
    });

    for (const file of imageFiles) {
      try {
        // 1. Resolve the full path on disk
        if (!file.storageKey) {
          logger.warn('[WebP Migration] File has no storageKey, skipping', {
            fileId: file.id,
          });
          skipped++;
          continue;
        }

        const oldFullPath = path.join(filesDir, file.storageKey);

        // 2. Verify original file exists
        if (!fs.existsSync(oldFullPath)) {
          logger.warn('[WebP Migration] Original file not found on disk, skipping', {
            fileId: file.id,
            storageKey: file.storageKey,
          });
          skipped++;
          continue;
        }

        // 3. Read the original file
        const originalBuffer = fs.readFileSync(oldFullPath);

        // 4. Convert to WebP
        const webpBuffer = await convertBufferToWebP(originalBuffer);

        // 5. Compute new storage key, filename, and hash
        const newStorageKey = replaceExtension(file.storageKey);
        const newFilename = replaceExtension(file.originalFilename);
        const newSha256 = createHash('sha256').update(new Uint8Array(webpBuffer)).digest('hex');
        const newFullPath = path.join(filesDir, newStorageKey);

        // 6. Ensure the target directory exists
        const targetDir = path.dirname(newFullPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        // 7. Write the WebP file
        fs.writeFileSync(newFullPath, webpBuffer);

        // 8. Verify the new file exists and has correct size
        if (!fs.existsSync(newFullPath)) {
          throw new Error('WebP file not found after write');
        }
        const stat = fs.statSync(newFullPath);
        if (stat.size !== webpBuffer.length) {
          throw new Error(`WebP file size mismatch: expected ${webpBuffer.length}, got ${stat.size}`);
        }

        // 9. Update the database record
        executeSQLite(
          `UPDATE files SET
            storageKey = ?,
            originalFilename = ?,
            mimeType = 'image/webp',
            size = ?,
            sha256 = ?
          WHERE id = ?`,
          [newStorageKey, newFilename, webpBuffer.length, newSha256, file.id]
        );

        // 10. Delete the old file (only if the storage key changed)
        if (newStorageKey !== file.storageKey && fs.existsSync(oldFullPath)) {
          fs.unlinkSync(oldFullPath);
        }

        // 11. Clean up cached thumbnails (they reference the old content hash)
        for (const size of COMMON_THUMBNAIL_SIZES) {
          const thumbKey = `_thumbnails/${file.id}_${size}.webp`;
          const thumbPath = path.join(filesDir, thumbKey);
          if (fs.existsSync(thumbPath)) {
            try {
              fs.unlinkSync(thumbPath);
            } catch {
              // Thumbnail cleanup is best-effort
            }
          }
        }

        converted++;

        if (converted % 50 === 0) {
          logger.info('[WebP Migration] Progress', {
            context: 'migrations.convert-images-to-webp',
            converted,
            skipped,
            failed,
            remaining: imageFiles.length - converted - skipped - failed,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('[WebP Migration] Failed to convert image', {
          context: 'migrations.convert-images-to-webp',
          fileId: file.id,
          storageKey: file.storageKey,
          error: errorMessage,
        });
        errors.push(`${file.id}: ${errorMessage}`);
        failed++;
      }
    }

    const durationMs = Date.now() - startTime;
    const success = failed === 0;

    const message = `Converted ${converted} images to WebP, skipped ${skipped}, failed ${failed}`;
    logger.info('[WebP Migration] Complete', {
      context: 'migrations.convert-images-to-webp',
      converted,
      skipped,
      failed,
      durationMs,
    });

    return {
      id: 'convert-images-to-webp-v1',
      success,
      itemsAffected: converted,
      message: failed > 0 ? `${message}. Errors: ${errors.slice(0, 5).join('; ')}` : message,
      error: failed > 0 ? `${failed} images failed to convert` : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
