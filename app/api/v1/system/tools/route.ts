/**
 * System Tools API v1 - Collection Endpoint
 *
 * A dispatch table only; each feature lives in its own module under
 * `lib/system-tools/`, with its Zod body schemas beside its handlers.
 *
 * Delete all data — lib/system-tools/delete-data.ts
 *   GET  ?action=delete-data-preview          - Preview what will be deleted
 *   POST ?action=delete-data                  - Delete all user data
 *
 * Job queue — lib/system-tools/tasks-queue.ts
 *   GET  ?action=tasks-queue                  - Tasks queue status
 *   POST ?action=tasks-queue                  - Control the tasks queue (start/stop)
 *   GET  ?action=job-concurrency              - Global background-job concurrency cap
 *   POST ?action=job-concurrency              - Set the concurrency cap (1-32)
 *
 * Export — lib/system-tools/export.ts
 *   POST ?action=export                       - Export user data (Quilltap NDJSON stream)
 *   GET  ?action=export-entities              - Entities available for export
 *   GET  ?action=export-preview               - Preview export contents
 *
 * Import — lib/system-tools/import.ts
 *   POST ?action=import-preview               - Preview import contents
 *   POST ?action=import-execute               - Execute the import
 *
 * The Almanack — lib/system-tools/almanack-reports.ts
 *   POST ?action=capabilities-report-generate - Generate a new Almanack
 *   GET  ?action=capabilities-report-progress - Live phase progress (SSE)
 *   GET  ?action=capabilities-report-list     - List saved Almanacks
 *   GET  ?action=capabilities-report-get      - Get a specific Almanack
 *   POST ?action=capabilities-report-delete   - Delete a specific Almanack
 *
 * AI import — lib/system-tools/ai-import.ts
 *   POST ?action=ai-import-stream             - AI character import from source material (SSE)
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { handleDeleteData, handleDeleteDataPreview } from '@/lib/system-tools/delete-data';
import {
  handleTasksQueue,
  handleTasksQueueControl,
  handleJobConcurrency,
  handleJobConcurrencyControl,
} from '@/lib/system-tools/tasks-queue';
import { handleExport, handleExportEntities, handleExportPreview } from '@/lib/system-tools/export';
import { handleImportPreview, handleImportExecute } from '@/lib/system-tools/import';
import {
  handleCapabilitiesReportGenerate,
  handleCapabilitiesReportProgress,
  handleCapabilitiesReportList,
  handleCapabilitiesReportGet,
  handleCapabilitiesReportDelete,
} from '@/lib/system-tools/almanack-reports';
import { handleAIImportStream } from '@/lib/system-tools/ai-import';

export const GET = createContextHandler(async (req: NextRequest, context) =>
  dispatchAction(req, {
    'tasks-queue': () => handleTasksQueue(req, context),
    'job-concurrency': () => handleJobConcurrency(req, context),
    'delete-data-preview': () => handleDeleteDataPreview(req, context),
    'export-entities': () => handleExportEntities(req, context),
    'export-preview': () => handleExportPreview(req, context),
    'capabilities-report-list': () => handleCapabilitiesReportList(req, context),
    'capabilities-report-progress': () => handleCapabilitiesReportProgress(req, context),
    'capabilities-report-get': () => handleCapabilitiesReportGet(req, context),
  })
);

export const POST = createContextHandler(async (req: NextRequest, context) =>
  dispatchAction(req, {
    'delete-data': () => handleDeleteData(req, context),
    'tasks-queue': () => handleTasksQueueControl(req, context),
    'job-concurrency': () => handleJobConcurrencyControl(req, context),
    'export': () => handleExport(req, context),
    'import-preview': () => handleImportPreview(req, context),
    'import-execute': () => handleImportExecute(req, context),
    'capabilities-report-generate': () => handleCapabilitiesReportGenerate(req, context),
    'capabilities-report-delete': () => handleCapabilitiesReportDelete(req, context),
    'ai-import-stream': () => handleAIImportStream(req, context),
  })
);
