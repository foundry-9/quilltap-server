/**
 * System Restore API v1
 *
 * POST /api/v1/system/restore - Restore data from a backup
 * POST /api/v1/system/restore?action=preview - Preview backup contents
 *
 * Supports two modes:
 * 1. Upload mode: multipart/form-data with file and mode
 * 2. S3 mode: JSON body with s3Key and mode
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { restore, previewRestore } from '@/lib/backup/restore-service';
import { downloadBackupFromS3 } from '@/lib/backup/backup-service';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { badRequest, serverError, validationError } from '@/lib/api/responses';

// Extend timeout for restore operations
export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

const RestoreRequestSchema = z.object({
  s3Key: z.string().optional(),
  mode: z.enum(['replace', 'new-account']),
});

/**
 * Parse request and get the ZIP buffer
 */
async function getBackupBuffer(
  req: NextRequest,
  userId: string
): Promise<{ buffer: Buffer; mode: 'replace' | 'new-account'; isPreview?: boolean } | NextResponse> {
  const contentType = req.headers.get('content-type');
  let zipBuffer: Buffer | null = null;
  let mode: 'replace' | 'new-account' = 'replace';
  let isPreview = false;

  if (contentType?.includes('multipart/form-data')) {
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

    mode = modeParam as 'replace' | 'new-account';
    isPreview = previewParam === 'true';
    zipBuffer = Buffer.from(await file.arrayBuffer());

    logger.debug('[System Restore v1] File uploaded', {
      userId,
      fileSize: zipBuffer.length,
      mode,
      isPreview,
    });
  } else if (contentType?.includes('application/json')) {
    // Handle S3 download
    const body = await req.json();
    const { s3Key, mode: bodyMode } = RestoreRequestSchema.parse(body);

    if (!s3Key) {
      return badRequest('s3Key is required for S3 restore');
    }

    mode = bodyMode;

    logger.debug('[System Restore v1] Downloading from S3', {
      userId,
      s3Key,
      mode,
    });

    zipBuffer = await downloadBackupFromS3(userId, s3Key);

    logger.debug('[System Restore v1] Downloaded from S3', {
      userId,
      s3Key,
      fileSize: zipBuffer.length,
    });
  } else {
    return badRequest('Unsupported content type. Use multipart/form-data or application/json');
  }

  if (!zipBuffer) {
    return badRequest('Failed to load backup data');
  }

  return { buffer: zipBuffer, mode, isPreview };
}

/**
 * POST /api/v1/system/restore - Restore from backup
 */
export const POST = createAuthenticatedHandler(async (req, { user }) => {
  const action = getActionParam(req);

  // Handle preview action
  if (action === 'preview') {
    try {
      logger.debug('[System Restore v1] Preview request', { userId: user.id });

      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const s3Key = formData.get('s3Key') as string | null;

      let zipBuffer: Buffer | null = null;

      if (file) {
        logger.debug('[System Restore v1] Preview from uploaded file', {
          userId: user.id,
          fileName: file.name,
          fileSize: file.size,
        });
        zipBuffer = Buffer.from(await file.arrayBuffer());
      } else if (s3Key) {
        logger.debug('[System Restore v1] Preview from S3', {
          userId: user.id,
          s3Key,
        });
        zipBuffer = await downloadBackupFromS3(user.id, s3Key);
      }

      if (!zipBuffer) {
        return badRequest('No file or s3Key provided');
      }

      const preview = previewRestore(zipBuffer);

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
    }
  }

  // Handle restore
  try {
    logger.debug('[System Restore v1] Restore request', { userId: user.id });

    const result = await getBackupBuffer(req, user.id);

    // If it's a NextResponse (error), return it
    if (result instanceof NextResponse) {
      return result;
    }

    const { buffer, mode, isPreview } = result;

    // If preview mode from formdata
    if (isPreview) {
      logger.info('[System Restore v1] Preview from restore endpoint', {
        userId: user.id,
        mode,
      });

      const summary = previewRestore(buffer);
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
    const summary = await restore(buffer, {
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
  }
});
