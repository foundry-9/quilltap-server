import { NextRequest, NextResponse } from 'next/server';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, forbidden, serverError, successResponse, validationError } from '@/lib/api/responses';
import { z } from 'zod';
import {
  ensureFileWritePermission,
  formatValidationIssues,
  normalizeAndValidateFolderPath,
  saveFileEntry,
  serializeFileEntry,
  writeFileSchema,
} from '../shared';

export async function handleWriteFile(
  request: NextRequest,
  ctx: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = writeFileSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest(`Invalid request: ${formatValidationIssues(parsed.error)}`);
    }

    const { filename, content, mimeType, projectId, folderPath: rawFolderPath } = parsed.data;
    const targetProjectId = projectId ?? null;
    const folderResult = normalizeAndValidateFolderPath(rawFolderPath);

    if (!folderResult.success) {
      return badRequest(folderResult.error);
    }

    const canWrite = await ensureFileWritePermission(ctx, targetProjectId);
    if (!canWrite) {
      logger.info('[Files v1] Write permission denied', {
        projectId: targetProjectId,
        userId: ctx.user.id,
      });
      return forbidden('File write permission required. Please grant permission first.');
    }

    const { fileEntry, statusCode } = await saveFileEntry({
      ctx,
      filename,
      contentBuffer: Buffer.from(content, 'utf-8'),
      mimeType,
      projectId: targetProjectId,
      folderPath: folderResult.folderPath,
      category: 'DOCUMENT',
      linkedTo: [],
      tags: [],
      overwriteLogMessage: '[Files v1] File overwritten successfully',
      createLogMessage: '[Files v1] File written successfully',
    });

    return successResponse(
      {
        data: serializeFileEntry(fileEntry),
      },
      statusCode
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error(
      '[Files v1] Error writing file',
      { userId: ctx.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to write file');
  }
}