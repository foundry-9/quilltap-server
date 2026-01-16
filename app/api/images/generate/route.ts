/**
 * Legacy Image Generation API Route (DEPRECATED)
 *
 * This endpoint has been moved to v1:
 * POST /api/v1/images?action=generate - Generate images using LLM providers
 */

import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/images', 'action=generate');
