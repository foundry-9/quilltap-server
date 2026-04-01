/**
 * API Keys API v1 - Individual Key Endpoint
 *
 * GET /api/v1/api-keys/[id] - Get a specific API key
 * PUT /api/v1/api-keys/[id] - Update an API key
 * DELETE /api/v1/api-keys/[id] - Delete an API key
 * POST /api/v1/api-keys/[id]?action=test - Test if an API key is valid
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { getUserRepositories } from '@/lib/repositories/factory';
import { encryptApiKey, decryptApiKey, maskApiKey } from '@/lib/encryption';
import { Provider } from '@/lib/schemas/types';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError } from '@/lib/api/responses';

/**
 * Test API key validity using the provider plugin's validateApiKey method
 */
async function testProviderApiKey(
  provider: Provider,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    logger.debug('[API Keys v1] Testing provider API key', { provider });

    // Get provider plugin from registry
    const plugin = providerRegistry.getProvider(provider);
    if (!plugin) {
      logger.warn('[API Keys v1] Provider plugin not found', { provider });
      return { valid: false, error: `Provider ${provider} not found` };
    }

    // Use plugin's validateApiKey method
    const isValid = await plugin.validateApiKey(apiKey, baseUrl);
    logger.debug('[API Keys v1] Key validation result', { provider, valid: isValid });

    return { valid: isValid };
  } catch (error) {
    logger.error('[API Keys v1] Key validation failed', { provider }, error as Error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /api/v1/api-keys/[id] - Get a specific API key (masked)
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[API Keys v1] GET key', { keyId: id, userId: user.id });

      const apiKey = await repos.connections.findApiKeyById(id);

      if (!apiKey) {
        return notFound('API key');
      }

      // Return masked key
      return NextResponse.json({
        apiKey: {
          id: apiKey.id,
          provider: apiKey.provider,
          label: apiKey.label,
          isActive: apiKey.isActive,
          lastUsed: apiKey.lastUsed,
          createdAt: apiKey.createdAt,
          updatedAt: apiKey.updatedAt,
          keyPreview: maskApiKey(apiKey.ciphertext.substring(0, 32)),
        },
      });
    } catch (error) {
      logger.error('[API Keys v1] Error fetching key', { keyId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch API key');
    }
  }
);

/**
 * PUT /api/v1/api-keys/[id] - Update an API key
 */
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[API Keys v1] PUT key', { keyId: id, userId: user.id });

      // Verify key exists
      const existingKey = await repos.connections.findApiKeyById(id);
      if (!existingKey) {
        return notFound('API key');
      }

      const body = await req.json();
      const { label, isActive, apiKey } = body;

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (label !== undefined) {
        if (typeof label !== 'string' || label.trim().length === 0) {
          return badRequest('Label must be a non-empty string');
        }
        updateData.label = label.trim();
      }

      if (isActive !== undefined) {
        if (typeof isActive !== 'boolean') {
          return badRequest('isActive must be a boolean');
        }
        updateData.isActive = isActive;
      }

      // If new API key is provided, re-encrypt it
      if (apiKey !== undefined) {
        if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
          return badRequest('API key must be a non-empty string');
        }

        const encrypted = encryptApiKey(apiKey, user.id);
        updateData.ciphertext = encrypted.encrypted;
        updateData.iv = encrypted.iv;
        updateData.authTag = encrypted.authTag;
      }

      // Update the key
      const updatedKey = await repos.connections.updateApiKey(id, updateData);

      if (!updatedKey) {
        return serverError('Failed to update API key');
      }

      logger.info('[API Keys v1] Key updated', { keyId: id });

      return NextResponse.json({
        apiKey: {
          id: updatedKey.id,
          provider: updatedKey.provider,
          label: updatedKey.label,
          isActive: updatedKey.isActive,
          lastUsed: updatedKey.lastUsed,
          createdAt: updatedKey.createdAt,
          updatedAt: updatedKey.updatedAt,
        },
      });
    } catch (error) {
      logger.error('[API Keys v1] Error updating key', { keyId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to update API key');
    }
  }
);

/**
 * DELETE /api/v1/api-keys/[id] - Delete an API key
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[API Keys v1] DELETE key', { keyId: id, userId: user.id });

      // Verify key exists
      const existingKey = await repos.connections.findApiKeyById(id);
      if (!existingKey) {
        return notFound('API key');
      }

      // Delete the key
      const deleted = await repos.connections.deleteApiKey(id);

      if (!deleted) {
        return serverError('Failed to delete API key');
      }

      logger.info('[API Keys v1] Key deleted', { keyId: id });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('[API Keys v1] Error deleting key', { keyId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete API key');
    }
  }
);

/**
 * POST /api/v1/api-keys/[id]?action=test - Test if an API key is valid
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const action = getActionParam(req);

    if (action !== 'test') {
      return badRequest(`Unknown action: ${action}. Available actions: test`);
    }

    try {
      logger.debug('[API Keys v1] Testing key', { keyId: id, userId: user.id });

      // Get the API key
      const apiKey = await repos.connections.findApiKeyByIdAndUserId(id, user.id);

      if (!apiKey) {
        return notFound('API key');
      }

      // Decrypt the API key
      const decryptedKey = decryptApiKey(
        apiKey.ciphertext,
        apiKey.iv,
        apiKey.authTag,
        user.id
      );

      // Get optional baseUrl from request body
      const body = await req.json().catch(() => ({}));
      const { baseUrl } = body;

      // Test the key
      const result = await testProviderApiKey(
        apiKey.provider as Provider,
        decryptedKey,
        baseUrl
      );

      if (result.valid) {
        // Update lastUsed timestamp
        await repos.connections.recordApiKeyUsage(id);

        return NextResponse.json({
          valid: true,
          provider: apiKey.provider,
          message: 'API key is valid',
        });
      }

      return NextResponse.json(
        {
          valid: false,
          provider: apiKey.provider,
          error: result.error,
        },
        { status: 400 }
      );
    } catch (error) {
      logger.error('[API Keys v1] Error testing key', { keyId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to test API key');
    }
  }
);
