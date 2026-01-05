/**
 * General Files API Route
 *
 * GET /api/files/general - List user's general (non-project) files
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { logger } from '@/lib/logger';
import { serverError } from '@/lib/api/responses';

/**
 * GET /api/files/general
 * List files that are not associated with any project
 */
export const GET = createAuthenticatedHandler(
  async (_request, { user, repos }) => {
    const log = logger.child({
      module: 'api-files-general',
      userId: user.id,
    });

    try {
      log.debug('Fetching general files');

      // Get all user's files that have no project
      const allFiles = await repos.files.findAll();
      const generalFiles = allFiles.filter(f => f.projectId === null || f.projectId === undefined);

      // Sort by createdAt descending
      generalFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Enrich with URL
      const enrichedFiles = generalFiles.map(file => ({
        id: file.id,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        size: file.size,
        category: file.category,
        description: file.description,
        folderPath: file.folderPath || '/',
        width: file.width,
        height: file.height,
        filepath: getFilePath(file),
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      }));

      log.debug('Retrieved general files', { count: enrichedFiles.length });

      return NextResponse.json({ files: enrichedFiles });
    } catch (error) {
      log.error('Error fetching general files', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch general files');
    }
  }
);
