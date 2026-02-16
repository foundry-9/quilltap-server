/**
 * System Restore API v1
 *
 * POST /api/v1/system/restore - Restore data from a backup
 * POST /api/v1/system/restore?action=preview - Preview backup contents
 *
 * Accepts multipart/form-data with file and mode.
 * Writes the uploaded zip to a temp file on disk immediately, then passes
 * the file path to the restore/preview functions to avoid holding the
 * entire zip in memory.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { restore, previewRestore } from '@/lib/backup/restore-service';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { badRequest, serverError, validationError } from '@/lib/api/responses';

// Extend timeout for restore operations
export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

/**
 * Write the uploaded file to a temp path on disk and return the path.
 * The buffer is released after writing so it can be GC'd.
 */
async function writeUploadToDisk(file: File): Promise<string> {
  const tempZipPath = path.join(os.tmpdir(), `quilltap-restore-${randomUUID()}.zip`);
  const arrayBuffer = await file.arrayBuffer();
  await fs.promises.writeFile(tempZipPath, Buffer.from(arrayBuffer));
  return tempZipPath;
}

/**
 * Clean up a temp file (best-effort)
 */
async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Parse request and write the uploaded ZIP to a temp file on disk
 */
async function getBackupFile(
  req: NextRequest
): Promise<{ zipPath: string; mode: 'replace' | 'new-account'; isPreview?: boolean } | NextResponse> {
  const contentType = req.headers.get('content-type');

  if (!contentType?.includes('multipart/form-data')) {
    return badRequest('Content-Type must be multipart/form-data');
  }

  // Handle file upload
  const formData = await req.formData();
  const file = formData.get('file') as File;
  const modeParam = formData.get('mode') as string;
  const previewParam = formData.get('preview') as string;

  if (!file) {
    return badRequest('No file provided');
  }

  if (!modeParam || !['replace', 'new-account'].includes(modeParam)) {
    return badRequest('mode must be "replace" or "new-account"');
  }

  const mode = modeParam as 'replace' | 'new-account';
  const isPreview = previewParam === 'true';

  // Write to disk immediately and release the in-memory buffer
  const zipPath = await writeUploadToDisk(file);

  return { zipPath, mode, isPreview };
}

/**
 * POST /api/v1/system/restore - Restore from backup
 */
export const POST = createAuthenticatedHandler(async (req, { user }) => {
  const action = getActionParam(req);

  // Handle preview action
  if (action === 'preview') {
    let tempZipPath: string | null = null;
    try {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return badRequest('No file provided');
      }

      tempZipPath = await writeUploadToDisk(file);
      const preview = await previewRestore(tempZipPath);

      logger.info('[System Restore v1] Preview generated', {
        userId: user.id,
        preview,
      });

      return NextResponse.json({
        success: true,
        preview,
      });
    } catch (error) {
      logger.error('[System Restore v1] Error generating preview', {}, error instanceof Error ? error : undefined);
      return serverError(error instanceof Error ? error.message : 'Failed to preview backup');
    } finally {
      if (tempZipPath) {
        await cleanupTempFile(tempZipPath);
      }
    }
  }

  // Handle restore
  let tempZipPath: string | null = null;
  try {
    const result = await getBackupFile(req);

    // If it's a NextResponse (error), return it
    if (result instanceof NextResponse) {
      return result;
    }

    const { zipPath, mode, isPreview } = result;
    tempZipPath = zipPath;

    // If preview mode from formdata
    if (isPreview) {
      logger.info('[System Restore v1] Preview from restore endpoint', {
        userId: user.id,
        mode,
      });

      const summary = await previewRestore(zipPath);
      return NextResponse.json({
        success: true,
        preview: true,
        summary,
      });
    }

    logger.info('[System Restore v1] Starting restore', {
      userId: user.id,
      mode,
    });

    // Perform the actual restore
    const summary = await restore(zipPath, {
      mode,
      targetUserId: user.id,
    });

    logger.info('[System Restore v1] Restore completed', {
      userId: user.id,
      mode,
      restoreCounts: {
        characters: summary.characters,
        chats: summary.chats,
        messages: summary.messages,
        tags: summary.tags,
        files: summary.files,
        memories: summary.memories,
      },
      warnings: summary.warnings.length,
    });

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[System Restore v1] Error restoring backup', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to restore backup');
  } finally {
    if (tempZipPath) {
      await cleanupTempFile(tempZipPath);
    }
  }
});
