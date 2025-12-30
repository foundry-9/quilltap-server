/**
 * Search and Replace Execute API
 *
 * POST /api/search-replace - Execute a search/replace operation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { executeSearchReplace } from '@/lib/search-replace/search-replace-service';
import { z } from 'zod';
import { logger } from '@/lib/logger';

// Validation schema for the request
// Note: 'persona' scope removed - personas are now characters with controlledBy: 'user'
const executeRequestSchema = z.object({
  scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('chat'), chatId: z.string().uuid() }),
    z.object({ type: z.literal('character'), characterId: z.string().uuid() }),
  ]),
  searchText: z.string().min(1, 'Search text is required'),
  replaceText: z.string(),
  includeMessages: z.boolean().default(true),
  includeMemories: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  try {
    logger.info('POST /api/search-replace - Executing search/replace');

    // Check authentication
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized search-replace execution attempt');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parseResult = executeRequestSchema.safeParse(body);

    if (!parseResult.success) {
      logger.warn('Invalid search-replace execute request', {
        errors: parseResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const validatedRequest = parseResult.data;

    // Execute search/replace
    const result = await executeSearchReplace(
      validatedRequest,
      session.user.id
    );

    logger.info('Search-replace execution complete', result);

    return NextResponse.json(result);
  } catch (error) {
    logger.error('Error executing search-replace', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
