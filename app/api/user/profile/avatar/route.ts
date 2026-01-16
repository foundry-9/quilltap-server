/**
 * Legacy User Profile Avatar API (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * PATCH /api/v1/user/profile?action=set-avatar - Set or clear profile avatar
 */

import { movedToV1 } from '@/lib/api/responses';

export const PATCH = () => movedToV1('/api/v1/user/profile', 'action=set-avatar');
