/**
 * Sample Prompts API
 *
 * GET /api/sample-prompts - Load sample prompts directly from prompts/ directory files
 * This returns raw file content without requiring database seeding.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { loadSamplePrompts } from '@/lib/prompts/sample-prompts-loader';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access attempt to GET /api/sample-prompts');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.debug('Loading sample prompts from files', { userId: session.user.id });

    const samples = await loadSamplePrompts();

    logger.debug('Loaded sample prompts', {
      count: samples.length,
      userId: session.user.id,
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
}
