/**
 * Groups API v1 - PUT Handler
 *
 * PUT /api/v1/groups/[id] - Update group
 */

import { NextRequest, NextResponse } from 'next/server';
import { handlePutDefault } from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * PUT handler for individual group
 */
export async function handlePut(
  req: NextRequest,
  ctx: AuthenticatedContext,
  groupId: string
): Promise<NextResponse> {
  return handlePutDefault(req, groupId, ctx);
}
