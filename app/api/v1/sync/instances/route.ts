/**
 * Sync Instances API v1 - Collection Endpoint
 *
 * GET /api/v1/sync/instances - List all sync instances
 * POST /api/v1/sync/instances - Create a new sync instance
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, AuthenticatedContext } from '@/lib/api/middleware';
import { encryptApiKey, decryptApiKey } from '@/lib/encryption';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  badRequest,
  serverError,
  validationError,
  created,
  successResponse,
} from '@/lib/api/responses';
import type { CreateSyncInstance } from '@/lib/sync/types';

// ============================================================================
// Schemas
// ============================================================================

const createInstanceSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.url(),
  apiKey: z.string().min(1),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {
    logger.debug('[Sync Instances v1] GET list', { userId: context.user.id });

    const { repos } = context;
    const instances = await repos.syncInstances?.findByUserId(
      context.user.id
    );

    if (!instances) {
      return successResponse({ instances: [] });
    }

    // Decrypt sensitive fields for display (omit raw API keys)
    const safeInstances = instances.map((instance) => ({
      id: instance.id,
      name: instance.name,
      url: instance.url,
      isActive: instance.isActive,
      remoteUserId: instance.remoteUserId,
      lastSyncAt: instance.lastSyncAt,
      lastSyncStatus: instance.lastSyncStatus,
      schemaVersion: instance.schemaVersion,
      appVersion: instance.appVersion,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    }));

    logger.info('[Sync Instances v1] Listed instances', {
      count: instances.length,
    });

    return successResponse({
      instances: safeInstances,
      count: safeInstances.length,
    });
  } catch (error) {
    logger.error(
      '[Sync Instances v1] Error listing instances',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to list sync instances');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req, context) => {
  try {
    const body = await req.json();
    const validatedData = createInstanceSchema.parse(body);

    logger.info('[Sync Instances v1] Creating instance', {
      name: validatedData.name,
      url: validatedData.url,
    });

    const { repos, user } = context;

    // Encrypt API key
    const { encrypted, iv, authTag } = encryptApiKey(
      validatedData.apiKey,
      user.id
    );

    // Check if instance already exists for this user and URL
    const existingInstance = await repos.syncInstances?.findByUserAndUrl(
      user.id,
      validatedData.url
    );

    if (existingInstance) {
      return badRequest('A sync instance with this URL already exists');
    }

    // Create the sync instance in the database
    const instance = await repos.syncInstances?.create({
      userId: user.id,
      name: validatedData.name,
      url: validatedData.url,
      apiKey: {
        ciphertext: encrypted,
        iv,
        authTag,
      },
      isActive: true,
    });

    if (!instance) {
      return serverError('Failed to create sync instance');
    }

    logger.info('[Sync Instances v1] Instance created', {
      instanceId: instance.id,
      name: instance.name,
    });

    return created({
      instance: {
        id: instance.id,
        name: instance.name,
        url: instance.url,
        isActive: instance.isActive,
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error(
      '[Sync Instances v1] Error creating instance',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to create sync instance');
  }
});
