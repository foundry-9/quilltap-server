/**
 * Files API v1 - Folders Collection Endpoint
 *
 * GET /api/v1/files/folders - List all folders for a user/project
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, serverError } from '@/lib/api/responses';

// ============================================================================
// GET Handler - List folders
// ============================================================================

export const GET = createAuthenticatedHandler(async (request, { user, repos }) => {
  try {
    logger.debug('[Files v1] GET list folders', { userId: user.id });

    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get('projectId');

    // Get all folders for this user
    let folders = await repos.folders.findByUserId(user.id);

    // Filter by project if provided
    if (projectId) {
      folders = folders.filter(f => f.projectId === projectId);
    }

    // Sort by path
    folders.sort((a, b) => a.path.localeCompare(b.path));

    logger.info('[Files v1] Retrieved folder list', { userId: user.id, folderCount: folders.length });

    return successResponse({
      data: folders.map(folder => ({
        id: folder.id,
        userId: folder.userId,
        path: folder.path,
        name: folder.name,
        projectId: folder.projectId,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      })),
    });
  } catch (error) {
    logger.error('[Files v1] Error listing folders', { userId: (request as any).user?.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to list folders');
  }
});
