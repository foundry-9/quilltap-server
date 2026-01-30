/**
 * Embedding Profiles API v1 - Collection Endpoint
 *
 * GET /api/v1/embedding-profiles - List all embedding profiles for current user
 * POST /api/v1/embedding-profiles - Create a new embedding profile
 * GET /api/v1/embedding-profiles?action=list-models - List available embedding models
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, AuthenticatedContext } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { successResponse, created, notFound, badRequest, serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import type { EmbeddingProfileProvider } from '@/lib/schemas/types';
import {
  getEmbeddingProviders,
  getEmbeddingModels,
  getAllEmbeddingModels,
} from '@/lib/plugins/provider-validation';

/**
 * GET /api/v1/embedding-profiles
 * List all embedding profiles for the authenticated user
 * GET /api/v1/embedding-profiles?action=list-models - List available models
 */
export const GET = createAuthenticatedHandler(async (req, context) => {
  const { user, repos } = context;
  const action = getActionParam(req);

  // Handle list-models action
  if (action === 'list-models') {
    return handleListModels(req, context);
  }

  try {

    // Get all embedding profiles for user
    const profiles = await repos.embeddingProfiles.findByUserId(user.id);

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

    return NextResponse.json({
      profiles: enrichedProfiles,
      count: enrichedProfiles.length,
    });
  } catch (error) {
    logger.error('[Embedding Profiles v1] Error listing profiles', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch embedding profiles');
  }
});

/**
 * Handle list-models action
 */
async function handleListModels(req: NextRequest, context: AuthenticatedContext) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get('provider')?.toUpperCase();

    if (provider) {
      const embeddingProviders = getEmbeddingProviders();

      if (!embeddingProviders.includes(provider)) {return badRequest('Invalid provider. Must be one of: ' + embeddingProviders.join(', '));
      }

      const models = getEmbeddingModels(provider);// Cache the fetched embedding models in the database
      try {
        await context.repos.providerModels.upsertModelsForProvider(
          provider,
          models.map((m) => ({
            modelId: m.id,
            displayName: m.name,
          })),
          'embedding',
          undefined
        );
      } catch (cacheError) {
        logger.warn('[Embedding Profiles v1] Failed to cache embedding models', {
          error: cacheError instanceof Error ? cacheError.message : String(cacheError),
        });
      }

      return NextResponse.json({ provider, models });
    }

    // Return all models grouped by provider
    const allModels = getAllEmbeddingModels();// Cache all embedding models in the database
    try {
      for (const [providerName, models] of Object.entries(allModels)) {
        await context.repos.providerModels.upsertModelsForProvider(
          providerName,
          models.map((m) => ({
            modelId: m.id,
            displayName: m.name,
          })),
          'embedding',
          undefined
        );
      }
    } catch (cacheError) {
      logger.warn('[Embedding Profiles v1] Failed to cache all embedding models', {
        error: cacheError instanceof Error ? cacheError.message : String(cacheError),
      });
    }

    return NextResponse.json(allModels);
  } catch (error) {
    logger.error('[Embedding Profiles v1] Error in list-models', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch embedding models');
  }
}

/**
 * POST /api/v1/embedding-profiles - Create a new embedding profile
 */
export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    const body = await req.json();
    const {
      name,
      provider,
      apiKeyId,
      baseUrl,
      modelName,
      dimensions,
      isDefault = false,
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

    if (dimensions !== undefined && (typeof dimensions !== 'number' || dimensions <= 0)) {
      return badRequest('Dimensions must be a positive number');
    }

    // Validate apiKeyId if provided
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId);
      if (!apiKey) {
        return notFound('API key');
      }
    }

    // Check for duplicate name
    const existingProfile = await repos.embeddingProfiles.findByName(user.id, name.trim());
    if (existingProfile) {
      return NextResponse.json(
        { error: 'An embedding profile with this name already exists' },
        { status: 409 }
      );
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await repos.embeddingProfiles.unsetAllDefaults(user.id);
    }

    // Create profile
    const profile = await repos.embeddingProfiles.create({
      userId: user.id,
      name: name.trim(),
      provider: provider as EmbeddingProfileProvider,
      apiKeyId: apiKeyId || null,
      baseUrl: baseUrl || null,
      modelName: modelName.trim(),
      dimensions: dimensions || null,
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

    logger.info('[Embedding Profiles v1] Profile created', { profileId: profile.id, provider: profile.provider });

    return created({ ...profile, apiKey });
  } catch (error) {
    logger.error('[Embedding Profiles v1] Error creating profile', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create embedding profile');
  }
});
