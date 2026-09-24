/**
 * Groups API v1 - PUT Handler
 *
 * PUT /api/v1/groups/[id] - Update group
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { handlePutDefault, handleSetState } from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * PUT handler for individual group
 *
 * PUT /api/v1/groups/[id]                 - Update group
 * PUT /api/v1/groups/[id]?action=set-state - Set group state
 */
export async function handlePut(
  req: NextRequest,
  ctx: RequestContext,
  groupId: string
): Promise<NextResponse> {
  return dispatchAction(
    req,
    { 'set-state': () => handleSetState(req, groupId, ctx) },
    () => handlePutDefault(req, groupId, ctx)
  );
}
