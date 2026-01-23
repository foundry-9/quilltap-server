/**
 * DEPRECATED: This endpoint has been moved to /api/v1/files?action=write
 */

import { movedToV1 } from '@/lib/api/responses';

export const POST = () => movedToV1('/api/v1/files?action=write');
