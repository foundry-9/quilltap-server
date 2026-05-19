/**
 * Startup Status API v1
 *
 * GET /api/v1/system/startup-status - Returns the live state of server startup.
 *
 * Drives the loading-screen UI. Combines coarse phase from `startupState`
 * with the event stream + current label + sub-progress from `startupProgress`.
 *
 * **Unauthenticated.** The loading screen runs before any session exists, so
 * we cannot gate this on auth. For Quilltap's local-first single-user model
 * that's acceptable; the only data exposed is generic "what the server is
 * doing right now" — no user data leaks.
 */

import { NextResponse } from 'next/server';
import { startupState } from '@/lib/startup/startup-state';
import { startupProgress } from '@/lib/startup/progress';
import { serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = startupState.getStats();
    const snapshot = startupProgress.snapshot();

    return NextResponse.json(
      {
        phase: stats.phase,
        isReady: stats.isReady,
        isLockedMode: stats.isLockedMode,
        startedAt: stats.startTime,
        readyAt: stats.readyTime,
        errorMessage: stats.error,
        currentLabel: snapshot.currentLabel,
        currentRawLabel: snapshot.currentRawLabel,
        currentSubProgress: snapshot.currentSubProgress,
        recentEvents: snapshot.recentEvents,
        versionGuardBlock: stats.versionGuardBlock,
        instanceLockConflict: stats.instanceLockConflict,
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    logger.error(
      'Error getting startup status',
      { context: 'api.v1.system.startup-status.GET' },
      error instanceof Error ? error : new Error(String(error))
    );
    return serverError('Failed to get startup status');
  }
}
