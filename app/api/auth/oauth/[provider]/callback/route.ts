/**
 * DEPRECATED: This endpoint has been moved to /api/v1/auth/oauth/[provider]/callback
 */

import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/auth/oauth/[provider]/callback')
