import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import { badRequest } from '@/lib/api/responses';
import {
  handleCleanupOrphaned,
  handleGenerateThumbnails,
  handleSync,
  handleUploadFile,
  handleWriteFile,
} from '../actions';
import { FILE_POST_ACTIONS, type FilePostAction } from '../shared';

export async function handlePost(
  request: NextRequest,
  ctx: AuthenticatedContext
): Promise<NextResponse> {
  const action = getActionParam(request);

  if (!isValidAction(action, FILE_POST_ACTIONS)) {
    return badRequest(
      `Unknown action: ${action}. Available actions: ${FILE_POST_ACTIONS.join(', ')}`
    );
  }

  const actionHandlers: Record<FilePostAction, () => Promise<NextResponse>> = {
    write: () => handleWriteFile(request, ctx),
    upload: () => handleUploadFile(request, ctx),
    'generate-thumbnails': () => handleGenerateThumbnails(request, ctx),
    'cleanup-orphaned': () => handleCleanupOrphaned(request, ctx),
    sync: () => handleSync(),
  };

  return actionHandlers[action]();
}