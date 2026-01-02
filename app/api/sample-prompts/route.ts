/**
 * Sample Prompts API
 *
 * GET /api/sample-prompts - Load sample prompts directly from prompts/ directory files
 * This returns raw file content without requiring database seeding.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { loadSamplePrompts } from '@/lib/prompts/sample-prompts-loader';
import { logger } from '@/lib/logger';

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user }: AuthenticatedContext) => {
  try {
    logger.debug('Loading sample prompts from files', { userId: user.id });

    const samples = await loadSamplePrompts();

    logger.debug('Loaded sample prompts', {
      count: samples.length,
      userId: user.id,
    });

    return NextResponse.json(samples);
  } catch (error) {
    logger.error('Error loading sample prompts', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to load sample prompts' },
      { status: 500 }
    );
  }
});
