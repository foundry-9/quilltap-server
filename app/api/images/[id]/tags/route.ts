/**
 * Legacy Image Tags API Routes (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * POST   /api/v1/images/[id]?action=add-tag - Add tag to image
 * POST   /api/v1/images/[id]?action=remove-tag - Remove tag from image
 */

import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/images/[id]', 'action=add-tag');
export const DELETE = () => movedToV1('/api/v1/images/[id]', 'action=remove-tag');
