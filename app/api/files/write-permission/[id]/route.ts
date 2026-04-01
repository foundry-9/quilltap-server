/**
 * DEPRECATED: This endpoint has been moved to /api/v1/files/write-permissions?action=revoke
 */

import { movedToV1 } from '@/lib/api/responses';

export const DELETE = () => movedToV1('/api/v1/files/write-permissions?action=revoke');
