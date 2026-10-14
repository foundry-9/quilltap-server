import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import type { RequestContext } from '@/lib/api/middleware';
import {
  handleCleanupStale,
  handleCleanupOrphans,
  handleGenerateThumbnails,
  handleSync,
  handleUploadFile,
} from '../actions';

export async function handlePost(
  request: NextRequest,
  ctx: RequestContext
): Promise<NextResponse> {
  return dispatchAction(request, {
    upload: () => handleUploadFile(request, ctx),
    'generate-thumbnails': () => handleGenerateThumbnails(request, ctx),
    'cleanup-stale': () => handleCleanupStale(request, ctx),
    'cleanup-orphans': () => handleCleanupOrphans(request, ctx),
    sync: () => handleSync(),
  });
}