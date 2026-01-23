/**
 * Legacy API Key Validation Endpoint (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * POST /api/v1/image-profiles?action=validate-key - Validate an API key for image generation
 */

import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/image-profiles', 'action=validate-key');
