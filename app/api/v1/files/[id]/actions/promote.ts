import { NextRequest, NextResponse } from 'next/server';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse, validationError } from '@/lib/api/responses';
import { z } from 'zod';
import { formatValidationIssues, normalizeAndValidateFolderPath } from '../../shared';
import { buildManagedFileResponse, promoteFileSchema } from '../shared';

export async function handlePromoteFile(
  request: NextRequest,
  ctx: AuthenticatedContext,
  fileId: string,
  _file: any
): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = promoteFileSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest(`Invalid request: ${formatValidationIssues(parsed.error)}`);
    }

    const { targetProjectId, folderPath: rawFolderPath } = parsed.data;
    const folderResult = normalizeAndValidateFolderPath(rawFolderPath || '/');
    if (!folderResult.success) {
      return badRequest(folderResult.error);
    }

    if (targetProjectId) {
      const project = await ctx.repos.projects.findById(targetProjectId);
      if (!project || project.userId !== ctx.user.id) {
        return notFound('Project');
      }
    }

    const updated = await ctx.repos.files.update(fileId, {
      projectId: targetProjectId ?? null,
      folderPath: folderResult.folderPath,
    });

    if (!updated) {
      return notFound('File');
    }

    logger.info('[Files v1] File promoted successfully', {
      fileId,
      targetProjectId,
      folderPath: folderResult.folderPath,
    });

    return successResponse({
      data: buildManagedFileResponse(updated),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Files v1] Error promoting file', { fileId }, error instanceof Error ? error : undefined);
    return serverError('Failed to promote file');
  }
}