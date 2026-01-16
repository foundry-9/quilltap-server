/**
 * Legacy Image Profile Generation API Route (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * POST /api/v1/image-profiles/[id]?action=generate - Generate images with placeholder support
 */

import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/image-profiles/[id]', 'action=generate');
