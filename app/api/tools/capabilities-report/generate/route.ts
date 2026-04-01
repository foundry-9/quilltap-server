/**
 * Capabilities Report Generation API
 *
 * POST /api/tools/capabilities-report/generate
 * Generates a new capabilities report and saves it to S3
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { generateAndSaveReport } from '@/lib/tools/capabilities-report';
import { getErrorMessage } from '@/lib/errors';

const moduleLogger = logger.child({ module: 'api:capabilities-report:generate' });

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    moduleLogger.info('Generating capabilities report', { userId });

    const result = await generateAndSaveReport(userId);

    moduleLogger.info('Capabilities report generated successfully', {
      userId,
      reportId: result.reportId,
      filename: result.filename,
      size: result.size,
    });

    return NextResponse.json({
      success: true,
      reportId: result.reportId,
      filename: result.filename,
      s3Key: result.s3Key,
      size: result.size,
      content: result.content,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    moduleLogger.error('Failed to generate capabilities report', { error: errorMessage }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      { error: 'Failed to generate report', details: errorMessage },
      { status: 500 }
    );
  }
}
