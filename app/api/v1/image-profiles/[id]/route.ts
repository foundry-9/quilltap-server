/**
 * Image Profiles API v1 - Individual Profile Endpoint
 *
 * GET /api/v1/image-profiles/[id] - Get a specific profile
 * PUT /api/v1/image-profiles/[id] - Update a profile
 * DELETE /api/v1/image-profiles/[id] - Delete a profile
 * POST /api/v1/image-profiles/[id]?action=generate - Generate image using this profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, enrichProfile, type RequestContext } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { notFound, badRequest, serverError, messageResponse, successResponse, conflict } from '@/lib/api/responses';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { executeImageGenerationTool } from '@/lib/tools/handlers/image-generation-handler';
import { logger } from '@/lib/logger';
import { ImageProfileUpdateSchema } from '@/lib/image-gen/image-profile-input';
import { apiKeyExists } from '@/lib/schemas/profile-input';
import { z } from 'zod';
import { imageQualitySchema } from '@/lib/image-gen/quality';

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  chatId: z.uuid().optional(),
  count: z.int().min(1).max(10).prefault(1),
  size: z.string().optional(),
  quality: imageQualitySchema.optional(),
  style: z.enum(['vivid', 'natural']).optional(),
  aspectRatio: z.string().optional(),
  negativePrompt: z.string().optional(),
});

/**
 * GET /api/v1/image-profiles/[id]
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

      const profile = await repos.imageProfiles.findById(id);

      if (!profile) {
        return notFound('Image profile');
      }

      // Enrich with API key and tag details
      const enriched = await enrichProfile(profile, repos);

      return NextResponse.json({
        ...profile,
        ...enriched,
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
export const PUT = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const existingProfile = await repos.imageProfiles.findById(id);
    if (!existingProfile) {
      return notFound('Image profile');
    }

    // A malformed body (the LoRA list included) is the middleware's 400.
    const patch = ImageProfileUpdateSchema.parse(await req.json());

    if (patch.name !== undefined) {
      const duplicateProfile = await repos.imageProfiles.findByName(user.id, patch.name);
      if (duplicateProfile && duplicateProfile.id !== id) {
        return conflict('An image profile with this name already exists');
      }
    }

    if (patch.provider !== undefined) {
      try {
        createImageProvider(patch.provider);
      } catch {
        return badRequest(`Provider ${patch.provider} is not available`);
      }
    }

    if (!(await apiKeyExists(patch.apiKeyId, repos))) {
      return notFound('API key');
    }

    // If setting as default, unset other defaults
    if (patch.isDefault) {
      await repos.imageProfiles.unsetAllDefaults(user.id);
    }

    const updatedProfile = await repos.imageProfiles.update(id, patch);
    if (!updatedProfile) {
      return serverError('Failed to update profile');
    }

    const enriched = await enrichProfile(updatedProfile, repos);

    logger.info('[Image Profiles v1] Profile updated', { profileId: id, keys: Object.keys(patch) });

    return successResponse({ ...updatedProfile, ...enriched });
  }
);

/**
 * DELETE /api/v1/image-profiles/[id]
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

      // Verify ownership
      const existingProfile = await repos.imageProfiles.findById(id);

      if (!existingProfile) {
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

/**
 * POST /api/v1/image-profiles/[id]?action=generate
 * Generate images using this profile with placeholder expansion support
 */
export const POST = createContextParamsHandler<{ id: string }>(
  async (req, ctx, { id }) => dispatchAction(req, { generate: () => handleGenerate(req, ctx, id) })
);

async function handleGenerate(
  req: NextRequest,
  { user, repos }: RequestContext,
  id: string
): Promise<NextResponse> {
    // Verify profile exists and belongs to user
    const profile = await repos.imageProfiles.findById(id);

    if (!profile) {
      return notFound('Image profile');
    }

    // Validate request body
    const body = await req.json();
    const validated = generateImageSchema.parse(body);

    // Execute image generation with prompt expansion support
    const result = await executeImageGenerationTool(
      {
        prompt: validated.prompt,
        count: validated.count,
        size: validated.size,
        quality: validated.quality,
        style: validated.style,
        aspectRatio: validated.aspectRatio,
        negativePrompt: validated.negativePrompt,
      },
      {
        userId: user.id,
        profileId: id,
        chatId: validated.chatId,
      }
    );

    if (!result.success) {
      logger.warn('[Image Profiles v1] Image generation failed', {
        profileId: id,
        error: result.error,
      });
      return badRequest(result.error || 'Image generation failed');
    }

    logger.info('[Image Profiles v1] Image generation complete', {
      profileId: id,
      imageCount: result.images?.length || 0,
    });

    return successResponse({
      success: true,
      data: result.images,
      expandedPrompt: result.expandedPrompt,
      metadata: {
        originalPrompt: validated.prompt,
        provider: result.provider,
        model: result.model,
        count: result.images?.length || 0,
      },
    }, 201);
}
