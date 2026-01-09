/**
 * Capabilities Report Generation API
 *
 * POST /api/tools/capabilities-report/generate
 * Generates a new capabilities report and saves it to S3
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { generateAndSaveReport } from '@/lib/tools/capabilities-report';
import { getRepositories } from '@/lib/repositories/factory';
import { getErrorMessage } from '@/lib/errors';

const moduleLogger = logger.child({ module: 'api:capabilities-report:generate' });

export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    const userId = user.id;
    moduleLogger.info('Generating capabilities report', { userId });

    const result = await generateAndSaveReport(userId);

    // Create a file entry in the database for the report
    // This allows the report to be tracked and managed through the file system
    const fileEntry = await repos.files.create({
      userId,
      originalFilename: result.filename,
      mimeType: 'text/markdown',
      size: Buffer.byteLength(result.content, 'utf-8'),
      storageKey: result.s3Key,
      category: 'DOCUMENT',
      sha256: '',
      folderPath: '/reports',
      source: 'SYSTEM',
      projectId: null,
      linkedTo: [],
      generationPrompt: null,
      generationModel: null,
      generationRevisedPrompt: null,
      description: 'System-generated capabilities report',
      tags: [],
    });

    moduleLogger.info('Capabilities report generated successfully', {
      userId,
      reportId: result.reportId,
      filename: result.filename,
      size: result.size,
      fileEntryId: fileEntry.id,
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
});
