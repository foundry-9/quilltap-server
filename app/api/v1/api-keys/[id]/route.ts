/**
 * API Keys API v1 - Individual Key Endpoint
 *
 * GET /api/v1/api-keys/[id] - Get a specific API key
 * PUT /api/v1/api-keys/[id] - Update an API key
 * DELETE /api/v1/api-keys/[id] - Delete an API key
 * POST /api/v1/api-keys/[id]?action=test - Test if an API key is valid
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { getUserRepositories } from '@/lib/repositories/factory';
import { maskApiKey } from '@/lib/encryption';
import { Provider } from '@/lib/schemas/types';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { searchProviderRegistry } from '@/lib/plugins/search-provider-registry';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { ApiKeyTestSchema, ApiKeyUpdateSchema } from '@/lib/api-keys/api-key-input';
import { notFound, badRequest, serverError } from '@/lib/api/responses';

/**
 * Test API key validity using the provider plugin's validateApiKey method.
 * Checks both LLM providers and search providers.
 */
async function testProviderApiKey(
  provider: Provider,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Try LLM provider first (uses URL rewriting for VM/container environments)
    if (providerRegistry.hasProvider(provider)) {
      const isValid = await providerRegistry.validateApiKey(provider, apiKey, baseUrl);
      return { valid: isValid };
    }

    // Try search provider (uses URL rewriting for VM/container environments)
    if (searchProviderRegistry.hasProvider(provider)) {
      const isValid = await searchProviderRegistry.validateApiKey(provider, apiKey, baseUrl);
      return { valid: isValid };
    }

    logger.warn('[API Keys v1] Provider plugin not found', { provider });
    return { valid: false, error: `Provider ${provider} not found` };
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
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

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
          keyPreview: maskApiKey(apiKey.key_value),
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
export const PUT = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

      // Verify key exists
      const existingKey = await repos.connections.findApiKeyById(id);
      if (!existingKey) {
        return notFound('API key');
      }

      const { label, isActive, apiKey } = ApiKeyUpdateSchema.parse(await req.json());
      const updateData = {
        ...(label !== undefined ? { label } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        // A new key is stored exactly as sent.
        ...(apiKey !== undefined ? { key_value: apiKey } : {}),
      };

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
      // A validation failure is the middleware's 400, not a 500 (#166).
      if (error instanceof z.ZodError) throw error;
      logger.error('[API Keys v1] Error updating key', { keyId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to update API key');
    }
  }
);

/**
 * DELETE /api/v1/api-keys/[id] - Delete an API key
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

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
export const POST = createContextParamsHandler<{ id: string }>(
  async (req, ctx, { id }) => dispatchAction(req, { test: () => handleTestKey(req, ctx, id) })
);

async function handleTestKey(
  req: NextRequest,
  { user, repos }: RequestContext,
  id: string
): Promise<NextResponse> {
    try {

      // Get the API key
      const apiKey = await repos.connections.findApiKeyByIdAndUserId(id, user.id);

      if (!apiKey) {
        return notFound('API key');
      }

      // Get the API key value
      const decryptedKey = apiKey.key_value;

      // Get optional baseUrl from request body
      // The body is optional; a present one must be well-formed.
      const { baseUrl } = ApiKeyTestSchema.parse(await req.json().catch(() => ({})));

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
      if (error instanceof z.ZodError) throw error;
      logger.error('[API Keys v1] Error testing key', { keyId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to test API key');
    }
}
