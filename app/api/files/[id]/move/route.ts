/**
 * DEPRECATED: This endpoint has been moved to /api/v1/files/{id}?action=move
 */

import { movedToV1 } from '@/lib/api/responses';

export const PATCH = () => movedToV1('/api/v1/files/{id}?action=move');
