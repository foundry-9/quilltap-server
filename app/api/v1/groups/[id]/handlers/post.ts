/**
 * Groups API v1 - POST Handler
 *
 * POST /api/v1/groups/[id]?action=addMember - Add character to group
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { handleAddMember } from '../actions';
import type { RequestContext } from '@/lib/api/middleware';


/**
 * POST handler for individual group
 */
export async function handlePost(
  req: NextRequest,
  ctx: RequestContext,
  groupId: string
): Promise<NextResponse> {
  return dispatchAction(req, {
    addMember: () => handleAddMember(req, groupId, ctx),
  });
}
