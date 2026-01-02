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
import { downloadFile, deleteFile, listFiles } from '@/lib/s3/operations';
import { validateS3Config } from '@/lib/s3/config';
import { getErrorMessage } from '@/lib/errors';
import { notFound, serverError } from '@/lib/api/responses';

const moduleLogger = logger.child({ module: 'api:capabilities-report:id' });

/**
 * Find the S3 key for a report by ID
 */
async function findReportS3Key(userId: string, reportId: string): Promise<string | null> {
  const config = validateS3Config();
  const prefix = config.pathPrefix || '';
  const reportPrefix = `${prefix}users/${userId}/REPORT/${reportId}_`;

  const keys = await listFiles(reportPrefix, 10);
  return keys.length > 0 ? keys[0] : null;
}

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user }, { id: reportId }) => {
    try {
      const userId = user.id;

      moduleLogger.info('Getting capabilities report', { userId, reportId });

      // Find the report S3 key
      const s3Key = await findReportS3Key(userId, reportId);
      if (!s3Key) {
        return notFound('Report');
      }

      // Download the report content
      const buffer = await downloadFile(s3Key);
      const content = buffer.toString('utf-8');

      // Extract filename from key
      const parts = s3Key.split('/');
      const filenamePart = parts[parts.length - 1];
      const underscoreIndex = filenamePart.indexOf('_');
      const filename = underscoreIndex > 0 ? filenamePart.substring(underscoreIndex + 1) : filenamePart;

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
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(buffer.length),
          },
        });
      }

      return NextResponse.json({
        reportId,
        filename,
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
  async (req, { user }, { id: reportId }) => {
    try {
      const userId = user.id;

      moduleLogger.info('Deleting capabilities report', { userId, reportId });

      // Find the report S3 key
      const s3Key = await findReportS3Key(userId, reportId);
      if (!s3Key) {
        return notFound('Report');
      }

      // Delete the report
      await deleteFile(s3Key);

      moduleLogger.info('Deleted capabilities report', { userId, reportId, s3Key });

      return NextResponse.json({ success: true });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      moduleLogger.error('Failed to delete capabilities report', { error: errorMessage }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete report');
    }
  }
);
