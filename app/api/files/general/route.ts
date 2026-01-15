/**
 * DEPRECATED: This endpoint has been moved to /api/v1/files?filter=general
 */

import { movedToV1 } from '@/lib/api/responses';

export const GET = () => movedToV1('/api/v1/files?filter=general');
