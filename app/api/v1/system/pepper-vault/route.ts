/**
 * Pepper Vault API v1
 *
 * GET /api/v1/system/pepper-vault - Returns pepper vault status
 * POST /api/v1/system/pepper-vault?action=setup - First-run setup
 * POST /api/v1/system/pepper-vault?action=unlock - Unlock with passphrase
 * POST /api/v1/system/pepper-vault?action=store - Store env var pepper in vault
 *
 * This endpoint is unauthenticated (like plugin initialization) because
 * it must be accessible before the app is fully operational.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, serverError, unauthorized } from '@/lib/api/responses';

export const dynamic = 'force-dynamic';

const pepperLogger = logger.child({ module: 'api-pepper-vault' });

/**
 * GET /api/v1/system/pepper-vault
 *
 * Returns the current pepper vault state.
 */
export async function GET() {
  try {
    // Read from startupState (persisted on global) as primary source,
    // fall back to pepper-vault module state
    const { startupState } = await import('@/lib/startup/startup-state');
    const { getPepperState } = await import('@/lib/startup/pepper-vault');

    // startupState is the authoritative source (set during instrumentation.ts)
    const state = startupState.getPepperState?.() ?? getPepperState();

    return NextResponse.json({ state });
  } catch (error) {
    pepperLogger.error('Error getting pepper vault status', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to get pepper vault status');
  }
}

/**
 * POST /api/v1/system/pepper-vault?action=setup|unlock|store
 *
 * Dispatches pepper vault actions.
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
    pepperLogger.error('Error in pepper vault action', {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError(error instanceof Error ? error.message : 'Internal server error');
  }
}

/**
 * Handle first-run setup: generate pepper, encrypt, store
 */
async function handleSetup(passphrase: string): Promise<NextResponse> {
  pepperLogger.info('Pepper vault setup requested');

  const { setupPepper } = await import('@/lib/startup/pepper-vault');
  const { startupState } = await import('@/lib/startup/startup-state');

  const result = setupPepper(passphrase);
  startupState.setPepperState('resolved');

  pepperLogger.info('Pepper vault setup complete');

  // Return the pepper once for the user to save
  return NextResponse.json({
    success: true,
    pepper: result.pepper,
    message: 'Pepper generated and stored. Save the pepper value shown — it will not be displayed again.',
  });
}

/**
 * Handle unlock: decrypt stored pepper with passphrase
 */
async function handleUnlock(passphrase: string): Promise<NextResponse> {
  pepperLogger.info('Pepper vault unlock requested');

  if (!passphrase) {
    return badRequest('Passphrase is required to unlock');
  }

  const { unlockPepper } = await import('@/lib/startup/pepper-vault');
  const { startupState } = await import('@/lib/startup/startup-state');

  const success = unlockPepper(passphrase);

  if (!success) {
    pepperLogger.warn('Pepper vault unlock failed: wrong passphrase');
    return unauthorized('Incorrect passphrase');
  }

  startupState.setPepperState('resolved');

  pepperLogger.info('Pepper vault unlocked successfully');
  return NextResponse.json({ success: true });
}

/**
 * Handle store: encrypt existing env var pepper into vault
 */
async function handleStore(passphrase: string): Promise<NextResponse> {
  pepperLogger.info('Pepper vault store requested');

  const { storePepperInVault } = await import('@/lib/startup/pepper-vault');
  const { startupState } = await import('@/lib/startup/startup-state');

  storePepperInVault(passphrase);
  startupState.setPepperState('resolved');

  pepperLogger.info('Pepper stored in vault successfully');
  return NextResponse.json({ success: true });
}
