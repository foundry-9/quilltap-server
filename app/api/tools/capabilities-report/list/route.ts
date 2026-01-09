/**
 * Capabilities Report List API
 *
 * GET /api/tools/capabilities-report/list
 * Lists all saved capabilities reports for the user
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';

const moduleLogger = logger.child({ module: 'api:capabilities-report:list' });

export interface ReportInfo {
  id: string;
  filename: string;
  storageKey: string;
  createdAt: string;
  size: number;
}

export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    const userId = user.id;
    moduleLogger.info('Listing capabilities reports', { userId });

    // List all files in the DOCUMENT category from /reports folder
    const allDocuments = await repos.files.findByCategory('DOCUMENT');
    const reportFiles = allDocuments.filter((f) => f.folderPath === '/reports');

    // Convert to ReportInfo format
    const reports: ReportInfo[] = reportFiles.map((file) => ({
      id: file.id,
      filename: file.originalFilename,
      storageKey: file.storageKey || '',
      createdAt: file.createdAt, // Already a string from TimestampSchema
      size: file.size || 0,
    }));

    // Sort by creation date, newest first
    reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    moduleLogger.info('Listed capabilities reports', {
      userId,
      count: reports.length,
    });

    return NextResponse.json({ reports });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    moduleLogger.error('Failed to list capabilities reports', { error: errorMessage }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      { error: 'Failed to list reports', details: errorMessage },
      { status: 500 }
    );
  }
});
