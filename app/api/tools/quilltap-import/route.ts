/**
 * Quilltap Import Preview API Route
 *
 * POST /api/tools/quilltap-import - Preview import file contents and detect conflicts
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { badRequest, serverError } from '@/lib/api/responses';
import { previewImport, type QuilltapExport } from '@/lib/import/quilltap-import-service';

// Max file size: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Helper function to validate JSON export file
 */
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

/**
 * Parse and validate export file from JSON string or Buffer
 */
function parseExportFile(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error('Invalid JSON: Failed to parse export file');
  }
}

/**
 * POST /api/tools/quilltap-import
 * Preview import contents: accepts FormData with file OR JSON body with exportData
 *
 * FormData request:
 * - file: File (required) - The .qtap or .json export file
 *
 * JSON request:
 * {
 *   exportData: QuilltapExport (required)
 * }
 *
 * Response:
 * {
 *   manifest: { ... },
 *   entities: { [entityType]: Array of { id, name/title, exists: boolean } },
 *   warnings: string[]
 * }
 */
export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const contentType = req.headers.get('content-type') || '';
    let exportData: unknown;

    logger.info('Processing Quilltap import preview request', {
      context: 'POST /api/tools/quilltap-import',
      userId: user.id,
      contentType,
    });

    if (contentType.includes('multipart/form-data')) {
      // Handle FormData with file upload
      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        logger.warn('Quilltap import preview missing file', {
          context: 'POST /api/tools/quilltap-import',
          userId: user.id,
        });
        return badRequest('No file provided');
      }

      if (file.size > MAX_FILE_SIZE) {
        logger.warn('Quilltap import file too large', {
          context: 'POST /api/tools/quilltap-import',
          userId: user.id,
          fileSize: file.size,
          maxSize: MAX_FILE_SIZE,
        });
        return badRequest(`File too large (max ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB)`);
      }

      logger.debug('Reading uploaded export file', {
        context: 'POST /api/tools/quilltap-import',
        userId: user.id,
        fileName: file.name,
        fileSize: file.size,
      });

      const text = await file.text();
      exportData = parseExportFile(text);
    } else {
      // Handle JSON body
      const body = await req.json();

      if (!body.exportData) {
        logger.warn('Quilltap import preview missing exportData', {
          context: 'POST /api/tools/quilltap-import',
          userId: user.id,
        });
        return badRequest('Missing required field: exportData');
      }

      exportData = body.exportData;
    }

    // Validate export file
    if (!validateExportFile(exportData)) {
      logger.warn('Invalid export file format', {
        context: 'POST /api/tools/quilltap-import',
        userId: user.id,
      });
      return badRequest('Invalid export file format. Expected quilltap-export v1.0 format.');
    }

    const exported = exportData as QuilltapExport;

    logger.info('Export file validated', {
      context: 'POST /api/tools/quilltap-import',
      userId: user.id,
      exportType: exported.manifest.exportType,
    });

    const preview = await previewImport(user.id, exported);

    logger.debug('Quilltap import preview generated', {
      context: 'POST /api/tools/quilltap-import',
      userId: user.id,
      entityTypes: Object.keys(preview.entities),
      conflictCounts: preview.conflictCounts,
    });

    return NextResponse.json(preview);
  } catch (error) {
    logger.error(
      'Quilltap import preview failed',
      { context: 'POST /api/tools/quilltap-import' },
      error instanceof Error ? error : undefined
    );
    return serverError(getErrorMessage(error, 'Failed to preview import'));
  }
});
