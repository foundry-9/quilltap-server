/**
 * System Tools — The Almanack (the system report): generate, progress, list,
 * get and delete.
 *
 * Served by `app/api/v1/system/tools/route.ts`:
 *   POST ?action=capabilities-report-generate  - generate and save a new Almanack
 *   GET  ?action=capabilities-report-progress  - live phase progress (SSE)
 *   GET  ?action=capabilities-report-list      - list saved Almanacks
 *   GET  ?action=capabilities-report-get       - one Almanack (JSON, or `download=true`)
 *   POST ?action=capabilities-report-delete    - delete one Almanack
 *
 * The `capabilities-report-*` action names are deliberately unchanged: The
 * Almanack is the feature's name, not the route's, and renaming the actions
 * would break saved links and bookmarks to buy nothing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'crypto';
import type { RequestContext } from '@/lib/api/middleware';
import { buildContentDisposition } from '@/lib/api/content-disposition';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { generateAndSaveAlmanack } from '@/lib/tools/almanack';
import type { CoreProgressEvent } from '@/lib/progress/operation-progress';
import { operationProgressSseResponse } from '@/lib/progress/operation-progress-sse';
import { fileStorageManager } from '@/lib/file-storage/manager';

const REPORTS_FOLDER = '/reports';

// ============================================================================
// Schemas
// ============================================================================

/**
 * POST ?action=capabilities-report-generate body. Optional as a whole — the
 * card only sends one when it is watching — but a body that is sent must
 * match.
 */
export const almanackGenerateBodySchema = z.object({
  progressId: z.uuid().optional(),
});

/** POST ?action=capabilities-report-delete body. */
export const almanackDeleteBodySchema = z.object({
  reportId: z.string({ error: 'Missing reportId' }).min(1, 'Missing reportId'),
});

// ============================================================================
// Handlers
// ============================================================================

/**
 * The Almanack progress side-channel: `GET ?action=capabilities-report-progress&id=<progressId>`.
 *
 * The generate POST must keep returning JSON (the card reads the rendered
 * report straight out of the body), so phase progress travels separately on the
 * shared operation-progress bus, keyed by a client-supplied correlation id.
 *
 * The bus buffers per id, which is what lets the card be collapsed and reopened
 * mid-run and still re-attach: the new reader replays the backlog, including a
 * terminal `done`/`error` if the run already finished.
 */
export async function handleCapabilitiesReportProgress(req: NextRequest, context: RequestContext) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return badRequest('Missing progress id');
  }

  logger.debug('[System Tools v1] Attaching Almanack progress reader', {
    userId: context.user.id,
    progressId: id,
  });

  return operationProgressSseResponse<CoreProgressEvent>(id, req);
}

export async function handleCapabilitiesReportGenerate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  // Optional correlation id for the progress side-channel. Mirrors the
  // chat-creation flow; absent means the run is simply untracked.
  const text = await req.text().catch(() => '');
  let rawBody: unknown = {};
  if (text.trim()) {
    try {
      rawBody = JSON.parse(text);
    } catch {
      return badRequest('Invalid JSON body');
    }
  }
  const progressId = almanackGenerateBodySchema.parse(rawBody ?? {}).progressId ?? null;

  try {
    logger.info('[System Tools v1] Generating Almanack', { userId: user.id, tracked: !!progressId });

    const result = await generateAndSaveAlmanack(user.id, {
      progressId,
      // The `files` row is created here, and its id is what list/get/delete key
      // off — so it is what comes back as `reportId`. Minting a separate UUID
      // (as this used to) handed the dialog an id nothing could resolve, and
      // the Download link on a freshly generated report 404'd.
      persist: async ({ filename, storageKey, size, content }) => {
        const fileEntry = await repos.files.create({
          userId: user.id,
          originalFilename: filename,
          mimeType: 'text/markdown',
          size,
          storageKey,
          category: 'DOCUMENT',
          sha256: createHash('sha256').update(content, 'utf-8').digest('hex'),
          folderPath: REPORTS_FOLDER,
          source: 'SYSTEM',
          projectId: null,
          linkedTo: [],
          generationPrompt: null,
          generationModel: null,
          generationRevisedPrompt: null,
          description: 'The Almanack — system report',
          tags: [],
        });
        return fileEntry.id;
      },
    });

    logger.info('[System Tools v1] Almanack generated successfully', {
      userId: user.id,
      reportId: result.reportId,
      filename: result.filename,
      size: result.size,
    });

    return successResponse({
      success: true,
      reportId: result.reportId,
      filename: result.filename,
      storageKey: result.storageKey,
      size: result.size,
      content: result.content,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Failed to generate Almanack',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to generate report');
  }
}

export async function handleCapabilitiesReportList(_req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    logger.info('[System Tools v1] Listing capabilities reports', { userId: user.id });

    // List all files in the DOCUMENT category from /reports folder
    const allDocuments = await repos.files.findByCategory('DOCUMENT');
    const reportFiles = allDocuments.filter((f) => f.folderPath === REPORTS_FOLDER);

    // Convert to ReportInfo format
    const reports = reportFiles.map((file) => ({
      id: file.id,
      filename: file.originalFilename,
      storageKey: file.storageKey || '',
      createdAt: file.createdAt,
      size: file.size || 0,
    }));

    // Sort by creation date, newest first
    reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    logger.info('[System Tools v1] Listed capabilities reports', {
      userId: user.id,
      count: reports.length,
    });

    return successResponse({ reports });
  } catch (error) {
    logger.error(
      '[System Tools v1] Failed to list capabilities reports',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to list reports');
  }
}

export async function handleCapabilitiesReportGet(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const { searchParams } = req.nextUrl;
    const reportId = searchParams.get('reportId');
    const download = searchParams.get('download') === 'true';

    if (!reportId) {
      return badRequest('Missing reportId parameter');
    }

    logger.info('[System Tools v1] Getting capabilities report', { userId: user.id, reportId });

    // Find the report file in the database from DOCUMENT category
    const allDocuments = await repos.files.findByCategory('DOCUMENT');
    const reportFile = allDocuments.find((f) => f.id === reportId && f.folderPath === REPORTS_FOLDER);

    if (!reportFile) {
      return notFound('Report');
    }

    // Download the report content
    const buffer = await fileStorageManager.downloadFile(reportFile);
    const content = buffer.toString('utf-8');

    logger.info('[System Tools v1] Retrieved capabilities report', {
      userId: user.id,
      reportId,
      size: buffer.length,
    });

    if (download) {
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown',
          'Content-Disposition': buildContentDisposition(reportFile.originalFilename, 'attachment'),
          'Content-Length': String(buffer.length),
        },
      });
    }

    return successResponse({
      reportId,
      filename: reportFile.originalFilename,
      content,
      size: buffer.length,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Failed to get capabilities report',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to get report');
  }
}

export async function handleCapabilitiesReportDelete(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const { reportId } = almanackDeleteBodySchema.parse(await req.json());

    logger.info('[System Tools v1] Deleting capabilities report', { userId: user.id, reportId });

    // Find the report file in the database from DOCUMENT category
    const allDocuments = await repos.files.findByCategory('DOCUMENT');
    const reportFile = allDocuments.find((f) => f.id === reportId && f.folderPath === REPORTS_FOLDER);

    if (!reportFile) {
      return notFound('Report');
    }

    // Delete the report from storage
    await fileStorageManager.deleteFile(reportFile);

    // Delete the file entry from database
    await repos.files.delete(reportFile.id);

    logger.info('[System Tools v1] Deleted capabilities report', { userId: user.id, reportId });

    return successResponse({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    logger.error(
      '[System Tools v1] Failed to delete capabilities report',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to delete report');
  }
}
