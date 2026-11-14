/**
 * System Tools — Quilltap (`.qtap`) import: preview and execute.
 *
 * Served by `app/api/v1/system/tools/route.ts`:
 *   POST ?action=import-preview  - preview an upload (multipart `file`, or JSON `{ exportData }`)
 *   POST ?action=import-execute  - run the import (multipart `file` + `options`, or JSON `{ exportData, options }`)
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { RequestContext } from '@/lib/api/middleware';
import { badRequest, serverError, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import {
  previewImport,
  executeImport,
  type QuilltapExport,
  type ConflictStrategy,
} from '@/lib/import/quilltap-import-service';
import { peekFormat, readNdjsonLines, collectLegacyJson } from '@/lib/import/ndjson-reader';
import { assembleExportFromStream } from '@/lib/import/quilltap-import-stream';

// ============================================================================
// Schemas
// ============================================================================

/**
 * An inline export document. Its manifest is checked by `validateExportFile`
 * (the same check an uploaded file gets), so this only demands an object.
 */
const inlineExportDataSchema = z.custom<QuilltapExport>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { error: 'Missing required field: exportData' }
);

/** Import options, from the JSON body or the multipart `options` field. */
export const importExecuteOptionsSchema = z.object(
  {
    conflictStrategy: z.enum(['skip', 'replace', 'overwrite', 'duplicate'], {
      error: 'Invalid conflictStrategy. Must be one of: skip, replace, overwrite, duplicate',
    }),
    importMemories: z.boolean().nullish(),
    selectedIds: z.record(z.string(), z.array(z.string())).nullish(),
  },
  { error: 'Missing required field: options' }
);

/** POST ?action=import-preview JSON body (the legacy, non-multipart path). */
export const importPreviewBodySchema = z.object({
  exportData: inlineExportDataSchema,
});

/** POST ?action=import-execute JSON body (the non-multipart path). */
export const importExecuteBodySchema = z.object({
  exportData: inlineExportDataSchema,
  options: importExecuteOptionsSchema,
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Legacy monolithic .qtap files still get loaded into a single string for
 * `JSON.parse` — we cap them at ~450 MB because V8's max string length is
 * ~512 MB and we want headroom. Anything bigger must be re-exported from a
 * Quilltap version that writes the streaming NDJSON format. NDJSON files
 * have no whole-file cap (we only cap per-line size in the reader).
 */
const MAX_LEGACY_IMPORT_BYTES = 450 * 1024 * 1024;

/**
 * Load a `.qtap` upload as a `QuilltapExport`, detecting streaming NDJSON vs
 * legacy monolithic JSON transparently. `input` may be either a `File`
 * (multipart upload) or a `NextRequest` whose body is the raw `.qtap` bytes.
 */
async function loadQtapFromUpload(
  input: { stream(): ReadableStream<Uint8Array> } | ReadableStream<Uint8Array>
): Promise<QuilltapExport> {
  const body: ReadableStream<Uint8Array> =
    input instanceof ReadableStream ? input : input.stream();
  const { format, stream } = await peekFormat(body);

  if (format === 'ndjson') {
    return assembleExportFromStream(readNdjsonLines(stream));
  }

  const text = await collectLegacyJson(stream, MAX_LEGACY_IMPORT_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return parsed as QuilltapExport;
}

function validateExportFile(data: unknown): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const exported = data as Record<string, unknown>;
  if (!exported.manifest || typeof exported.manifest !== 'object') {
    return false;
  }

  const manifest = exported.manifest as Record<string, unknown>;
  if (manifest.format !== 'quilltap-export' || manifest.version !== '1.0') {
    return false;
  }

  return true;
}

// ============================================================================
// Handlers
// ============================================================================

export async function handleImportPreview(req: NextRequest, context: RequestContext) {
  const { user } = context;

  try {
    const contentType = req.headers.get('content-type') || '';
    let exportData: QuilltapExport;

    logger.info('[System Tools v1] Processing import preview request', {
      userId: user.id,
      contentType,
    });

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');

      if (!file || typeof file === 'string') {
        logger.warn('[System Tools v1] Import preview missing file', { userId: user.id });
        return badRequest('No file provided');
      }

      try {
        exportData = await loadQtapFromUpload(file);
      } catch (err) {
        logger.warn('[System Tools v1] Import preview file load failed', {
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return badRequest(err instanceof Error ? err.message : 'Failed to read export file');
      }
    } else {
      // Legacy JSON-body path — kept for older clients. The frontend uploads
      // via multipart for anything non-trivial.
      exportData = importPreviewBodySchema.parse(await req.json()).exportData;
    }

    if (!validateExportFile(exportData)) {
      logger.warn('[System Tools v1] Invalid export file format', { userId: user.id });
      return badRequest('Invalid export file format. Expected quilltap-export v1.0 format.');
    }

    logger.info('[System Tools v1] Export file validated', {
      userId: user.id,
      exportType: exportData.manifest.exportType,
    });

    const preview = await previewImport(user.id, exportData);
    return successResponse(preview);
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    logger.error(
      '[System Tools v1] Import preview failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to preview import');
  }
}

export async function handleImportExecute(req: NextRequest, context: RequestContext) {
  const { user } = context;

  try {
    const contentType = req.headers.get('content-type') || '';
    let exportData: QuilltapExport;
    let options: z.infer<typeof importExecuteOptionsSchema>;

    logger.debug('[System Tools v1] Processing import execute request', {
      userId: user.id,
      contentType,
    });

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');
      const optionsStr = formData.get('options');

      if (!file || typeof file === 'string') {
        logger.warn('[System Tools v1] Import execute missing file', { userId: user.id });
        return badRequest('No file provided');
      }

      try {
        exportData = await loadQtapFromUpload(file);
      } catch (err) {
        logger.warn('[System Tools v1] Import execute file load failed', {
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return badRequest(err instanceof Error ? err.message : 'Failed to read export file');
      }

      let rawOptions: unknown;
      if (typeof optionsStr === 'string' && optionsStr) {
        try {
          rawOptions = JSON.parse(optionsStr);
        } catch {
          return badRequest('Invalid JSON: Failed to parse options');
        }
      }
      options = importExecuteOptionsSchema.parse(rawOptions);
    } else {
      const body = importExecuteBodySchema.parse(await req.json());
      exportData = body.exportData;
      options = body.options;
    }

    const { conflictStrategy, importMemories, selectedIds } = options;

    // Map 'replace' to 'overwrite' for the import service (legacy compat)
    const mappedConflictStrategy: ConflictStrategy =
      conflictStrategy === 'replace' ? 'overwrite' : conflictStrategy;

    logger.info('[System Tools v1] Starting import execution', {
      userId: user.id,
      exportType: exportData.manifest.exportType,
      conflictStrategy: mappedConflictStrategy,
      importMemories: importMemories || false,
    });

    const result = await executeImport(user.id, exportData, {
      conflictStrategy: mappedConflictStrategy,
      includeMemories: importMemories || false,
      includeRelatedEntities: false,
      selectedIds: selectedIds ?? undefined,
    });

    logger.info('[System Tools v1] Import completed', {
      userId: user.id,
      success: result.success,
      imported: result.imported,
      skipped: result.skipped,
      warningCount: result.warnings.length,
      importedCharacterIdCount: result.importedCharacterIds.length,
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    logger.error(
      '[System Tools v1] Import execution failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to execute import');
  }
}
