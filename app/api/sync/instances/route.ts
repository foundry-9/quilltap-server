/**
 * Sync Instances API
 *
 * GET /api/sync/instances - List all sync instances for user
 * POST /api/sync/instances - Create a new sync instance
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { encryptApiKey } from '@/lib/encryption';
import { CreateSyncInstance } from '@/lib/sync/types';
import { testRemoteConnection } from '@/lib/sync/remote-client';

// Schema for creating a new sync instance
const CreateInstanceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  url: z.string().url('Invalid URL'),
  apiKey: z.string().min(1, 'API key is required'),
  isActive: z.boolean().default(true),
});

/**
 * GET /api/sync/instances
 *
 * List all sync instances for the authenticated user.
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();

  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Sync instances GET requested without authentication', {
        context: 'api:sync:instances',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.debug('Getting sync instances', {
      context: 'api:sync:instances',
      userId: session.user.id,
    });

    const repos = getRepositories();
    const instances = await repos.syncInstances.findByUserId(session.user.id);

    // Remove sensitive data (encrypted API keys) from response
    const sanitizedInstances = instances.map((instance) => ({
      id: instance.id,
      name: instance.name,
      url: instance.url,
      isActive: instance.isActive,
      lastSyncAt: instance.lastSyncAt,
      lastSyncStatus: instance.lastSyncStatus,
      schemaVersion: instance.schemaVersion,
      appVersion: instance.appVersion,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    }));

    const duration = Date.now() - startTime;

    logger.info('Sync instances GET complete', {
      context: 'api:sync:instances',
      userId: session.user.id,
      instanceCount: sanitizedInstances.length,
      durationMs: duration,
    });

    return NextResponse.json({ instances: sanitizedInstances }, { status: 200 });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error getting sync instances', {
      context: 'api:sync:instances',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/sync/instances
 *
 * Create a new sync instance.
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Sync instances POST requested without authentication', {
        context: 'api:sync:instances',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('Sync instances POST received invalid JSON', {
        context: 'api:sync:instances',
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate request
    const parseResult = CreateInstanceSchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('Sync instances POST received invalid request', {
        context: 'api:sync:instances',
        userId: session.user.id,
        errors: parseResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { name, url, apiKey, isActive } = parseResult.data;

    logger.info('Creating sync instance', {
      context: 'api:sync:instances',
      userId: session.user.id,
      name,
      url,
    });

    const repos = getRepositories();

    // Check if instance with same URL already exists
    const existingInstance = await repos.syncInstances.findByUserAndUrl(session.user.id, url);
    if (existingInstance) {
      logger.warn('Sync instance with URL already exists', {
        context: 'api:sync:instances',
        userId: session.user.id,
        url,
      });
      return NextResponse.json(
        { error: 'A sync instance with this URL already exists' },
        { status: 409 }
      );
    }

    // Test connection to remote instance
    const connectionTest = await testRemoteConnection(url, apiKey);
    if (!connectionTest.success) {
      logger.warn('Failed to connect to remote sync instance', {
        context: 'api:sync:instances',
        userId: session.user.id,
        url,
        error: connectionTest.error,
      });
      return NextResponse.json(
        { error: `Failed to connect to remote instance: ${connectionTest.error}` },
        { status: 400 }
      );
    }

    // Check version compatibility
    if (connectionTest.versionInfo && !connectionTest.versionInfo.compatible) {
      logger.warn('Remote sync instance is not compatible', {
        context: 'api:sync:instances',
        userId: session.user.id,
        url,
        reason: connectionTest.versionInfo.reason,
      });
      return NextResponse.json(
        { error: `Remote instance is not compatible: ${connectionTest.versionInfo.reason}` },
        { status: 400 }
      );
    }

    // Encrypt the API key
    const encryptedResult = encryptApiKey(apiKey, session.user.id);
    const encryptedApiKey = {
      ciphertext: encryptedResult.encrypted,
      iv: encryptedResult.iv,
      authTag: encryptedResult.authTag,
    };

    // Create the instance
    const instanceData: CreateSyncInstance = {
      userId: session.user.id,
      name,
      url,
      apiKey: encryptedApiKey,
      isActive,
    };

    const instance = await repos.syncInstances.create(instanceData);

    // Update with remote version info if available
    if (connectionTest.versionInfo?.versionInfo) {
      await repos.syncInstances.update(instance.id, {
        schemaVersion: connectionTest.versionInfo.versionInfo.schemaVersion,
        appVersion: connectionTest.versionInfo.versionInfo.appVersion,
        remoteUserId: connectionTest.versionInfo.remoteUserId,
      });
    }

    const duration = Date.now() - startTime;

    logger.info('Sync instance created', {
      context: 'api:sync:instances',
      userId: session.user.id,
      instanceId: instance.id,
      name,
      url,
      durationMs: duration,
    });

    // Return sanitized instance (without API key)
    return NextResponse.json(
      {
        instance: {
          id: instance.id,
          name: instance.name,
          url: instance.url,
          isActive: instance.isActive,
          lastSyncAt: instance.lastSyncAt,
          lastSyncStatus: instance.lastSyncStatus,
          schemaVersion: connectionTest.versionInfo?.versionInfo?.schemaVersion,
          appVersion: connectionTest.versionInfo?.versionInfo?.appVersion,
          createdAt: instance.createdAt,
          updatedAt: instance.updatedAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error creating sync instance', {
      context: 'api:sync:instances',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
