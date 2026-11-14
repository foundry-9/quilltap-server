/**
 * Connection Profiles API v1 - Individual Profile Endpoint
 *
 * GET /api/v1/connection-profiles/[id] - Get a specific profile
 * GET /api/v1/connection-profiles/[id]?action=get-tags - Get the profile's tags
 * PUT /api/v1/connection-profiles/[id] - Update a profile
 * DELETE /api/v1/connection-profiles/[id] - Delete a profile
 * POST /api/v1/connection-profiles/[id]?action=add-tag - Add a tag
 * POST /api/v1/connection-profiles/[id]?action=remove-tag - Remove a tag
 * POST /api/v1/connection-profiles/[id]?action=auto-configure - Auto-configure profile settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, RequestContext, resolveEditorTags } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, forbidden, badRequest, serverError, conflict, successResponse } from '@/lib/api/responses';
import { normalizeProfileName } from '@/lib/llm/connection-profile-names';
import { autoConfigureProfile } from '@/lib/services/auto-configure.service';
import {
  ConnectionProfileUpdateSchema,
  applyCourierForcing,
  checkConnectionProfileReferences,
  withoutNullCounters,
} from '@/lib/llm/connection-profile-input';

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
async function enrichProfile(profile: Record<string, unknown>, repos: RequestContext['repos']) {
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
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {const profile = await repos.connections.findById(id);

      if (!profile) {
        return notFound('Connection profile');
      }

      // An unrecognised action is refused rather than quietly serving the whole
      // profile. Leniency here is what hid Bug 74's second layer: `get-tags`
      // did not exist, the GET ignored the parameter, and the caller read
      // `data.tags` off a `{ profile }` body as `undefined` — no tags, no error.
      return await dispatchAction(
        req,
        {
          'get-tags': async () => {
            const tags = await resolveEditorTags(profile.tags, repos);
            return successResponse({ tags });
          },
        },
        async () => {
          const enrichedProfile = await enrichProfile(profile, repos);
          return successResponse({ profile: enrichedProfile });
        }
      );
    } catch (error) {
      logger.error('[Connection Profiles v1] Error fetching profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch connection profile');
    }
  }
);

/**
 * PUT /api/v1/connection-profiles/[id] - Update a profile.
 *
 * The body is `ConnectionProfileUpdateSchema` — any subset, an absent key left
 * alone and `null` clearing a nullable one; a malformed body is the
 * middleware's 400. The database rules are `checkConnectionProfileReferences`,
 * shared with the create.
 */
export const PUT = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    const { user, repos } = context;

    const existingProfile = await repos.connections.findById(id);
    if (!existingProfile) {
      return notFound('Connection profile');
    }

    const patch = withoutNullCounters(ConnectionProfileUpdateSchema.parse(await req.json()));

    // Courier-mode gates (no key, no tools, …) hinge on the transport after
    // this write: the newly-set value, else the stored one.
    const isCourier = (patch.transport ?? existingProfile.transport ?? 'api') === 'courier';
    const provider = patch.provider ?? existingProfile.provider;

    const refusal = await checkConnectionProfileReferences(patch, context, { profileId: id, provider, isCourier });
    if (refusal) {
      return refusal.status === 404 ? notFound('API key') : badRequest(refusal.message);
    }

    if (patch.name !== undefined) {
      // Names are unique per user (case-insensitive, trimmed). Reject a rename
      // that collides with a *different* profile before the DB's unique index
      // would. Renaming a profile to its own name is fine.
      const normalizedName = normalizeProfileName(patch.name);
      const userProfiles = await repos.connections.findByUserId(user.id);
      if (userProfiles.some((p) => p.id !== id && normalizeProfileName(p.name) === normalizedName)) {
        logger.debug('Rejected duplicate connection-profile name on update', {
          userId: user.id,
          profileId: id,
          name: patch.name,
        });
        return conflict(`A connection profile named "${patch.name}" already exists`);
      }
    }

    // If setting as default, unset other defaults
    if (patch.isDefault) {
      const allProfiles = await repos.connections.findByUserId(user.id);
      for (const profile of allProfiles) {
        if (profile.isDefault && profile.id !== id) {
          await repos.connections.update(profile.id, { isDefault: false });
        }
      }
    }

    const updatedProfile = await repos.connections.update(id, applyCourierForcing(patch, isCourier));
    if (!updatedProfile) {
      return serverError('Failed to update connection profile');
    }

    const enrichedProfile = await enrichProfile(updatedProfile, repos);

    logger.info('[Connection Profiles v1] Profile updated', { profileId: id, keys: Object.keys(patch) });

    return successResponse({ profile: enrichedProfile });
  }
);

/**
 * DELETE /api/v1/connection-profiles/[id] - Delete a profile
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {// Verify ownership
      const existingProfile = await repos.connections.findById(id);

      if (!existingProfile) {
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
export const POST = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    // Verify ownership first
    const profile = await repos.connections.findById(id);
    if (!profile) {
      return notFound('Connection profile');
    }

    return dispatchAction(req, {
      'add-tag': async () => {
        const body = await req.json();
        const validatedData = addTagSchema.parse(body);

        // Verify tag exists and belongs to user
        const tag = await repos.tags.findById(validatedData.tagId);
        if (!tag) {
          return notFound('Tag');
        }

        // Add tag to profile
        await repos.connections.addTag(id, validatedData.tagId);

        logger.info('[Connection Profiles v1] Tag added to profile', {
          profileId: id,
          tagId: validatedData.tagId,
        });

        return NextResponse.json({ success: true, tag }, { status: 201 });
      },
      'remove-tag': async () => {
        const body = await req.json();
        const validatedData = removeTagSchema.parse(body);

        // Remove tag from profile
        await repos.connections.removeTag(id, validatedData.tagId);

        logger.info('[Connection Profiles v1] Tag removed from profile', {
          profileId: id,
          tagId: validatedData.tagId,
        });

        return NextResponse.json({ success: true });
      },
      'auto-configure': async () => {
        try {
          // Call auto-configure service
          const result = await autoConfigureProfile(profile.provider, profile.modelName, user.id);

          // Merge result into profile
          const existingParams = typeof profile.parameters === 'string' ? JSON.parse(profile.parameters) : (profile.parameters || {});
          const updateData: Record<string, unknown> = {
            maxContext: result.maxContext,
            maxTokens: result.maxTokens,
            modelClass: result.modelClass,
            isDangerousCompatible: result.isDangerousCompatible,
            parameters: {
              ...existingParams,
              temperature: result.temperature,
              max_tokens: result.maxTokens,
              top_p: result.topP,
            },
          };

          // Update the profile
          const updatedProfile = await repos.connections.update(id, updateData);

          if (!updatedProfile) {
            return serverError('Failed to update connection profile with auto-configure results');
          }

          // Enrich and return the profile
          const enrichedProfile = await enrichProfile(updatedProfile, repos);

          logger.info('[Connection Profiles v1] Profile auto-configured', {
            profileId: id,
            provider: profile.provider,
            modelName: profile.modelName,
            result: {
              maxContext: result.maxContext,
              maxTokens: result.maxTokens,
              temperature: result.temperature,
              topP: result.topP,
              modelClass: result.modelClass,
              isDangerousCompatible: result.isDangerousCompatible,
            },
          });

          return NextResponse.json({ profile: enrichedProfile, autoConfigureResult: result }, { status: 200 });
        } catch (error) {
          logger.error('[Connection Profiles v1] Error auto-configuring profile', { profileId: id }, error instanceof Error ? error : undefined);
          return serverError(error instanceof Error ? error.message : 'Failed to auto-configure connection profile');
        }
      },
    });
  }
);
