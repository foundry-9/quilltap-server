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
 * Handle first-run setup: generate pepper, encrypt, write .dbkey.
 *
 * After setup, any existing plaintext databases are encrypted immediately
 * so there is no window where data sits unencrypted on disk.
 */
async function handleSetup(passphrase: string): Promise<NextResponse> {
  unlockLogger.info('Database key setup requested');

  const { setupDbKey } = await import('@/lib/startup/dbkey');
  const { startupState } = await import('@/lib/startup/startup-state');

  const result = setupDbKey(passphrase);
  startupState.setPepperState('resolved');

  unlockLogger.info('Database key setup complete');

  // Encrypt any existing plaintext databases now — on fresh installs the
  // database is created during migrations (Phase 1) before the user runs
  // setup, so it starts life as plaintext.  Without this, the DB would
  // only get encrypted on the next restart (Phase -0.5b).
  try {
    const fs = await import('fs');
    const { getSQLiteDatabasePath, getLLMLogsDatabasePath } = await import('@/lib/paths');
    const { isDatabaseEncrypted } = await import('@/lib/startup/db-encryption-state');
    const { convertDatabaseToEncrypted } = await import('@/lib/startup/db-encryption-converter');

    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      // Close any open migration connections before conversion
      try {
        const { closeSQLite } = await import('../../../../../migrations/lib/database-utils');
        closeSQLite();
      } catch { /* ignore */ }

      // Close the main app database singleton if open
      try {
        const { closeSQLiteClient } = await import('@/lib/database/backends/sqlite/client');
        closeSQLiteClient();
      } catch { /* ignore */ }

      for (const dbPath of [getSQLiteDatabasePath(), getLLMLogsDatabasePath()]) {
        if (fs.default.existsSync(dbPath) && !isDatabaseEncrypted(dbPath)) {
          unlockLogger.info('Encrypting existing plaintext database after setup', { dbPath });
          convertDatabaseToEncrypted(dbPath, pepper);
        }
      }
    }
  } catch (encErr) {
    // Non-fatal — Phase -0.5b will retry on next restart
    unlockLogger.warn('Post-setup database encryption failed (will retry on next restart)', {
      error: encErr instanceof Error ? encErr.message : String(encErr),
    });
  }

  // Return the pepper once for the user to save
  return NextResponse.json({
    success: true,
    pepper: result.pepper,
    message: 'Encryption key generated and stored. Save this value — it will not be displayed again.',
  });
}

/**
 * Handle unlock: decrypt .dbkey file with passphrase, then resume startup.
 *
 * Supports two scenarios:
 * 1. Normal: .dbkey file exists with passphrase — use unlockDbKey()
 * 2. Legacy migration: no .dbkey file but pepper_vault has passphrase — use
 *    legacy unlockPepper(), then migrate to .dbkey format
 */
async function handleUnlock(passphrase: string): Promise<NextResponse> {
  unlockLogger.info('Database key unlock requested');

  if (!passphrase) {
    return badRequest('Passphrase is required to unlock');
  }

  const { unlockDbKey, getDbKeyState, storeEnvPepperInDbKey } = await import('@/lib/startup/dbkey');
  const { startupState } = await import('@/lib/startup/startup-state');

  let success: boolean;
  const dbKeyState = getDbKeyState();

  // Legacy migration: startupState says needs-passphrase but dbkey module
  // is in needs-setup (no .dbkey file). This means the pepper is in the old
  // pepper_vault SQLite table and must be unlocked via the legacy system.
  if (dbKeyState === 'needs-setup' && startupState.getPepperState?.() === 'needs-passphrase') {
    unlockLogger.info('Legacy pepper vault detected — unlocking via pepper-vault migration path');

    const { unlockPepper } = await import('@/lib/startup/pepper-vault');
    success = unlockPepper(passphrase);

    if (success) {
      // Pepper is now in process.env — migrate to .dbkey file format
      unlockLogger.info('Legacy pepper unlocked, migrating to .dbkey file');
      try {
        // Set dbkey state to allow storage, then write the .dbkey file
        (global as any).__quilltapDbKeyState = 'needs-vault-storage';
        storeEnvPepperInDbKey(passphrase);
        unlockLogger.info('Legacy pepper migrated to .dbkey file successfully');
      } catch (migrationError) {
        // Migration to .dbkey failed, but pepper is unlocked — continue anyway
        unlockLogger.warn('Failed to migrate legacy pepper to .dbkey file, continuing with unlocked pepper', {
          error: migrationError instanceof Error ? migrationError.message : String(migrationError),
        });
        (global as any).__quilltapDbKeyState = 'resolved';
      }
    }
  } else {
    success = unlockDbKey(passphrase);
  }

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
