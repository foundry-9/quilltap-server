/**
 * Sync Instances API
 *
 * GET /api/sync/instances - List all sync instances for user
 * POST /api/sync/instances - Create a new sync instance
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { encryptApiKey } from '@/lib/encryption';
import { CreateSyncInstance } from '@/lib/sync/types';
import { testRemoteConnection } from '@/lib/sync/remote-client';
import { notFound, badRequest, conflict, serverError, validationError, created } from '@/lib/api/responses';

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
export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  const startTime = Date.now();

  try {
    logger.debug('Getting sync instances', {
      context: 'api:sync:instances',
      userId: user.id,
    });

    const instances = await repos.syncInstances.findByUserId(user.id);

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
      userId: user.id,
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

    return serverError();
  }
});

/**
 * POST /api/sync/instances
 *
 * Create a new sync instance.
 */
export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  const startTime = Date.now();

  try {
    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('Sync instances POST received invalid JSON', {
        context: 'api:sync:instances',
        userId: user.id,
      });
      return badRequest('Invalid JSON body');
    }

    // Validate request
    const parseResult = CreateInstanceSchema.safeParse(body);
    if (!parseResult.success) {
      logger.warn('Sync instances POST received invalid request', {
        context: 'api:sync:instances',
        userId: user.id,
        errors: parseResult.error.errors,
      });
      return validationError(parseResult.error);
    }

    const { name, url, apiKey, isActive } = parseResult.data;

    logger.info('Creating sync instance', {
      context: 'api:sync:instances',
      userId: user.id,
      name,
      url,
    });

    // Check if instance with same URL already exists
    const existingInstance = await repos.syncInstances.findByUserAndUrl(user.id, url);
    if (existingInstance) {
      logger.warn('Sync instance with URL already exists', {
        context: 'api:sync:instances',
        userId: user.id,
        url,
      });
      return conflict('A sync instance with this URL already exists');
    }

    // Test connection to remote instance
    const connectionTest = await testRemoteConnection(url, apiKey);
    if (!connectionTest.success) {
      logger.warn('Failed to connect to remote sync instance', {
        context: 'api:sync:instances',
        userId: user.id,
        url,
        error: connectionTest.error,
      });
      return badRequest(`Failed to connect to remote instance: ${connectionTest.error}`);
    }

    // Check version compatibility
    if (connectionTest.versionInfo && !connectionTest.versionInfo.compatible) {
      logger.warn('Remote sync instance is not compatible', {
        context: 'api:sync:instances',
        userId: user.id,
        url,
        reason: connectionTest.versionInfo.reason,
      });
      return badRequest(`Remote instance is not compatible: ${connectionTest.versionInfo.reason}`);
    }

    // Encrypt the API key
    const encryptedResult = encryptApiKey(apiKey, user.id);
    const encryptedApiKey = {
      ciphertext: encryptedResult.encrypted,
      iv: encryptedResult.iv,
      authTag: encryptedResult.authTag,
    };

    // Create the instance
    const instanceData: CreateSyncInstance = {
      userId: user.id,
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
      userId: user.id,
      instanceId: instance.id,
      name,
      url,
      durationMs: duration,
    });

    // Return sanitized instance (without API key)
    return created({
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
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Error creating sync instance', {
      context: 'api:sync:instances',
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration,
    });

    return serverError();
  }
});
