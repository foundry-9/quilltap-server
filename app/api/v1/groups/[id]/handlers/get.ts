/**
 * Groups API v1 - GET Handler
 *
 * GET /api/v1/groups/[id] - Get group details
 * GET /api/v1/groups/[id]?action=members - List member characters
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import {
  handleGetDefault,
  handleGetMembers,
  handleGetState,
} from '../actions';
import type { RequestContext } from '@/lib/api/middleware';


/**
 * GET handler for individual group
 */
export async function handleGet(
  req: NextRequest,
  ctx: RequestContext,
  groupId: string
): Promise<NextResponse> {
  return dispatchAction(
    req,
    {
      members: () => handleGetMembers(groupId, ctx),
      'get-state': () => handleGetState(groupId, ctx),
    },
    () => handleGetDefault(groupId, ctx)
  );
}
