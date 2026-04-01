/**
 * DEPRECATED - Plugin Configuration API (Legacy Route)
 * GET has been moved to /api/v1/plugins/[name]?action=get-config
 * PUT has been moved to /api/v1/plugins/[name]?action=set-config
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/plugins/[name]', 'action=get-config')
}

export async function PUT() {
  return movedToV1('/api/v1/plugins/[name]', 'action=set-config')
}
