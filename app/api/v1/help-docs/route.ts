/**
 * Help Docs API v1 - Collection Endpoint
 *
 * GET /api/v1/help-docs - List all help documents (metadata only)
 * GET /api/v1/help-docs?action=chat-count - Get salon chat count for current user
 */

import { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { successResponse, serverError } from '@/lib/api/responses';
import { getHelpSearch } from '@/lib/help-search';

const logger = createServiceLogger('HelpDocsRoute');

const HELP_BUNDLE_PATH = join(process.cwd(), 'public', 'help-bundle.msgpack.gz');

/**
 * Ensure the help bundle is loaded
 */
async function ensureHelpBundleLoaded(): Promise<void> {
  const helpSearch = getHelpSearch();

  if (helpSearch.isLoaded()) {
    logger.debug('[HelpDocs] Help bundle already loaded');
    return;
  }

  logger.debug('[HelpDocs] Loading help bundle from disk', { bundlePath: HELP_BUNDLE_PATH });

  try {
    const buffer = await readFile(HELP_BUNDLE_PATH);
    await helpSearch.loadFromBuffer(buffer);
    logger.info('[HelpDocs] Help bundle loaded successfully');
  } catch (error) {
    logger.error('[HelpDocs] Failed to load help bundle', {}, error instanceof Error ? error : undefined);
    throw new Error('Failed to load help bundle');
  }
}

/**
 * Handle GET /api/v1/help-docs - List all help documents
 */
async function handleList(_request: NextRequest, _context: AuthenticatedContext) {
  try {
    logger.debug('[HelpDocs] Listing all help documents');

    await ensureHelpBundleLoaded();

    const helpSearch = getHelpSearch();
    const documents = helpSearch.listDocuments();

    logger.info('[HelpDocs] Listed help documents', { documentCount: documents.length });

    return successResponse({ documents });
  } catch (error) {
    logger.error('[HelpDocs] Error listing help documents', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to load help documents');
  }
}

/**
 * Handle GET /api/v1/help-docs?action=chat-count - Get salon chat count
 */
async function handleChatCount(_request: NextRequest, context: AuthenticatedContext) {
  try {
    const { user, repos } = context;

    logger.debug('[HelpDocs] Getting chat count for user', { userId: user.id });

    const allChats = await repos.chats.findByUserId(user.id);

    // Filter to salon chats (exclude help chats and other types)
    const salonChats = allChats.filter(
      (chat) => !chat.chatType || chat.chatType === 'salon'
    );

    logger.debug('[HelpDocs] Chat count calculated', {
      userId: user.id,
      totalChats: allChats.length,
      salonChats: salonChats.length,
    });

    return successResponse({ count: salonChats.length });
  } catch (error) {
    logger.error('[HelpDocs] Error getting chat count', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to get chat count');
  }
}

/**
 * GET /api/v1/help-docs or /api/v1/help-docs?action=chat-count
 */
export const GET = createAuthenticatedHandler(async (request: NextRequest, context: AuthenticatedContext) => {
  const action = getActionParam(request);

  logger.debug('[HelpDocs] GET request', { action });

  if (action === 'chat-count') {
    return handleChatCount(request, context);
  }

  return handleList(request, context);
});
