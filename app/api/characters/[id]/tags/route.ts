/**
 * DEPRECATED: This endpoint has been moved to /api/v1/characters/[id]?action=add-tag or ?action=remove-tag
 */
import { movedToV1 } from '@/lib/api/responses'

export const POST = () => movedToV1('/api/v1/characters/[id]', 'action=add-tag or action=remove-tag')
export const DELETE = () => movedToV1('/api/v1/characters/[id]', 'action=remove-tag')
