/**
 * Quilltap Export API Routes
 *
 * POST /api/tools/quilltap-export - Create and download export
 * GET /api/tools/quilltap-export/preview - Preview export contents
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { createExport, previewExport } from '@/lib/export/quilltap-export-service';
import type { ExportEntityType } from '@/lib/export/types';

/**
 * Helper function to generate export filename with timestamp
 */
function generateExportFilename(exportType: string): string {
  const timestamp = new Date().toISOString().split('T')[0];
  const sanitizedType = exportType.replace(/_/g, '-');
  return `quilltap-${sanitizedType}-${timestamp}.qtap`;
}

/**
 * POST /api/tools/quilltap-export
 * Create export with specified options and return file for download
 *
 * Request body:
 * {
 *   type: 'characters' | 'personas' | 'chats' | 'roleplay-templates' | 'connection-profiles' | 'image-profiles' | 'tags',
 *   scope: 'all' | 'selected',
 *   selectedIds?: string[],
 *   includeMemories?: boolean
 * }
 *
 * Response:
 * JSON export data (with Content-Disposition header for download)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Quilltap export attempted without authentication', {
        context: 'POST /api/tools/quilltap-export',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type, scope, selectedIds, includeMemories } = body;

    logger.info('Creating Quilltap export', {
      context: 'POST /api/tools/quilltap-export',
      userId: session.user.id,
      type,
      scope,
      selectedIdsCount: selectedIds?.length || 0,
      includeMemories: includeMemories || false,
    });

    // Create export using the export service
    const exportData = await createExport(session.user.id, {
      type: type as ExportEntityType,
      scope: scope || 'all',
      selectedIds,
      includeMemories: includeMemories || false,
    });

    logger.debug('Quilltap export created', {
      context: 'POST /api/tools/quilltap-export',
      userId: session.user.id,
      type,
      exportDataSize: JSON.stringify(exportData).length,
    });

    const filename = generateExportFilename(type);

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error(
      'Quilltap export failed',
      { context: 'POST /api/tools/quilltap-export' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to create export') },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tools/quilltap-export/preview
 * Preview what would be exported without creating the full export
 *
 * Query parameters:
 * - type: 'characters' | 'personas' | 'chats' | 'roleplay-templates' | 'connection-profiles' | 'image-profiles' | 'tags'
 * - scope: 'all' | 'selected'
 * - selectedIds: comma-separated string of IDs (optional)
 * - includeMemories: 'true' or 'false' (optional)
 *
 * Response:
 * {
 *   entities: { [entityType]: { count: number, names: string[] } },
 *   totalSize: number (estimated),
 *   warnings: string[]
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Quilltap export preview attempted without authentication', {
        context: 'GET /api/tools/quilltap-export/preview',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const scope = searchParams.get('scope') || 'all';
    const selectedIdsParam = searchParams.get('selectedIds');
    const includeMemories = searchParams.get('includeMemories') === 'true';

    const selectedIds = selectedIdsParam ? selectedIdsParam.split(',').filter(Boolean) : [];

    if (!type) {
      logger.warn('Quilltap export preview missing type parameter', {
        context: 'GET /api/tools/quilltap-export/preview',
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: 'Missing required parameter: type' },
        { status: 400 }
      );
    }

    logger.info('Previewing Quilltap export', {
      context: 'GET /api/tools/quilltap-export/preview',
      userId: session.user.id,
      type,
      scope,
      selectedIdsCount: selectedIds.length,
      includeMemories,
    });

    // Generate preview using the export service
    const preview = await previewExport(session.user.id, {
      type: type as ExportEntityType,
      scope: scope as 'all' | 'selected',
      selectedIds,
      includeMemories,
    });

    logger.debug('Quilltap export preview generated', {
      context: 'GET /api/tools/quilltap-export/preview',
      userId: session.user.id,
      type,
      entityCount: preview.entities.length,
    });

    return NextResponse.json(preview);
  } catch (error) {
    logger.error(
      'Quilltap export preview failed',
      { context: 'GET /api/tools/quilltap-export/preview' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to preview export') },
      { status: 500 }
    );
  }
}
