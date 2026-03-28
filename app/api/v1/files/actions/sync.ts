import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { serverError, successResponse } from '@/lib/api/responses';

export async function handleSync(): Promise<NextResponse> {
  try {
    logger.info('[Files v1] Triggering filesystem sync (reconciliation)');

    const { reconcileFilesystem } = await import('@/lib/file-storage/reconciliation');
    await reconcileFilesystem();

    logger.info('[Files v1] Filesystem sync completed');
    return successResponse({ message: 'Filesystem sync completed' });
  } catch (error) {
    logger.error(
      '[Files v1] Error during filesystem sync',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to sync filesystem');
  }
}