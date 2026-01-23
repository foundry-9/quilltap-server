/**
 * Legacy Theme Preference API Routes (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * GET  /api/v1/user/profile?action=theme-preference - Get user's theme preference
 * PUT  /api/v1/user/profile?action=theme-preference - Update user's theme preference
 */

import { movedToV1 } from '@/lib/api/responses';

export const GET = () => movedToV1('/api/v1/user/profile', 'action=theme-preference');
export const PUT = () => movedToV1('/api/v1/user/profile', 'action=theme-preference');
