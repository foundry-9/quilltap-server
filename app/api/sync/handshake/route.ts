/**
 * Sync Handshake API
 *
 * POST /api/sync/handshake
 *
 * Handles the initial handshake between Quilltap instances during sync.
 * Verifies version compatibility and authenticates the remote user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import {
  SyncHandshakeRequestSchema,
  SyncHandshakeResponse,
  SyncVersionInfoSchema,
} from '@/lib/sync/types';
import {
  checkVersionCompatibility,
  getLocalVersionInfo,
  validateVersionInfo,
} from '@/lib/sync/version-checker';
import { getAuthenticatedUserForSync } from '@/lib/sync/api-key-auth';

/**
 * POST /api/sync/handshake
 *
 * Perform sync handshake to:
 * 1. Exchange version information
 * 2. Check compatibility
 * 3. Authenticate (if credentials provided)
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Check if user is authenticated (via session or API key)
    const session = await getServerSession();
    const authResult = await getAuthenticatedUserForSync(req, session?.user?.id || null);

    if (!authResult.userId) {
      logger.warn('Sync handshake attempted without authentication', {
        context: 'api:sync:handshake',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authResult.userId;
    const authMethod = authResult.authMethod;

    logger.debug('Sync handshake authentication successful', {
      context: 'api:sync:handshake',
      userId,
      authMethod,
    });

    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('Sync handshake received invalid JSON', {
        context: 'api:sync:handshake',
        userId,
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate request
    const parseResult = SyncHandshakeRequestSchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('Sync handshake received invalid request', {
        context: 'api:sync:handshake',
        userId,
        errors: parseResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { versionInfo: remoteVersionInfo } = parseResult.data;

    logger.info('Processing sync handshake', {
      context: 'api:sync:handshake',
      userId,
      authMethod,
      remoteAppVersion: remoteVersionInfo.appVersion,
      remoteSchemaVersion: remoteVersionInfo.schemaVersion,
      remoteProtocolVersion: remoteVersionInfo.syncProtocolVersion,
    });

    // Check version compatibility
    const compatibilityResult = checkVersionCompatibility(remoteVersionInfo);

    if (!compatibilityResult.compatible) {
      logger.warn('Sync handshake failed: version incompatible', {
        context: 'api:sync:handshake',
        userId,
        reason: compatibilityResult.reason,
        localVersion: compatibilityResult.localVersion,
        remoteVersion: compatibilityResult.remoteVersion,
      });

      const response: SyncHandshakeResponse = {
        compatible: false,
        reason: compatibilityResult.reason,
        versionInfo: getLocalVersionInfo(),
      };

      return NextResponse.json(response, { status: 200 });
    }

    // Version is compatible - return success with local version info
    const repos = getRepositories();
    const user = await repos.users.findById(userId);

    if (!user) {
      logger.error('User not found during sync handshake', {
        context: 'api:sync:handshake',
        userId,
      });
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const response: SyncHandshakeResponse = {
      compatible: true,
      versionInfo: getLocalVersionInfo(),
      remoteUserId: user.id,
    };

    const duration = Date.now() - startTime;

    logger.info('Sync handshake successful', {
      context: 'api:sync:handshake',
      userId,
      authMethod,
      compatible: true,
      durationMs: duration,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error during sync handshake', {
      context: 'api:sync:handshake',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
