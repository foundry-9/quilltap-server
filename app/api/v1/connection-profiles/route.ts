/**
 * Connection Profiles API v1 - Collection Endpoint
 *
 * GET /api/v1/connection-profiles - List all profiles for current user
 * POST /api/v1/connection-profiles - Create a new profile
 * POST /api/v1/connection-profiles?action=test-connection - Test connection settings
 * POST /api/v1/connection-profiles?action=test-message - Send test message
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, AuthenticatedContext, enrichWithApiKey, enrichWithTags } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { decryptApiKey } from '@/lib/encryption';
import { supportsImageGeneration } from '@/lib/llm/image-capable';
import { createLLMProvider } from '@/lib/llm';
import { requiresBaseUrl, testProviderConnection, validateProviderConfig } from '@/lib/plugins/provider-validation';
import { ProviderEnum } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { badRequest, serverError, notFound, validationError } from '@/lib/api/responses';

// Disable caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Validation schemas
const testConnectionSchema = z.object({
  provider: ProviderEnum,
  apiKeyId: z.string().optional(),
  baseUrl: z.string().optional(),
});

const testMessageSchema = z.object({
  provider: ProviderEnum,
  apiKeyId: z.string().optional(),
  baseUrl: z.string().optional(),
  modelName: z.string(),
  parameters: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().min(1).optional(),
      top_p: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

/**
 * GET /api/v1/connection-profiles
 * List all connection profiles for the authenticated user
 */
export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    const { searchParams } = new URL(req.url);
    const sortByCharacter = searchParams.get('sortByCharacter');
    const imageCapable = searchParams.get('imageCapable') === 'true';// Get all connection profiles for user
    let profiles = await repos.connections.findByUserId(user.id);

    // Enrich with API key info and tags
    let enrichedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        // Enrich with API key and tag details
        const apiKey = await enrichWithApiKey(profile.apiKeyId, repos);
        const tags = await enrichWithTags(profile.tags, repos);

        return {
          ...profile,
          apiKey,
          tags,
        };
      })
    );

    // Filter to image-capable providers if requested
    if (imageCapable) {
      enrichedProfiles = enrichedProfiles.filter((profile) =>
        supportsImageGeneration(profile.provider)
      );
    }

    // Sort by default first, then by creation date
    enrichedProfiles.sort((a, b) => {
      if (a.isDefault !== b.isDefault) {
        return b.isDefault ? 1 : -1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // If sortByCharacter is specified, sort by matching tags
    if (sortByCharacter) {
      const character = await repos.characters.findById(sortByCharacter);
      const characterTagIds = new Set(character?.tags || []);

      const allTagIds = characterTagIds;

      enrichedProfiles.sort((a, b) => {
        const aMatchingTags = a.tags.filter((t) => t && allTagIds.has(t.tagId)).length;
        const bMatchingTags = b.tags.filter((t) => t && allTagIds.has(t.tagId)).length;

        if (aMatchingTags === bMatchingTags) {
          return b.isDefault ? 1 : a.isDefault ? -1 : 0;
        }

        return bMatchingTags - aMatchingTags;
      });

      const profilesWithMatches = enrichedProfiles.map((profile) => ({
        ...profile,
        matchingTags: profile.tags
          .filter((t) => t && allTagIds.has(t.tagId))
          .map((t) => t?.tag),
        matchingTagCount: profile.tags.filter((t) => t && allTagIds.has(t.tagId)).length,
      }));

      return NextResponse.json({
        profiles: profilesWithMatches,
        count: profilesWithMatches.length,
      });
    }

    return NextResponse.json({
      profiles: enrichedProfiles,
      count: enrichedProfiles.length,
    });
  } catch (error) {
    logger.error('[Connection Profiles v1] Error listing profiles', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch connection profiles');
  }
});

/**
 * Create a new connection profile
 */
async function handleCreate(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const {
      name,
      provider,
      apiKeyId,
      baseUrl,
      modelName,
      parameters = {},
      isDefault = false,
      isCheap = false,
      isDangerousCompatible = false,
      allowWebSearch = false,
      useNativeWebSearch = false,
    } = body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return badRequest('Name is required');
    }

    if (!provider || typeof provider !== 'string' || provider.trim().length === 0) {
      return badRequest('Provider is required');
    }

    if (!modelName || typeof modelName !== 'string' || modelName.trim().length === 0) {
      return badRequest('Model name is required');
    }

    // Validate apiKeyId if provided
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId);

      if (!apiKey) {
        return notFound('API key');
      }

      if (apiKey.provider !== provider) {
        return badRequest('API key provider does not match profile provider');
      }
    }

    // Validate baseUrl for providers that need it
    if (requiresBaseUrl(provider) && !baseUrl) {
      return badRequest(`Base URL is required for ${provider}`);
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      const existingProfiles = await repos.connections.findByUserId(user.id);
      for (const existingProfile of existingProfiles) {
        if (existingProfile.isDefault) {
          await repos.connections.update(existingProfile.id, { isDefault: false });
        }
      }
    }

    // Create profile
    const profile = await repos.connections.create({
      userId: user.id,
      name: name.trim(),
      provider: provider,
      apiKeyId: apiKeyId || null,
      baseUrl: baseUrl || null,
      modelName: modelName.trim(),
      parameters: parameters,
      isDefault,
      isCheap,
      isDangerousCompatible,
      allowWebSearch,
      useNativeWebSearch,
      tags: [],
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      messageCount: 0,
    });

    // Enrich with API key info
    const apiKey = await enrichWithApiKey(profile.apiKeyId, repos);

    logger.info('[Connection Profiles v1] Profile created', {
      profileId: profile.id,
      provider: profile.provider,
    });

    return NextResponse.json({ profile: { ...profile, apiKey } }, { status: 201 });
  } catch (error) {
    logger.error('[Connection Profiles v1] Error creating profile', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create connection profile');
  }
}

/**
 * Test connection settings
 */
async function handleTestConnection(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const { provider, apiKeyId, baseUrl } = testConnectionSchema.parse(body);// Get API key if provided
    let decryptedKey = '';
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId);

      if (!apiKey) {
        return notFound('API key');
      }

      decryptedKey = decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, user.id);
    }

    // Validate configuration
    const configValidation = validateProviderConfig(provider, {
      apiKey: decryptedKey,
      baseUrl,
    });

    if (!configValidation.valid) {
      logger.warn('[Connection Profiles v1] Config validation failed', {
        provider,
        errors: configValidation.errors,
      });
      return NextResponse.json(
        {
          valid: false,
          provider,
          error: configValidation.errors[0] || 'Configuration validation failed',
        },
        { status: 400 }
      );
    }

    // Test the connection
    const result = await testProviderConnection(provider, decryptedKey, baseUrl);

    if (result.valid) {
      logger.info('[Connection Profiles v1] Connection test successful', { provider });
      return NextResponse.json({
        valid: true,
        provider,
        message: `Successfully connected to ${provider}`,
      });
    }

    logger.warn('[Connection Profiles v1] Connection test failed', {
      provider,
      error: result.error,
    });
    return NextResponse.json(
      {
        valid: false,
        provider,
        error: result.error,
      },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Connection Profiles v1] Error testing connection', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to test connection');
  }
}

/**
 * Send test message to verify provider functionality
 */
async function handleTestMessage(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const { provider, apiKeyId, baseUrl, modelName, parameters = {} } = testMessageSchema.parse(body);

    // Get API key if provided
    let decryptedKey = '';
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId);

      if (!apiKey) {
        return notFound('API key');
      }

      decryptedKey = decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, user.id);
    }

    // Validate configuration
    const configValidation = validateProviderConfig(provider, {
      apiKey: decryptedKey,
      baseUrl,
    });
    if (!configValidation.valid) {
      return badRequest(configValidation.errors[0]);
    }

    // Create provider instance
    const llmProvider = await createLLMProvider(provider, baseUrl);

    // Send test message
    const testPrompt = 'Hello! Please respond with a brief greeting to confirm the connection is working.';

    const requestParams = {
      model: modelName,
      messages: [
        {
          role: 'user' as const,
          content: testPrompt,
        },
      ],
      temperature: parameters.temperature,
      maxTokens: parameters.max_tokens || 50,
      topP: parameters.top_p,
    };try {
      const response = await llmProvider.sendMessage(requestParams, decryptedKey);

      if (!response) {
        return NextResponse.json(
          {
            success: false,
            provider,
            error: 'No response received from model',
          },
          { status: 500 }
        );
      }

      if (response.content !== undefined && response.content !== null) {
        const preview = response.content.substring(0, 100);
        const isTruncated = response.content.length > 100;
        const suffix = isTruncated ? '...' : '';
        const message =
          preview.length === 0
            ? 'Test message successful! Model responded but returned empty content.'
            : `Test message successful! Model responded: "${preview}${suffix}"`;

        return NextResponse.json({
          success: true,
          provider,
          modelName,
          message,
          responsePreview: response.content.substring(0, 200),
        });
      }

      return NextResponse.json(
        {
          success: false,
          provider,
          error: 'No response received from model',
        },
        { status: 500 }
      );
    } catch (error) {return NextResponse.json(
        {
          success: false,
          provider,
          error: error instanceof Error ? error.message : 'Failed to send test message',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Connection Profiles v1] Error in test message', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to test message');
  }
}

/**
 * POST /api/v1/connection-profiles - Action dispatch or create
 */
export const POST = createAuthenticatedHandler(async (req, context) => {
  const action = getActionParam(req);

  switch (action) {
    case 'test-connection':
      return handleTestConnection(req, context);
    case 'test-message':
      return handleTestMessage(req, context);
    default:
      return handleCreate(req, context);
  }
});
