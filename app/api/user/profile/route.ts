/**
 * Legacy User Profile API (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * GET /api/v1/user/profile - Get current user's profile
 * PUT /api/v1/user/profile - Update current user's profile
 */

import { movedToV1 } from '@/lib/api/responses';

export const GET = () => movedToV1('/api/v1/user/profile');
export const PUT = () => movedToV1('/api/v1/user/profile');
