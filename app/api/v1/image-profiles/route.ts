/**
 * Image Profiles API v1 - Collection Endpoint
 *
 * GET /api/v1/image-profiles - List all image profiles for current user
 * POST /api/v1/image-profiles - Create a new image profile
 * POST /api/v1/image-profiles?action=validate-key - Validate an API key
 * GET /api/v1/image-profiles?action=list-models - List available image models
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, AuthenticatedContext } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { successResponse, created, notFound, badRequest, serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { decryptApiKey } from '@/lib/encryption';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup';

/**
 * GET /api/v1/image-profiles
 * List all image profiles or get available models
 */
export const GET = createAuthenticatedHandler(async (req, context) => {
  const { user, repos } = context;
  const action = getActionParam(req);

  // Handle list-models action
  if (action === 'list-models') {
    return handleListModels(req, context);
  }

  try {
    const { searchParams } = new URL(req.url);
    const sortByCharacter = searchParams.get('sortByCharacter');

    logger.debug('[Image Profiles v1] GET list', { userId: user.id, sortByCharacter });

    // Get all image profiles for user
    const profiles = await repos.imageProfiles.findByUserId(user.id);

    // Enrich with API key info and tags
    const enrichedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        // Get API key info if exists
        let apiKey = null;
        if (profile.apiKeyId) {
          const key = await repos.connections.findApiKeyById(profile.apiKeyId);
          if (key) {
            apiKey = {
              id: key.id,
              label: key.label,
              provider: key.provider,
              isActive: key.isActive,
            };
          }
        }

        // Get tag details
        const tagDetails = await Promise.all(
          profile.tags.map(async (tagId) => {
            const tag = await repos.tags.findById(tagId);
            return tag ? { tagId, tag } : null;
          })
        );

        return {
          ...profile,
          apiKey,
          tags: tagDetails.filter(Boolean),
        };
      })
    );

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
        const aMatchingTags = a.tags.filter(t => t !== null && allTagIds.has(t.tagId)).length;
        const bMatchingTags = b.tags.filter(t => t !== null && allTagIds.has(t.tagId)).length;

        if (aMatchingTags === bMatchingTags) {
          return b.isDefault ? 1 : a.isDefault ? -1 : 0;
        }

        return bMatchingTags - aMatchingTags;
      });

      const profilesWithMatches = enrichedProfiles.map(profile => {
        const matchingTagsFiltered = profile.tags.filter(t => t !== null && allTagIds.has(t.tagId));
        return {
          ...profile,
          matchingTags: matchingTagsFiltered.map(t => t!.tag),
          matchingTagCount: matchingTagsFiltered.length,
        };
      });

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
    logger.error('[Image Profiles v1] Error listing profiles', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch image profiles');
  }
});

/**
 * Handle list-models action
 */
async function handleListModels(req: NextRequest, context: AuthenticatedContext) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get('provider');
    const apiKeyId = searchParams.get('apiKeyId');

    logger.debug('[Image Profiles v1] list-models', { provider, apiKeyId });

    if (!provider) {
      return badRequest('Provider is required');
    }

    // Ensure plugin system is initialized
    const pluginSystemInitialized = isPluginSystemInitialized();
    const providerRegistryInitialized = providerRegistry.isInitialized();
    const providerCount = providerRegistry.getAllProviders().length;

    logger.debug('[Image Profiles v1] Checking plugin system for list-models', {
      pluginSystemInitialized,
      providerRegistryInitialized,
      providerCount,
    });

    // Re-initialize if providers are empty (module reload in dev mode)
    if (!pluginSystemInitialized || !providerRegistryInitialized || providerCount === 0) {
      logger.warn('[Image Profiles v1] Provider registry empty or not initialized, re-initializing');
      const initResult = await initializePlugins();
      logger.info('[Image Profiles v1] Plugin system initialization result', {
        success: initResult.success,
        stats: initResult.stats,
      });
      if (!initResult.success) {
        return serverError('Plugin system initialization failed');
      }
    }

    // Validate provider by attempting to get it
    let imageProvider;
    try {
      // Log all available providers for debugging
      const allProviders = providerRegistry.getAllProviders();
      const imageProviders = allProviders.filter(p => p.capabilities.imageGeneration);
      logger.debug('[Image Profiles v1] Available image providers', {
        allProvidersCount: allProviders.length,
        allProviders: allProviders.map(p => p.metadata.providerName),
        imageProvidersCount: imageProviders.length,
        imageProviders: imageProviders.map(p => p.metadata.providerName),
      });
      
      imageProvider = createImageProvider(provider);
    } catch (error) {
      logger.error('[Image Profiles v1] Provider not available', { provider, error: error instanceof Error ? error.message : String(error) });
      return badRequest(`Provider ${provider} is not available`);
    }

    // Get available models
    let models: string[] = [];

    if (apiKeyId) {
      const apiKey = await context.repos.connections.findApiKeyById(apiKeyId);

      if (!apiKey) {
        return notFound('API key');
      }

      try {
        const decryptedKey = decryptApiKey(
          apiKey.ciphertext,
          apiKey.iv,
          apiKey.authTag,
          context.user.id
        );
        models = await imageProvider.getAvailableModels(decryptedKey);
      } catch (error) {
        logger.error('[Image Profiles v1] Failed to get models with API key', { provider }, error instanceof Error ? error : undefined);
        models = imageProvider.supportedModels;
      }
    } else {
      models = imageProvider.supportedModels;
    }

    // Cache the fetched image models in the database
    try {
      await context.repos.providerModels.upsertModelsForProvider(
        provider,
        models.map(modelId => ({
          modelId,
          displayName: modelId,
        })),
        'image',
        undefined
      );
    } catch (cacheError) {
      logger.warn('[Image Profiles v1] Failed to cache image models', {
        error: cacheError instanceof Error ? cacheError.message : String(cacheError),
      });
    }

    return NextResponse.json({
      provider,
      models,
      supportedModels: imageProvider.supportedModels,
    });
  } catch (error) {
    logger.error('[Image Profiles v1] Error in list-models', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch models');
  }
}

/**
 * Handle validate-key action
 * Validates an API key by attempting to get models from the provider
 */
async function handleValidateKey(req: NextRequest, context: AuthenticatedContext) {
  try {
    const body = await req.json();
    const { provider, apiKeyId } = body;

    logger.debug('[Image Profiles v1] validate-key', { provider, apiKeyId });

    if (!provider) {
      return badRequest('Provider is required');
    }

    if (!apiKeyId) {
      return badRequest('API key ID is required');
    }

    // Ensure plugin system is initialized
    const providerCount = providerRegistry.getAllProviders().length;
    if (providerCount === 0) {
      logger.warn('[Image Profiles v1] Provider registry empty, re-initializing');
      const initResult = await initializePlugins();
      if (!initResult.success) {
        return serverError('Plugin system initialization failed');
      }
    }

    // Get the API key
    const apiKey = await context.repos.connections.findApiKeyById(apiKeyId);
    if (!apiKey) {
      return NextResponse.json({ valid: false, message: 'API key not found' });
    }

    // Create provider instance
    let imageProvider;
    try {
      imageProvider = createImageProvider(provider);
    } catch (error) {
      return NextResponse.json({ 
        valid: false, 
        message: `Provider ${provider} is not available` 
      });
    }

    // Decrypt the API key
    let decryptedKey: string;
    try {
      decryptedKey = decryptApiKey(
        apiKey.ciphertext,
        apiKey.iv,
        apiKey.authTag,
        context.user.id
      );
    } catch (error) {
      logger.error('[Image Profiles v1] Failed to decrypt API key', { apiKeyId }, error instanceof Error ? error : undefined);
      return NextResponse.json({ valid: false, message: 'Failed to decrypt API key' });
    }

    // Validate by attempting to get models
    try {
      const models = await imageProvider.getAvailableModels(decryptedKey);
      
      if (models && models.length > 0) {
        logger.info('[Image Profiles v1] API key validated successfully', { provider, modelCount: models.length });
        return NextResponse.json({ valid: true, message: 'API key is valid', modelCount: models.length });
      } else {
        return NextResponse.json({ valid: false, message: 'No models available with this API key' });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('[Image Profiles v1] API key validation failed', { provider, error: errorMessage });
      return NextResponse.json({ valid: false, message: `Validation failed: ${errorMessage}` });
    }
  } catch (error) {
    logger.error('[Image Profiles v1] Error in validate-key', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to validate API key');
  }
}

/**
 * POST /api/v1/image-profiles - Create a new image profile
 * POST /api/v1/image-profiles?action=validate-key - Validate an API key
 */
export const POST = createAuthenticatedHandler(async (req, context) => {
  const { user, repos } = context;
  const action = getActionParam(req);

  // Handle validate-key action
  if (action === 'validate-key') {
    return handleValidateKey(req, context);
  }

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
    } = body;

    logger.debug('[Image Profiles v1] POST create', { userId: user.id, name, provider });

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return badRequest('Name is required');
    }

    if (!provider || typeof provider !== 'string') {
      return badRequest('Provider is required');
    }

    try {
      createImageProvider(provider);
    } catch {
      return badRequest(`Provider ${provider} is not available`);
    }

    if (!modelName || typeof modelName !== 'string' || modelName.trim().length === 0) {
      return badRequest('Model name is required');
    }

    if (typeof parameters !== 'object' || Array.isArray(parameters)) {
      return badRequest('Parameters must be an object');
    }

    // Validate apiKeyId if provided
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId);
      if (!apiKey) {
        return notFound('API key');
      }
    }

    // Check for duplicate name
    const existingProfile = await repos.imageProfiles.findByName(user.id, name.trim());
    if (existingProfile) {
      return NextResponse.json(
        { error: 'An image profile with this name already exists' },
        { status: 409 }
      );
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await repos.imageProfiles.unsetAllDefaults(user.id);
    }

    // Create profile
    const profile = await repos.imageProfiles.create({
      userId: user.id,
      name: name.trim(),
      provider: provider,
      apiKeyId: apiKeyId || null,
      baseUrl: baseUrl || null,
      modelName: modelName.trim(),
      parameters: parameters,
      isDefault,
      tags: [],
    });

    // Enrich with API key info
    let apiKey = null;
    if (profile.apiKeyId) {
      const key = await repos.connections.findApiKeyById(profile.apiKeyId);
      if (key) {
        apiKey = {
          id: key.id,
          label: key.label,
          provider: key.provider,
          isActive: key.isActive,
        };
      }
    }

    logger.info('[Image Profiles v1] Profile created', { profileId: profile.id, provider: profile.provider });

    return created({ ...profile, apiKey });
  } catch (error) {
    logger.error('[Image Profiles v1] Error creating profile', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create image profile');
  }
});
