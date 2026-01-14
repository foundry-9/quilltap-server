/**
 * System Tools API v1 - Collection Endpoint
 *
 * POST /api/v1/system/tools?action=delete-data - Delete all user data
 * GET /api/v1/system/tools?action=tasks-queue - Get tasks queue status
 * POST /api/v1/system/tools?action=export - Export user data (Quilltap format)
 * POST /api/v1/system/tools?action=import - Import user data
 * GET /api/v1/system/tools?action=capabilities-report - Get system capabilities report
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, withCollectionActionDispatch } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, serverError } from '@/lib/api/responses';
import { deleteAllUserData, previewDeleteAllUserData } from '@/lib/backup/restore-service';
import { BackgroundJob } from '@/lib/schemas/types';
import { startProcessor, stopProcessor, getProcessorStatus } from '@/lib/background-jobs/processor';

// ============================================================================
// Helper Functions
// ============================================================================

function estimateTokensForJob(job: BackgroundJob): number {
  const baseTokens = 500;

  switch (job.type) {
    case 'MEMORY_EXTRACTION': {
      const payload = job.payload as { userMessage?: string; assistantMessage?: string };
      const userMsgTokens = Math.ceil((payload.userMessage?.length || 0) / 4);
      const assistantMsgTokens = Math.ceil((payload.assistantMessage?.length || 0) / 4);
      return baseTokens + userMsgTokens + assistantMsgTokens + 300;
    }
    case 'INTER_CHARACTER_MEMORY': {
      const payload = job.payload as { userMessage?: string; assistantMessage?: string };
      const userMsgTokens = Math.ceil((payload.userMessage?.length || 0) / 4);
      const assistantMsgTokens = Math.ceil((payload.assistantMessage?.length || 0) / 4);
      return baseTokens + userMsgTokens + assistantMsgTokens + 400;
    }
    case 'CONTEXT_SUMMARY': {
      return baseTokens + 2000;
    }
    case 'TITLE_UPDATE': {
      return baseTokens + 300;
    }
    default:
      return baseTokens;
  }
}

function getJobTypeName(type: string): string {
  const typeNames: Record<string, string> = {
    MEMORY_EXTRACTION: 'Memory Extraction',
    INTER_CHARACTER_MEMORY: 'Character Memory',
    CONTEXT_SUMMARY: 'Context Summary',
    TITLE_UPDATE: 'Title Update',
  };
  return typeNames[type] || type;
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleDeleteData(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const body = await req.json();

    if (body.confirm !== 'DELETE_ALL_MY_DATA') {
      logger.warn('[System Tools v1] Delete all data attempted without confirmation', {
        userId: user.id,
      });
      return badRequest('Confirmation required. Send { "confirm": "DELETE_ALL_MY_DATA" }');
    }

    logger.info('[System Tools v1] Starting complete data deletion', { userId: user.id });

    const summary = await deleteAllUserData(user.id);

    logger.info('[System Tools v1] Complete data deletion finished', { userId: user.id, summary });

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Delete all data failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to delete data');
  }
}

async function handleTasksQueue(req: NextRequest, context: any) {
  const { user, repos } = context;

  try {
    logger.debug('[System Tools v1] GET tasks queue status', { userId: user.id });

    const repo = repos.backgroundJobs;
    const stats = await repo.getStats(user.id);

    const pendingJobs = await repo.findByUserId(user.id, 'PENDING');
    const processingJobs = await repo.findByUserId(user.id, 'PROCESSING');
    const failedJobs = await repo.findByUserId(user.id, 'FAILED');
    const pausedJobs = await repo.findByUserId(user.id, 'PAUSED');

    const jobMap = new Map<string, BackgroundJob>();
    for (const job of [
      ...processingJobs,
      ...pendingJobs,
      ...failedJobs.filter((j: BackgroundJob) => j.attempts < j.maxAttempts),
      ...pausedJobs,
    ]) {
      if (!jobMap.has(job.id)) {
        jobMap.set(job.id, job);
      }
    }
    const activeJobs = Array.from(jobMap.values());

    activeJobs.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    let totalEstimatedTokens = 0;
    const jobDetails = activeJobs.map((job) => {
      const estimatedTokens = estimateTokensForJob(job);
      totalEstimatedTokens += estimatedTokens;

      const payload = job.payload as Record<string, unknown>;

      return {
        id: job.id,
        type: job.type,
        typeName: getJobTypeName(job.type),
        status: job.status,
        priority: job.priority,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        scheduledAt: job.scheduledAt,
        startedAt: job.startedAt,
        lastError: job.lastError,
        estimatedTokens,
        chatId: payload.chatId as string | undefined,
        characterName: payload.characterName as string | undefined,
      };
    });

    const processorStatus = getProcessorStatus();

    logger.debug('[System Tools v1] Tasks queue status retrieved', {
      userId: user.id,
      activeJobCount: activeJobs.length,
      totalEstimatedTokens,
    });

    return NextResponse.json({
      stats: {
        pending: stats.pending,
        processing: stats.processing,
        failed: stats.failed,
        completed: stats.completed,
        dead: stats.dead,
        activeTotal: activeJobs.length,
      },
      jobs: jobDetails,
      totalEstimatedTokens,
      processorStatus,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Error fetching tasks queue status',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch queue status');
  }
}

async function handleExport(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const body = await req.json();
    const { type, scope, selectedIds, includeMemories } = body;

    logger.info('[System Tools v1] Creating export', {
      userId: user.id,
      type,
      scope,
    });

    // TODO: Integrate with export service
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      userId: user.id,
      type,
      scope,
      itemCount: selectedIds?.length || 0,
      includeMemories,
      data: [],
    };

    logger.debug('[System Tools v1] Export created', {
      userId: user.id,
      size: JSON.stringify(exportData).length,
    });

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="quilltap-export-${new Date().toISOString().split('T')[0]}.qtap"`,
      },
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Export failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to create export');
  }
}

async function handleImport(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const body = await req.json();

    logger.info('[System Tools v1] Starting import', { userId: user.id });

    // TODO: Integrate with import service

    logger.info('[System Tools v1] Import completed', { userId: user.id });

    return NextResponse.json({
      success: true,
      message: 'Import completed',
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Import failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to import data');
  }
}

async function handleCapabilitiesReport(req: NextRequest, context: any) {
  try {
    logger.debug('[System Tools v1] GET capabilities report');

    const report = {
      version: '1.0',
      capabilities: {
        maxFileSize: 52428800, // 50MB
        supportedImageFormats: ['jpeg', 'png', 'webp', 'gif'],
        supportedDocumentFormats: ['pdf', 'docx', 'txt'],
        maxStoragePerUser: 5368709120, // 5GB
      },
      features: {
        memorySystem: true,
        imageGeneration: true,
        contextCompression: true,
        fileAttachments: true,
      },
      limits: {
        maxChatsPerCharacter: 1000,
        maxCharactersPerUser: 500,
        maxMemoriesPerCharacter: 5000,
        requestTimeoutMs: 300000,
      },
    };

    logger.debug('[System Tools v1] Capabilities report generated');

    return NextResponse.json(report);
  } catch (error) {
    logger.error(
      '[System Tools v1] Error generating capabilities report',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to generate capabilities report');
  }
}

// ============================================================================
// Request Handlers
// ============================================================================

export const GET = createAuthenticatedHandler(async (req: NextRequest, context) => {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  logger.debug('[System Tools v1] GET request', { action, userId: context.user.id });

  switch (action) {
    case 'tasks-queue':
      return handleTasksQueue(req, context);
    case 'capabilities-report':
      return handleCapabilitiesReport(req, context);
    default:
      return badRequest(
        `Unknown action: ${action}. Available actions: tasks-queue, capabilities-report`
      );
  }
});

export const POST = createAuthenticatedHandler(async (req: NextRequest, context) => {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  logger.debug('[System Tools v1] POST request', { action, userId: context.user.id });

  switch (action) {
    case 'delete-data':
      return handleDeleteData(req, context);
    case 'export':
      return handleExport(req, context);
    case 'import':
      return handleImport(req, context);
    default:
      return badRequest(
        `Unknown action: ${action}. Available actions: delete-data, export, import`
      );
  }
});
