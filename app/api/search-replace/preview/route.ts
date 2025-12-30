/**
 * Search and Replace Preview API
 *
 * POST /api/search-replace/preview - Get preview counts for a search/replace operation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getSearchReplacePreview } from '@/lib/search-replace/search-replace-service';
import { z } from 'zod';
import { logger } from '@/lib/logger';

// Validation schema for the request
// Note: 'persona' scope removed - personas are now characters with controlledBy: 'user'
const previewRequestSchema = z.object({
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
    logger.debug('POST /api/search-replace/preview - Getting preview');

    // Check authentication
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized search-replace preview attempt');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parseResult = previewRequestSchema.safeParse(body);

    if (!parseResult.success) {
      logger.warn('Invalid search-replace preview request', {
        errors: parseResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const validatedRequest = parseResult.data;

    // Get preview counts
    const preview = await getSearchReplacePreview(
      validatedRequest,
      session.user.id
    );

    logger.debug('Search-replace preview complete', preview);

    return NextResponse.json(preview);
  } catch (error) {
    logger.error('Error getting search-replace preview', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
