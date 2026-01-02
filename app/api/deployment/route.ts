import { NextResponse } from 'next/server';
import { isUserManaged } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * GET /api/deployment
 * Returns deployment information including whether this is a user-managed (self-hosted) deployment
 */
export async function GET() {
  logger.debug('Deployment info requested', {
    context: 'deployment-GET',
    isUserManaged,
  });

  return NextResponse.json({
    isUserManaged,
    // isHosted is the inverse - true if this is a hosted/cloud deployment
    isHosted: !isUserManaged,
  });
}
