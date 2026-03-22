/**
 * Help Docs API v1 - Individual Document Endpoint
 *
 * GET /api/v1/help-docs/[id] - Get a single help document with content
 */

import { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { successResponse, notFound, serverError } from '@/lib/api/responses';
import { getHelpSearch } from '@/lib/help-search';

const logger = createServiceLogger('HelpDocRoute');

const HELP_BUNDLE_PATH = join(process.cwd(), 'public', 'help-bundle.msgpack.gz');

/**
 * Ensure the help bundle is loaded
 */
async function ensureHelpBundleLoaded(): Promise<void> {
  const helpSearch = getHelpSearch();

  if (helpSearch.isLoaded()) {
    logger.debug('[HelpDoc] Help bundle already loaded');
    return;
  }

  logger.debug('[HelpDoc] Loading help bundle from disk', { bundlePath: HELP_BUNDLE_PATH });

  try {
    const buffer = await readFile(HELP_BUNDLE_PATH);
    await helpSearch.loadFromBuffer(buffer);
    logger.info('[HelpDoc] Help bundle loaded successfully');
  } catch (error) {
    logger.error('[HelpDoc] Failed to load help bundle', {}, error instanceof Error ? error : undefined);
    throw new Error('Failed to load help bundle');
  }
}

/**
 * Extract document ID from the URL pathname
 */
function extractDocumentId(pathname: string): string {
  const segments = pathname.split('/');
  return segments[segments.length - 1];
}

/**
 * GET /api/v1/help-docs/[id] - Get a single help document with content
 */
export const GET = createAuthenticatedHandler(async (request: NextRequest, _context: AuthenticatedContext) => {
  try {
    const docId = extractDocumentId(request.nextUrl.pathname);

    logger.debug('[HelpDoc] Getting document', { documentId: docId });

    await ensureHelpBundleLoaded();

    const helpSearch = getHelpSearch();
    const document = helpSearch.getDocument(docId);

    if (!document) {
      logger.warn('[HelpDoc] Document not found', { documentId: docId });
      return notFound('Help document');
    }

    logger.info('[HelpDoc] Document retrieved', {
      documentId: docId,
      title: document.title,
    });

    return successResponse({
      document: {
        id: document.id,
        title: document.title,
        path: document.path,
        url: document.url,
        content: document.content,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Failed to load help bundle') {
      logger.error('[HelpDoc] Error loading help bundle', {}, error);
      return serverError('Failed to load help documents');
    }

    logger.error('[HelpDoc] Error getting document', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to get help document');
  }
});
