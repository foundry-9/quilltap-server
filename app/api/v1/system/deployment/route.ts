/**
 * System Deployment API v1
 *
 * GET /api/v1/system/deployment - Returns deployment information
 */

import { NextResponse } from 'next/server';
import { isUserManaged } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/system/deployment
 * Returns deployment information including whether this is a user-managed (self-hosted) deployment.
 * This endpoint is unauthenticated as it's needed during app initialization.
 */
export async function GET() {return NextResponse.json({
    isUserManaged,
    // isHosted is the inverse - true if this is a hosted/cloud deployment
    isHosted: !isUserManaged,
  });
}
