/**
 * Capabilities Report API - Get/Delete
 *
 * GET /api/tools/capabilities-report/[id]
 * Returns the content of a specific report
 *
 * DELETE /api/tools/capabilities-report/[id]
 * Deletes a specific report
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { getErrorMessage } from '@/lib/errors';
import { notFound, serverError } from '@/lib/api/responses';

const moduleLogger = logger.child({ module: 'api:capabilities-report:id' });

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: reportId }) => {
    try {
      const userId = user.id;

      moduleLogger.info('Getting capabilities report', { userId, reportId });

      // Find the report file in the database from DOCUMENT category
      const allDocuments = await repos.files.findByCategory('DOCUMENT');
      const reportFile = allDocuments.find((f) => f.id === reportId && f.folderPath === '/reports');

      if (!reportFile) {
        return notFound('Report');
      }

      // Download the report content
      const buffer = await fileStorageManager.downloadFile(reportFile);
      const content = buffer.toString('utf-8');

      moduleLogger.info('Retrieved capabilities report', {
        userId,
        reportId,
        size: buffer.length,
      });

      // Check if download is requested
      const url = new URL(req.url);
      const download = url.searchParams.get('download') === 'true';

      if (download) {
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            'Content-Type': 'text/markdown',
            'Content-Disposition': `attachment; filename="${reportFile.originalFilename}"`,
            'Content-Length': String(buffer.length),
          },
        });
      }

      return NextResponse.json({
        reportId,
        filename: reportFile.originalFilename,
        content,
        size: buffer.length,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      moduleLogger.error('Failed to get capabilities report', { error: errorMessage }, error instanceof Error ? error : undefined);
      return serverError('Failed to get report');
    }
  }
);

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: reportId }) => {
    try {
      const userId = user.id;

      moduleLogger.info('Deleting capabilities report', { userId, reportId });

      // Find the report file in the database from DOCUMENT category
      const allDocuments = await repos.files.findByCategory('DOCUMENT');
      const reportFile = allDocuments.find((f) => f.id === reportId && f.folderPath === '/reports');

      if (!reportFile) {
        return notFound('Report');
      }

      // Delete the report from storage
      await fileStorageManager.deleteFile(reportFile);

      // Delete the file entry from database
      await repos.files.delete(reportFile.id);

      moduleLogger.info('Deleted capabilities report', { userId, reportId });

      return NextResponse.json({ success: true });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      moduleLogger.error('Failed to delete capabilities report', { error: errorMessage }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete report');
    }
  }
);
