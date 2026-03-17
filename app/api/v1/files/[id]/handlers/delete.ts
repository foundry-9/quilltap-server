import { NextRequest, NextResponse } from 'next/server';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import { handleDeleteFile } from '../actions';

export async function handleDelete(
  request: NextRequest,
  ctx: AuthenticatedContext,
  fileId: string
): Promise<NextResponse> {
  return handleDeleteFile(request, ctx, fileId);
}