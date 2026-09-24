/**
 * Projects API v1 - PUT Handler
 *
 * PUT /api/v1/projects/[id] - Update project
 * PUT /api/v1/projects/[id]?action=set-state - Set project state
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { handlePutDefault, handleSetState, handlePutAesthetic } from '../actions';
import type { RequestContext } from '@/lib/api/middleware';


/**
 * PUT handler for individual project
 */
export async function handlePut(
  req: NextRequest,
  ctx: RequestContext,
  projectId: string
): Promise<NextResponse> {
  return dispatchAction(
    req,
    {
      'set-state': () => handleSetState(req, projectId, ctx),
      aesthetic: () => handlePutAesthetic(req, projectId, ctx),
    },
    () => handlePutDefault(req, projectId, ctx)
  );
}
