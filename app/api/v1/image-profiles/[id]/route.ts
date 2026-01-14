/**
 * Image Profiles API v1 - Individual Profile Endpoint
 *
 * GET /api/v1/image-profiles/[id] - Get a specific profile
 * PUT /api/v1/image-profiles/[id] - Update a profile
 * DELETE /api/v1/image-profiles/[id] - Delete a profile
 * POST /api/v1/image-profiles/[id]?action=generate - Generate image using this profile
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { notFound, badRequest, serverError, messageResponse } from '@/lib/api/responses';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/image-profiles/[id]
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Image Profiles v1] GET profile', { profileId: id, userId: user.id });

      const profile = await repos.imageProfiles.findById(id);

      if (!profile || profile.userId !== user.id) {
        return notFound('Image profile');
      }

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

      // Get tag details
      const tagDetails = await Promise.all(
        profile.tags.map(async (tagId) => {
          const tag = await repos.tags.findById(tagId);
          return tag ? { tagId, tag } : null;
        })
      );

      return NextResponse.json({
        ...profile,
        apiKey,
        tags: tagDetails.filter(Boolean),
      });
    } catch (error) {
      logger.error('[Image Profiles v1] Error fetching profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch image profile');
    }
  }
);

/**
 * PUT /api/v1/image-profiles/[id]
 */
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Image Profiles v1] PUT update profile', { profileId: id, userId: user.id });

      // Verify ownership
      const existingProfile = await repos.imageProfiles.findById(id);

      if (!existingProfile || existingProfile.userId !== user.id) {
        return notFound('Image profile');
      }

      const body = await req.json();
      const { name, provider, apiKeyId, baseUrl, modelName, parameters, isDefault } = body;

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return badRequest('Name must be a non-empty string');
        }

        // Check for duplicate name (excluding current profile)
        const duplicateProfile = await repos.imageProfiles.findByName(user.id, name.trim());

        if (duplicateProfile && duplicateProfile.id !== id) {
          return NextResponse.json(
            { error: 'An image profile with this name already exists' },
            { status: 409 }
          );
        }

        updateData.name = name.trim();
      }

      if (provider !== undefined) {
        if (typeof provider !== 'string' || provider.trim().length === 0) {
          return badRequest('Provider must be a non-empty string');
        }

        // Verify provider is available
        try {
          createImageProvider(provider);
        } catch {
          return badRequest(`Provider ${provider} is not available`);
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

      if (parameters !== undefined) {
        if (typeof parameters !== 'object' || Array.isArray(parameters)) {
          return badRequest('Parameters must be an object');
        }
        updateData.parameters = parameters;
      }

      if (isDefault !== undefined) {
        if (typeof isDefault !== 'boolean') {
          return badRequest('isDefault must be a boolean');
        }

        // If setting as default, unset other defaults
        if (isDefault) {
          await repos.imageProfiles.unsetAllDefaults(user.id);
        }

        updateData.isDefault = isDefault;
      }

      // Update the profile
      const updatedProfile = await repos.imageProfiles.update(id, updateData);

      if (!updatedProfile) {
        return serverError('Failed to update profile');
      }

      // Enrich with API key info
      let apiKey = null;
      if (updatedProfile.apiKeyId) {
        const key = await repos.connections.findApiKeyById(updatedProfile.apiKeyId);
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
        updatedProfile.tags.map(async (tagId) => {
          const tag = await repos.tags.findById(tagId);
          return tag ? { tagId, tag } : null;
        })
      );

      logger.info('[Image Profiles v1] Profile updated', { profileId: id });

      return NextResponse.json({
        ...updatedProfile,
        apiKey,
        tags: tagDetails.filter(Boolean),
      });
    } catch (error) {
      logger.error('[Image Profiles v1] Error updating profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to update image profile');
    }
  }
);

/**
 * DELETE /api/v1/image-profiles/[id]
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Image Profiles v1] DELETE profile', { profileId: id, userId: user.id });

      // Verify ownership
      const existingProfile = await repos.imageProfiles.findById(id);

      if (!existingProfile || existingProfile.userId !== user.id) {
        return notFound('Image profile');
      }

      // Delete the profile
      await repos.imageProfiles.delete(id);

      logger.info('[Image Profiles v1] Profile deleted', { profileId: id });

      return messageResponse('Image profile deleted successfully');
    } catch (error) {
      logger.error('[Image Profiles v1] Error deleting profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete image profile');
    }
  }
);
