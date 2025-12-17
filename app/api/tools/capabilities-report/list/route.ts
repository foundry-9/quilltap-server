/**
 * Capabilities Report List API
 *
 * GET /api/tools/capabilities-report/list
 * Lists all saved capabilities reports for the user
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { s3FileService } from '@/lib/s3/file-service';
import { getFileMetadata } from '@/lib/s3/operations';
import { getErrorMessage } from '@/lib/errors';

const moduleLogger = logger.child({ module: 'api:capabilities-report:list' });

export interface ReportInfo {
  id: string;
  filename: string;
  s3Key: string;
  createdAt: string;
  size: number;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    moduleLogger.info('Listing capabilities reports', { userId });

    // List all files in the REPORT category
    const keys = await s3FileService.listUserFiles(userId, 'REPORT');

    // Get metadata for each file
    const reports: ReportInfo[] = [];

    for (const s3Key of keys) {
      try {
        const metadata = await getFileMetadata(s3Key);
        if (!metadata) continue;

        // Parse the filename to extract info
        // Format: users/{userId}/REPORT/{reportId}_{filename}
        const parts = s3Key.split('/');
        const filenamePart = parts[parts.length - 1];
        const underscoreIndex = filenamePart.indexOf('_');

        const reportId = underscoreIndex > 0 ? filenamePart.substring(0, underscoreIndex) : filenamePart;
        const filename = underscoreIndex > 0 ? filenamePart.substring(underscoreIndex + 1) : filenamePart;

        reports.push({
          id: reportId,
          filename,
          s3Key,
          createdAt: metadata.lastModified.toISOString(),
          size: metadata.size,
        });
      } catch (error) {
        moduleLogger.warn('Failed to get metadata for report', { s3Key, error });
      }
    }

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
}
