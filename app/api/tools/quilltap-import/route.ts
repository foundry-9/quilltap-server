/**
 * Quilltap Import Preview API Route
 *
 * POST /api/tools/quilltap-import - Preview import file contents and detect conflicts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';

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
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Quilltap import preview attempted without authentication', {
        context: 'POST /api/tools/quilltap-import',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';
    let exportData: unknown;

    logger.info('Processing Quilltap import preview request', {
      context: 'POST /api/tools/quilltap-import',
      userId: session.user.id,
      contentType,
    });

    if (contentType.includes('multipart/form-data')) {
      // Handle FormData with file upload
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        logger.warn('Quilltap import preview missing file', {
          context: 'POST /api/tools/quilltap-import',
          userId: session.user.id,
        });
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }

      if (file.size > MAX_FILE_SIZE) {
        logger.warn('Quilltap import file too large', {
          context: 'POST /api/tools/quilltap-import',
          userId: session.user.id,
          fileSize: file.size,
          maxSize: MAX_FILE_SIZE,
        });
        return NextResponse.json(
          { error: `File too large (max ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB)` },
          { status: 400 }
        );
      }

      logger.debug('Reading uploaded export file', {
        context: 'POST /api/tools/quilltap-import',
        userId: session.user.id,
        fileName: file.name,
        fileSize: file.size,
      });

      const text = await file.text();
      exportData = parseExportFile(text);
    } else {
      // Handle JSON body
      const body = await request.json();

      if (!body.exportData) {
        logger.warn('Quilltap import preview missing exportData', {
          context: 'POST /api/tools/quilltap-import',
          userId: session.user.id,
        });
        return NextResponse.json(
          { error: 'Missing required field: exportData' },
          { status: 400 }
        );
      }

      exportData = body.exportData;
    }

    // Validate export file
    if (!validateExportFile(exportData)) {
      logger.warn('Invalid export file format', {
        context: 'POST /api/tools/quilltap-import',
        userId: session.user.id,
      });
      return NextResponse.json(
        {
          error: 'Invalid export file format. Expected quilltap-export v1.0 format.',
        },
        { status: 400 }
      );
    }

    const exported = exportData as Record<string, unknown>;
    const manifest = exported.manifest;
    const data = exported.data || {};

    logger.info('Export file validated', {
      context: 'POST /api/tools/quilltap-import',
      userId: session.user.id,
      exportType: (manifest as Record<string, unknown>).exportType,
    });

    // TODO: Implement previewImport from lib/import/quilltap-import-service
    // This should:
    // 1. Check which entities already exist in the user's database
    // 2. Build preview with conflict indicators
    // 3. Return structured preview for UI

    const preview = {
      manifest,
      entities: {
        // TODO: Populate with actual entity lists and conflict detection
        // Example structure:
        // characters: [
        //   { id: '123', name: 'Alice', exists: true },
        //   { id: '456', name: 'Bob', exists: false }
        // ]
      },
      warnings: [],
    };

    logger.debug('Quilltap import preview generated', {
      context: 'POST /api/tools/quilltap-import',
      userId: session.user.id,
    });

    return NextResponse.json(preview);
  } catch (error) {
    logger.error(
      'Quilltap import preview failed',
      { context: 'POST /api/tools/quilltap-import' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to preview import') },
      { status: 500 }
    );
  }
}
