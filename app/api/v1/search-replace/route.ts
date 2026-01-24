/**
 * Search and Replace API Routes (v1)
 *
 * POST /api/v1/search-replace?action=execute - Execute a search/replace operation
 * POST /api/v1/search-replace?action=preview - Get preview counts for a search/replace operation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { withCollectionActionDispatch } from '@/lib/api/middleware/actions';
import { executeSearchReplace, getSearchReplacePreview } from '@/lib/search-replace/search-replace-service';
import { badRequest, serverError } from '@/lib/api/responses';
import { z } from 'zod';
import { logger } from '@/lib/logger';

// Validation schema for the request
// Note: 'persona' scope removed - personas are now characters with controlledBy: 'user'
const searchReplaceSchema = z.object({
  scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('chat'), chatId: z.uuid() }),
    z.object({ type: z.literal('character'), characterId: z.uuid() }),
  ]),
  searchText: z.string().min(1, 'Search text is required'),
  replaceText: z.string(),
  includeMessages: z.boolean().prefault(true),
  includeMemories: z.boolean().prefault(true),
});

/**
 * Handle POST ?action=execute
 * Execute a search/replace operation
 */
async function handleExecute(
  request: NextRequest,
  ctx: AuthenticatedContext
): Promise<NextResponse> {
  logger.info('POST /api/v1/search-replace?action=execute - Executing search/replace');

  // Parse and validate request body
  const body = await request.json();
  const parseResult = searchReplaceSchema.safeParse(body);

  if (!parseResult.success) {
    logger.warn('Invalid search-replace execute request', {
      errors: parseResult.error.issues,
    });
    return badRequest('Invalid request');
  }

  const validatedRequest = parseResult.data;

  // Execute search/replace
  const result = await executeSearchReplace(
    validatedRequest,
    ctx.user.id
  );

  logger.info('Search-replace execution complete', result);

  return NextResponse.json(result);
}

/**
 * Handle POST ?action=preview
 * Get preview counts for a search/replace operation
 */
async function handlePreview(
  request: NextRequest,
  ctx: AuthenticatedContext
): Promise<NextResponse> {
  logger.debug('POST /api/v1/search-replace?action=preview - Getting preview');

  // Parse and validate request body
  const body = await request.json();
  const parseResult = searchReplaceSchema.safeParse(body);

  if (!parseResult.success) {
    logger.warn('Invalid search-replace preview request', {
      errors: parseResult.error.issues,
    });
    return badRequest('Invalid request');
  }

  const validatedRequest = parseResult.data;

  // Get preview counts
  const preview = await getSearchReplacePreview(
    validatedRequest,
    ctx.user.id
  );

  logger.debug('Search-replace preview complete', preview);

  return NextResponse.json(preview);
}

/**
 * POST /api/v1/search-replace
 * Requires action parameter: execute or preview
 */
export const POST = createAuthenticatedHandler(
  withCollectionActionDispatch(
    {
      execute: handleExecute,
      preview: handlePreview,
    },
    // No default handler - action is required
    async () => badRequest('Action parameter required: execute or preview')
  )
);
