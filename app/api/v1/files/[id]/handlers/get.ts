import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { handleDownloadFile, handleGetThumbnail } from '../actions';

export async function handleGet(
  request: NextRequest,
  ctx: RequestContext,
  fileId: string
): Promise<NextResponse> {
  return dispatchAction(
    request,
    { thumbnail: () => handleGetThumbnail(request, ctx, fileId) },
    () => handleDownloadFile(ctx, fileId, request)
  );
}