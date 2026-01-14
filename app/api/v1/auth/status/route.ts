/**
 * Auth API v1 - Auth Status Endpoint
 *
 * GET /api/v1/auth/status - Check authentication status and auth mode
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { isAuthDisabled } from '@/lib/auth/config';
import { logger } from '@/lib/logger';
import { successResponse } from '@/lib/api/responses';

// ============================================================================
// GET Handler
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const authDisabled = isAuthDisabled();
    const session = await getServerSession();

    logger.debug('[Auth v1] Status check', {
      authDisabled,
      authenticated: !!session,
    });

    return successResponse({
      authDisabled,
      authenticated: !!session,
      user: session?.user || null,
      expires: session?.expires || null,
    });
  } catch (error) {
    logger.error(
      '[Auth v1] Error checking auth status',
      {},
      error instanceof Error ? error : undefined
    );

    // Still return auth disabled status even on error
    return successResponse({
      authDisabled: isAuthDisabled(),
      authenticated: false,
      user: null,
      expires: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
