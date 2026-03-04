/**
 * Database Unlock API v1
 *
 * GET /api/v1/system/unlock - Returns database key state
 * POST /api/v1/system/unlock?action=setup - First-run setup
 * POST /api/v1/system/unlock?action=unlock - Unlock with passphrase
 * POST /api/v1/system/unlock?action=store - Store env var pepper in .dbkey file
 *
 * This endpoint is unauthenticated because it must be accessible before
 * the app is fully operational (during locked mode and initial setup).
 *
 * Replaces the pepper-vault endpoint with .dbkey file-based key management.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, serverError, unauthorized } from '@/lib/api/responses';

export const dynamic = 'force-dynamic';

const unlockLogger = logger.child({ module: 'api-unlock' });

/**
 * GET /api/v1/system/unlock
 *
 * Returns the current database key state.
 */
export async function GET() {
  try {
    const { startupState } = await import('@/lib/startup/startup-state');
    const { getDbKeyState } = await import('@/lib/startup/dbkey');

    // startupState is the authoritative source (set during instrumentation.ts)
    const state = startupState.getPepperState?.() ?? getDbKeyState();

    return NextResponse.json({ state });
  } catch (error) {
    unlockLogger.error('Error getting database key status', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to get database key status');
  }
}

/**
 * POST /api/v1/system/unlock?action=setup|unlock|store
 *
 * Dispatches database key actions.
 */
export async function POST(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action');

  if (!action) {
    return badRequest('Missing action parameter. Use ?action=setup, ?action=unlock, or ?action=store');
  }

  try {
    const body = await request.json();
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';

    switch (action) {
      case 'setup':
        return handleSetup(passphrase);
      case 'unlock':
        return handleUnlock(passphrase);
      case 'store':
        return handleStore(passphrase);
      default:
        return badRequest(`Unknown action: ${action}`);
    }
  } catch (error) {
    unlockLogger.error('Error in database key action', {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError(error instanceof Error ? error.message : 'Internal server error');
  }
}

/**
 * Handle first-run setup: generate pepper, encrypt, write .dbkey
 */
async function handleSetup(passphrase: string): Promise<NextResponse> {
  unlockLogger.info('Database key setup requested');

  const { setupDbKey } = await import('@/lib/startup/dbkey');
  const { startupState } = await import('@/lib/startup/startup-state');

  const result = setupDbKey(passphrase);
  startupState.setPepperState('resolved');

  unlockLogger.info('Database key setup complete');

  // Return the pepper once for the user to save
  return NextResponse.json({
    success: true,
    pepper: result.pepper,
    message: 'Encryption key generated and stored. Save this value — it will not be displayed again.',
  });
}

/**
 * Handle unlock: decrypt .dbkey file with passphrase, then resume startup
 */
async function handleUnlock(passphrase: string): Promise<NextResponse> {
  unlockLogger.info('Database key unlock requested');

  if (!passphrase) {
    return badRequest('Passphrase is required to unlock');
  }

  const { unlockDbKey } = await import('@/lib/startup/dbkey');
  const { startupState } = await import('@/lib/startup/startup-state');

  const success = unlockDbKey(passphrase);

  if (!success) {
    unlockLogger.warn('Database key unlock failed: wrong passphrase');
    return unauthorized('Incorrect passphrase');
  }

  startupState.setPepperState('resolved');

  // If the server was in locked mode, trigger deferred initialization
  if (startupState.getPhase() === 'locked') {
    unlockLogger.info('Server unlocked — triggering deferred startup initialization');

    // Run the rest of the startup sequence asynchronously
    // (The register() function in instrumentation.ts already returned,
    //  so we need to re-trigger the remaining phases.)
    setImmediate(async () => {
      try {
        const { register } = await import('@/instrumentation');
        await register();
      } catch (err) {
        unlockLogger.error('Deferred startup initialization failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        startupState.setPhase('failed');
        startupState.setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  unlockLogger.info('Database key unlocked successfully');
  return NextResponse.json({ success: true });
}

/**
 * Handle store: encrypt existing env var pepper into .dbkey file
 */
async function handleStore(passphrase: string): Promise<NextResponse> {
  unlockLogger.info('Database key store requested');

  const { storeEnvPepperInDbKey } = await import('@/lib/startup/dbkey');
  const { startupState } = await import('@/lib/startup/startup-state');

  storeEnvPepperInDbKey(passphrase);
  startupState.setPepperState('resolved');

  unlockLogger.info('Pepper stored in .dbkey file successfully');
  return NextResponse.json({ success: true });
}
