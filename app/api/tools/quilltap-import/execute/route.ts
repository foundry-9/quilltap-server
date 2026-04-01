/**
 * Quilltap Import Execute API Route
 *
 * POST /api/tools/quilltap-import/execute - Execute the actual import operation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { executeImport, type ConflictStrategy } from '@/lib/import/quilltap-import-service';

/**
 * Maximum execution time for large imports (5 minutes)
 */
export const maxDuration = 300;

/**
 * POST /api/tools/quilltap-import/execute
 * Execute the actual import with specified options
 *
 * Request body:
 * {
 *   exportData: QuilltapExport (required),
 *   options: {
 *     selectedIds?: {
 *       characters?: string[],
 *       personas?: string[],
 *       chats?: string[],
 *       roleplayTemplates?: string[],
 *       connectionProfiles?: string[],
 *       imageProfiles?: string[],
 *       tags?: string[]
 *     },
 *     conflictStrategy: 'skip' | 'replace' | 'duplicate' (required),
 *     importMemories: boolean (required)
 *   }
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   imported: { characters: n, personas: n, chats: n, ... },
 *   skipped: { characters: n, personas: n, chats: n, ... },
 *   warnings: string[]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Quilltap import execute attempted without authentication', {
        context: 'POST /api/tools/quilltap-import/execute',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { exportData, options } = body;

    if (!exportData) {
      logger.warn('Quilltap import execute missing exportData', {
        context: 'POST /api/tools/quilltap-import/execute',
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: 'Missing required field: exportData' },
        { status: 400 }
      );
    }

    if (!options) {
      logger.warn('Quilltap import execute missing options', {
        context: 'POST /api/tools/quilltap-import/execute',
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: 'Missing required field: options' },
        { status: 400 }
      );
    }

    const { conflictStrategy, importMemories, selectedIds } = options;

    if (!conflictStrategy || !['skip', 'replace', 'duplicate'].includes(conflictStrategy)) {
      logger.warn('Quilltap import execute invalid conflict strategy', {
        context: 'POST /api/tools/quilltap-import/execute',
        userId: session.user.id,
        conflictStrategy,
      });
      return NextResponse.json(
        {
          error:
            'Invalid conflictStrategy. Must be one of: skip, replace, duplicate',
        },
        { status: 400 }
      );
    }

    const manifest = (exportData as Record<string, unknown>).manifest as Record<string, unknown>;

    // Map 'replace' to 'overwrite' for the import service
    const mappedConflictStrategy: ConflictStrategy =
      conflictStrategy === 'replace' ? 'overwrite' : conflictStrategy;

    logger.info('Starting Quilltap import execution', {
      context: 'POST /api/tools/quilltap-import/execute',
      userId: session.user.id,
      exportType: manifest.exportType,
      conflictStrategy: mappedConflictStrategy,
      importMemories: importMemories || false,
    });

    const result = await executeImport(
      session.user.id,
      exportData,
      {
        conflictStrategy: mappedConflictStrategy,
        includeMemories: importMemories || false,
        includeRelatedEntities: false,
        selectedIds,
      }
    );

    logger.info('Quilltap import completed', {
      context: 'POST /api/tools/quilltap-import/execute',
      userId: session.user.id,
      success: result.success,
      imported: result.imported,
      skipped: result.skipped,
      warningCount: result.warnings.length,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error(
      'Quilltap import execution failed',
      { context: 'POST /api/tools/quilltap-import/execute' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to execute import') },
      { status: 500 }
    );
  }
}
