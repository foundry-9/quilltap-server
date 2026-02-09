/**
 * Session API Route (Single-User Mode)
 *
 * GET /api/v1/session - Returns the current user session
 *
 * In single-user mode, this always returns the single user's session.
 */

import { createContextHandler } from '@/lib/api/middleware';
import { successResponse } from '@/lib/api/responses';

/**
 * GET /api/v1/session
 *
 * Returns the current user session.
 * In single-user mode, always returns the single user's session.
 */
export const GET = createContextHandler(async (_request, { session }) => {
  return successResponse({
    user: session.user,
    expires: session.expires,
  });
});
