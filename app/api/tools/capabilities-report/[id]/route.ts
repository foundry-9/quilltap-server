/**
 * DEPRECATED - Capabilities Report API - Get/Delete (Legacy Route)
 * This route has been moved to /api/v1/system/tools?action=capabilities-report-get|delete
 *
 * 410 Gone - Endpoint permanently removed
 */

import { movedToV1 } from '@/lib/api/responses'

export async function GET() {
  return movedToV1('/api/v1/system/tools?action=capabilities-report-get&reportId={id}')
}

export async function DELETE() {
  return movedToV1('/api/v1/system/tools?action=capabilities-report-delete', 'Send POST with reportId in body')
}
