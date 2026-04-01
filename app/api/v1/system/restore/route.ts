/**
 * System Restore API v1
 *
 * POST /api/v1/system/restore - Restore data from a backup
 * POST /api/v1/system/restore?action=preview - Preview backup contents
 *
 * Accepts multipart/form-data with file and mode
 */

import { NextRequest, NextResponse } from 'next/server';
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
 * Parse request and get the ZIP buffer from file upload
 */
async function getBackupBuffer(
  req: NextRequest
): Promise<{ buffer: Buffer; mode: 'replace' | 'new-account'; isPreview?: boolean } | NextResponse> {
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
  const zipBuffer = Buffer.from(await file.arrayBuffer());

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
      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return badRequest('No file provided');
      }

      const zipBuffer = Buffer.from(await file.arrayBuffer());
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
    const result = await getBackupBuffer(req);

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
