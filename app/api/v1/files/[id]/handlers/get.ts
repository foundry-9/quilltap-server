import { NextRequest, NextResponse } from 'next/server';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { handleDownloadFile, handleGetThumbnail } from '../actions';

export async function handleGet(
  request: NextRequest,
  ctx: AuthenticatedContext,
  fileId: string
): Promise<NextResponse> {
  const action = getActionParam(request);

  if (action === 'thumbnail') {
    return handleGetThumbnail(request, ctx, fileId);
  }

  return handleDownloadFile(ctx, fileId);
}