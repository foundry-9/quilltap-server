/**
 * Connection Profiles API v1 - Individual Profile Endpoint
 *
 * GET /api/v1/connection-profiles/[id] - Get a specific profile
 * PUT /api/v1/connection-profiles/[id] - Update a profile
 * DELETE /api/v1/connection-profiles/[id] - Delete a profile
 * POST /api/v1/connection-profiles/[id]?action=add-tag - Add a tag
 * POST /api/v1/connection-profiles/[id]?action=remove-tag - Remove a tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, AuthenticatedContext } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, forbidden, badRequest, serverError, validationError } from '@/lib/api/responses';

// Disable caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Validation schemas
const addTagSchema = z.object({
  tagId: z.uuid(),
});

const removeTagSchema = z.object({
  tagId: z.uuid(),
});

/**
 * Helper to enrich profile with API key info
 */
async function enrichProfile(profile: Record<string, unknown>, repos: AuthenticatedContext['repos']) {
  let apiKey = null;
  if (profile.apiKeyId) {
    const key = await repos.connections.findApiKeyById(profile.apiKeyId as string);
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
  const tagIds = (profile.tags as string[]) || [];
  const tagDetails = await Promise.all(
    tagIds.map(async (tagId: string) => {
      const tag = await repos.tags.findById(tagId);
      return tag ? { tagId, tag } : null;
    })
  );

  return {
    ...profile,
    apiKey,
    tags: tagDetails.filter(Boolean),
  };
}

/**
 * GET /api/v1/connection-profiles/[id] - Get a specific connection profile
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Connection Profiles v1] GET profile', {
        profileId: id,
        userId: user.id,
      });

      const profile = await repos.connections.findById(id);

      if (!profile || profile.userId !== user.id) {
        return notFound('Connection profile');
      }

      const enrichedProfile = await enrichProfile(profile, repos);

      return NextResponse.json({ profile: enrichedProfile });
    } catch (error) {
      logger.error('[Connection Profiles v1] Error fetching profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch connection profile');
    }
  }
);

/**
 * PUT /api/v1/connection-profiles/[id] - Update a profile
 */
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Connection Profiles v1] PUT profile', {
        profileId: id,
        userId: user.id,
      });

      // Verify ownership
      const existingProfile = await repos.connections.findById(id);

      if (!existingProfile || existingProfile.userId !== user.id) {
        return notFound('Connection profile');
      }

      const body = await req.json();
      const {
        name,
        provider,
        apiKeyId,
        baseUrl,
        modelName,
        parameters,
        isDefault,
        isCheap,
        allowWebSearch,
        useNativeWebSearch,
      } = body;

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return badRequest('Name must be a non-empty string');
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

          const providerToCheck = provider !== undefined ? provider : existingProfile.provider;
          if (apiKey.provider !== providerToCheck) {
            return badRequest('API key provider does not match profile provider');
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
          const allProfiles = await repos.connections.findByUserId(user.id);
          for (const profile of allProfiles) {
            if (profile.isDefault && profile.id !== id) {
              await repos.connections.update(profile.id, { isDefault: false });
            }
          }
        }

        updateData.isDefault = isDefault;
      }

      if (isCheap !== undefined) {
        if (typeof isCheap !== 'boolean') {
          return badRequest('isCheap must be a boolean');
        }
        updateData.isCheap = isCheap;
      }

      if (allowWebSearch !== undefined) {
        if (typeof allowWebSearch !== 'boolean') {
          return badRequest('allowWebSearch must be a boolean');
        }
        updateData.allowWebSearch = allowWebSearch;
      }

      if (useNativeWebSearch !== undefined) {
        if (typeof useNativeWebSearch !== 'boolean') {
          return badRequest('useNativeWebSearch must be a boolean');
        }
        updateData.useNativeWebSearch = useNativeWebSearch;
      }

      // Update the profile
      const updatedProfile = await repos.connections.update(id, updateData);

      if (!updatedProfile) {
        return serverError('Failed to update connection profile');
      }

      const enrichedProfile = await enrichProfile(updatedProfile, repos);

      logger.info('[Connection Profiles v1] Profile updated', { profileId: id });

      return NextResponse.json({ profile: enrichedProfile });
    } catch (error) {
      logger.error('[Connection Profiles v1] Error updating profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to update connection profile');
    }
  }
);

/**
 * DELETE /api/v1/connection-profiles/[id] - Delete a profile
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('[Connection Profiles v1] DELETE profile', {
        profileId: id,
        userId: user.id,
      });

      // Verify ownership
      const existingProfile = await repos.connections.findById(id);

      if (!existingProfile || existingProfile.userId !== user.id) {
        return notFound('Connection profile');
      }

      // Delete the profile
      await repos.connections.delete(id);

      logger.info('[Connection Profiles v1] Profile deleted', { profileId: id });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('[Connection Profiles v1] Error deleting profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete connection profile');
    }
  }
);

/**
 * POST /api/v1/connection-profiles/[id] - Action dispatch
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const action = getActionParam(req);

    // Verify ownership first
    const profile = await repos.connections.findById(id);
    if (!profile) {
      return notFound('Connection profile');
    }
    if (profile.userId !== user.id) {
      return forbidden();
    }

    switch (action) {
      case 'add-tag': {
        try {
          const body = await req.json();
          const validatedData = addTagSchema.parse(body);

          // Verify tag exists and belongs to user
          const tag = await repos.tags.findById(validatedData.tagId);
          if (!tag) {
            return notFound('Tag');
          }
          if (tag.userId !== user.id) {
            return forbidden();
          }

          // Add tag to profile
          await repos.connections.addTag(id, validatedData.tagId);

          logger.info('[Connection Profiles v1] Tag added to profile', {
            profileId: id,
            tagId: validatedData.tagId,
          });

          return NextResponse.json({ success: true, tag }, { status: 201 });
        } catch (error) {
          if (error instanceof z.ZodError) {
            return validationError(error);
          }
          logger.error('[Connection Profiles v1] Error adding tag', { profileId: id }, error instanceof Error ? error : undefined);
          return serverError('Failed to add tag to connection profile');
        }
      }

      case 'remove-tag': {
        try {
          const body = await req.json();
          const validatedData = removeTagSchema.parse(body);

          // Remove tag from profile
          await repos.connections.removeTag(id, validatedData.tagId);

          logger.info('[Connection Profiles v1] Tag removed from profile', {
            profileId: id,
            tagId: validatedData.tagId,
          });

          return NextResponse.json({ success: true });
        } catch (error) {
          if (error instanceof z.ZodError) {
            return validationError(error);
          }
          logger.error('[Connection Profiles v1] Error removing tag', { profileId: id }, error instanceof Error ? error : undefined);
          return serverError('Failed to remove tag from connection profile');
        }
      }

      default:
        return badRequest(`Unknown action: ${action}. Available actions: add-tag, remove-tag`);
    }
  }
);
