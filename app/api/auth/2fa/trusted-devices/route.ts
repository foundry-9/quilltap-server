/**
 * DEPRECATED: This endpoint has been moved to /api/v1/auth/2fa/trusted-devices
 */

import { movedToV1 } from '@/lib/api/responses'

export const GET = () => movedToV1('/api/v1/auth/2fa/trusted-devices')
export const POST = () => movedToV1('/api/v1/auth/2fa/trusted-devices')
export const DELETE = () => movedToV1('/api/v1/auth/2fa/trusted-devices')
