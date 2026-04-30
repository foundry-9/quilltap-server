/**
 * Embedding Profiles API v1 - Individual Profile Endpoint
 *
 * GET /api/v1/embedding-profiles/[id] - Get a specific profile
 * PUT /api/v1/embedding-profiles/[id] - Update a profile
 * DELETE /api/v1/embedding-profiles/[id] - Delete a profile
 * POST /api/v1/embedding-profiles/[id]?action=refit - Manually trigger vocabulary refit (BUILTIN only)
 * POST /api/v1/embedding-profiles/[id]?action=reindex - Manually trigger re-embedding all memories
 * POST /api/v1/embedding-profiles/[id]?action=reapply - Slice + renormalize stored vectors to match the profile's truncateToDimensions (Matryoshka, no provider call)
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, enrichProfile } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { notFound, badRequest, serverError, messageResponse, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { invalidateAllEmbeddings } from '@/lib/embedding/embedding-service';
import {
  enqueueEmbeddingRefit,
  enqueueEmbeddingReindexAll,
  enqueueEmbeddingReapplyProfile,
} from '@/lib/background-jobs/queue-service';

/**
 * GET /api/v1/embedding-profiles/[id]
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

      const profile = await repos.embeddingProfiles.findById(id);

      if (!profile) {
        return notFound('Embedding profile');
      }

      // Enrich with API key and tag details
      const enriched = await enrichProfile(profile, repos);

      return NextResponse.json({
        ...profile,
        ...enriched,
      });
    } catch (error) {
      logger.error('[Embedding Profiles v1] Error fetching profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch embedding profile');
    }
  }
);

/**
 * PUT /api/v1/embedding-profiles/[id]
 */
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

      // Verify ownership
      const existingProfile = await repos.embeddingProfiles.findById(id);

      if (!existingProfile) {
        return notFound('Embedding profile');
      }

      const body = await req.json();
      const {
        name,
        provider,
        apiKeyId,
        baseUrl,
        modelName,
        dimensions,
        truncateToDimensions,
        normalizeL2,
        isDefault,
      } = body;

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return badRequest('Name must be a non-empty string');
        }

        // Check for duplicate name (excluding current profile)
        const duplicateProfile = await repos.embeddingProfiles.findByName(user.id, name.trim());

        if (duplicateProfile && duplicateProfile.id !== id) {
          return NextResponse.json(
            { error: 'An embedding profile with this name already exists' },
            { status: 409 }
          );
        }

        updateData.name = name.trim();
      }

      if (provider !== undefined) {
        if (typeof provider !== 'string' || provider.trim().length === 0) {
          return badRequest('Provider must be a non-empty string');
        }
        updateData.provider = provider;
      }

      if (apiKeyId !== undefined) {
        if (apiKeyId === null) {
          updateData.apiKeyId = null;
        } else {
          const apiKey = await repos.connections.findApiKeyById(apiKeyId);
          if (!apiKey) {
            return notFound('API key');
          }
          updateData.apiKeyId = apiKeyId;
        }
      }

      if (baseUrl !== undefined) {
        updateData.baseUrl = baseUrl || null;
      }

      if (modelName !== undefined) {
        if (typeof modelName !== 'string' || modelName.trim().length === 0) {
          return badRequest('Model name must be a non-empty string');
        }
        updateData.modelName = modelName.trim();
      }

      if (dimensions !== undefined) {
        if (dimensions === null) {
          updateData.dimensions = null;
        } else if (typeof dimensions !== 'number' || dimensions <= 0) {
          return badRequest('Dimensions must be a positive number');
        } else {
          updateData.dimensions = dimensions;
        }
      }

      if (truncateToDimensions !== undefined) {
        if (truncateToDimensions === null) {
          updateData.truncateToDimensions = null;
        } else if (
          typeof truncateToDimensions !== 'number' ||
          !Number.isInteger(truncateToDimensions) ||
          truncateToDimensions <= 0
        ) {
          return badRequest('truncateToDimensions must be a positive integer');
        } else {
          updateData.truncateToDimensions = truncateToDimensions;
        }
      }

      if (normalizeL2 !== undefined) {
        if (typeof normalizeL2 !== 'boolean') {
          return badRequest('normalizeL2 must be a boolean');
        }
        updateData.normalizeL2 = normalizeL2;
      }

      if (isDefault !== undefined) {
        if (typeof isDefault !== 'boolean') {
          return badRequest('isDefault must be a boolean');
        }

        // If setting as default, unset other defaults
        if (isDefault) {
          await repos.embeddingProfiles.unsetAllDefaults(user.id);
        }

        updateData.isDefault = isDefault;
      }

      // Update the profile
      const updatedProfile = await repos.embeddingProfiles.update(id, updateData);

      if (!updatedProfile) {
        return serverError('Failed to update profile');
      }

      // Enrich with API key and tag details
      const enriched = await enrichProfile(updatedProfile, repos);

      logger.info('[Embedding Profiles v1] Profile updated', { profileId: id });

      // Check if provider or model changed - need to re-embed all memories
      const providerChanged = provider !== undefined && provider !== existingProfile.provider;
      const modelChanged = modelName !== undefined && modelName.trim() !== existingProfile.modelName;

      if ((providerChanged || modelChanged) && updatedProfile.isDefault) {
        logger.info('[Embedding Profiles v1] Provider/model changed, triggering re-embedding', {
          profileId: id,
          providerChanged,
          modelChanged,
          newProvider: updatedProfile.provider,
          newModel: updatedProfile.modelName,
        });

        // Invalidate all existing embeddings
        await invalidateAllEmbeddings(user.id, id);

        // Trigger appropriate re-embedding job
        if (updatedProfile.provider === 'BUILTIN') {
          // For BUILTIN, refit vocabulary first (which will trigger reindex)
          await enqueueEmbeddingRefit(user.id, {
            profileId: id,
            triggerReindex: true,
          });
        } else {
          // For external providers, directly reindex all
          await enqueueEmbeddingReindexAll(user.id, {
            profileId: id,
          });
        }
      }

      return NextResponse.json({
        ...updatedProfile,
        ...enriched,
        reembeddingTriggered: (providerChanged || modelChanged) && updatedProfile.isDefault,
      });
    } catch (error) {
      logger.error('[Embedding Profiles v1] Error updating profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to update embedding profile');
    }
  }
);

/**
 * DELETE /api/v1/embedding-profiles/[id]
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

      // Verify ownership
      const existingProfile = await repos.embeddingProfiles.findById(id);

      if (!existingProfile) {
        return notFound('Embedding profile');
      }

      // Delete the profile
      await repos.embeddingProfiles.delete(id);

      logger.info('[Embedding Profiles v1] Profile deleted', { profileId: id });

      return messageResponse('Embedding profile deleted successfully');
    } catch (error) {
      logger.error('[Embedding Profiles v1] Error deleting profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete embedding profile');
    }
  }
);

/**
 * POST /api/v1/embedding-profiles/[id]?action=refit - Manually trigger vocabulary refit
 * POST /api/v1/embedding-profiles/[id]?action=reindex - Manually trigger re-embedding
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  withActionDispatch({
    refit: async (req, { user, repos }, { id }) => {
      try {
        // Verify ownership
        const profile = await repos.embeddingProfiles.findById(id);

        if (!profile) {
          return notFound('Embedding profile');
        }

        // Refit is only for BUILTIN profiles
        if (profile.provider !== 'BUILTIN') {
          return badRequest('Refit is only available for built-in embedding profiles. Use reindex action for external providers.');
        }

        logger.info('[Embedding Profiles v1] Manual refit triggered', { profileId: id });

        // Enqueue refit job (which will trigger reindex after)
        const jobId = await enqueueEmbeddingRefit(user.id, {
          profileId: id,
          triggerReindex: true,
        });

        return successResponse({
          message: 'Vocabulary refit job enqueued',
          jobId,
        });
      } catch (error) {
        logger.error('[Embedding Profiles v1] Error triggering refit', { profileId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to trigger refit');
      }
    },

    reindex: async (req, { user, repos }, { id }) => {
      try {
        // Verify ownership
        const profile = await repos.embeddingProfiles.findById(id);

        if (!profile) {
          return notFound('Embedding profile');
        }

        logger.info('[Embedding Profiles v1] Manual reindex triggered', { profileId: id });

        // Invalidate all embeddings
        const invalidatedCount = await invalidateAllEmbeddings(user.id, id);

        // Enqueue reindex job
        const jobId = await enqueueEmbeddingReindexAll(user.id, {
          profileId: id,
        });

        return successResponse({
          message: 'Re-embedding job enqueued',
          jobId,
          invalidatedCount,
        });
      } catch (error) {
        logger.error('[Embedding Profiles v1] Error triggering reindex', { profileId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to trigger reindex');
      }
    },

    reapply: async (req, { user, repos }, { id }) => {
      try {
        const profile = await repos.embeddingProfiles.findById(id);

        if (!profile) {
          return notFound('Embedding profile');
        }

        if (!profile.truncateToDimensions) {
          return badRequest(
            'Profile has no truncateToDimensions set. Re-apply only slices Matryoshka vectors; nothing to do.'
          );
        }

        logger.info('[Embedding Profiles v1] Manual re-apply (Matryoshka) triggered', {
          profileId: id,
          truncateToDimensions: profile.truncateToDimensions,
          normalizeL2: profile.normalizeL2,
        });

        const jobId = await enqueueEmbeddingReapplyProfile(user.id, {
          profileId: id,
        });

        return successResponse({
          message: 'Embedding profile re-apply job enqueued. A backup of each affected database will be created before any rewrite.',
          jobId,
          targetDimensions: profile.truncateToDimensions,
        });
      } catch (error) {
        logger.error('[Embedding Profiles v1] Error triggering re-apply', { profileId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to trigger re-apply');
      }
    },
  })
);
