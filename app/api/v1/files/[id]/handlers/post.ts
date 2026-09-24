import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { notFound } from '@/lib/api/responses';
import { handleMoveFile, handlePromoteFile } from '../actions';

export async function handlePost(
  request: NextRequest,
  ctx: RequestContext,
  fileId: string
): Promise<NextResponse> {
  const file = await ctx.repos.files.findById(fileId);
  if (!file || file.userId !== ctx.user.id) {
    return notFound('File');
  }

  return dispatchAction(request, {
    move: () => handleMoveFile(request, ctx, fileId, file),
    promote: () => handlePromoteFile(request, ctx, fileId, file),
  });
}