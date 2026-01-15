/**
 * DEPRECATED: This endpoint has been moved to /api/v1/files/write-permissions
 */

import { movedToV1 } from '@/lib/api/responses';

export const GET = () => movedToV1('/api/v1/files/write-permissions');
export const POST = () => movedToV1('/api/v1/files/write-permissions');
