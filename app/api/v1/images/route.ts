/**
 * Images API v1 - Collection Endpoint
 *
 * GET /api/v1/images - List images with optional filtering
 * POST /api/v1/images - Upload or import image
 * POST /api/v1/images?action=generate - Generate images using LLM providers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { uploadImage, importImageFromUrl } from '@/lib/images-v2';
import { createImageProvider } from '@/lib/llm';
import { trackActivity } from '@/lib/background-jobs/activity-registry';
import { logger } from '@/lib/logger';
import {
  getLanternBackgroundsStore,
  writeLanternBackgroundToMountStore,
} from '@/lib/file-storage/lantern-store-bridge';
import { getInheritedTags } from '@/lib/files/tag-inheritance';
import { z } from 'zod';
import { imageQualitySchema } from '@/lib/image-gen/quality';
import { successResponse, badRequest, serverError } from '@/lib/api/responses';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import type { FileCategory, FileSource } from '@/lib/schemas/types';
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';
import { classifyContent as classifyDangerousContent } from '@/lib/services/dangerous-content/gatekeeper.service';
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG, type CheapLLMConfig } from '@/lib/llm/cheap-llm';
import { getErrorMessage } from '@/lib/error-utils';
import { convertToWebP } from '@/lib/files/webp-conversion';
import { buildImageGenParams } from '@/lib/image-gen/params-builder';
import { generateImageWithConciergeFailover } from '@/lib/services/dangerous-content/image-failover';
import { resolveUncensoredTextUnderstudy } from '@/lib/services/dangerous-content/understudy';
import { supportsImageGeneration } from '@/lib/llm/image-capable';
import type { ConnectionProfile } from '@/lib/schemas/types';

const importFromUrlSchema = z.object({
  url: z.url(),
  tags: z
    .array(
      z.object({
        tagType: z.enum(['CHARACTER', 'CHAT', 'THEME']),
        tagId: z.string(),
      })
    )
    .optional(),
});

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  profileId: z.uuid(),
  /**
   * The chat that asked for the image, when one did. Folded into the new
   * file's `linkedTo` beside the tag ids so a chat-scoped read
   * (`files.findByLinkedTo(chatId)` — the chat file listing, the chat
   * gallery, the stale-chat collapse sweep) can see it. Matches the
   * contract the sibling entry point already keeps
   * (`POST /api/v1/image-profiles/[id]?action=generate`). See bug 130.
   */
  chatId: z.uuid().optional(),
  tags: z
    .array(
      z.object({
        tagType: z.enum(['CHARACTER', 'CHAT', 'THEME']),
        tagId: z.string(),
      })
    )
    .optional(),
  options: z
    .object({
      n: z.int().min(1).max(10).optional(),
      size: z.string().optional(),
      quality: imageQualitySchema.optional(),
      style: z.enum(['vivid', 'natural']).optional(),
      aspectRatio: z.string().optional(),
    })
    .optional(),
});

// ============================================================================
// GET Handler - List images
// ============================================================================

export const GET = createContextHandler(async (request, { user, repos }) => {
  try {

    const searchParams = request.nextUrl.searchParams;
    const tagId = searchParams.get('tagId');

    // Get all image files for this user from the repository
    const allImages = await repos.files.findByCategory('IMAGE');
    let images = allImages.filter(img => img.userId === user.id);

    // Filter by tag if provided
    if (tagId) {
      images = images.filter(img => img.tags.includes(tagId));
    }

    // Sort by createdAt descending
    images.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Transform to match expected API response format
    const allCharacters = await repos.characters.findByUserId(user.id);

    // Build tag type lookup maps
    const characterIds = new Set(allCharacters.map(c => c.id));

    const data = images.map(img => {
      // Count characters using this image as default
      const charactersUsingAsDefault = allCharacters.filter(
        c => c.defaultImageId === img.id
      ).length;

      // Count chat avatar overrides
      let chatAvatarOverrides = 0;
      for (const char of allCharacters) {
        if (char.avatarOverrides) {
          chatAvatarOverrides += char.avatarOverrides.filter(
            override => override.imageId === img.id
          ).length;
        }
      }

      // Determine tag type for each tag ID
      const tags = img.tags.map(tagId => {
        let tagType: 'CHARACTER' | 'CHAT' | 'THEME' = 'THEME';
        if (characterIds.has(tagId)) {
          tagType = 'CHARACTER';
        }
        return { tagId, tagType };
      });

      // Map source to old format
      const source = img.source === 'UPLOADED' ? 'upload' :
                     img.source === 'IMPORTED' ? 'import' :
                     img.source === 'GENERATED' ? 'generated' : 'upload';

      // Use API route for file path
      const filepath = img.storageKey ? `/api/v1/files/${img.id}` : img.originalFilename;

      return {
        id: img.id,
        userId: user.id,
        filename: img.originalFilename,
        filepath,
        url: img.source === 'IMPORTED' ? img.description : null,
        mimeType: img.mimeType,
        size: img.size,
        width: img.width,
        height: img.height,
        source,
        generationPrompt: img.generationPrompt,
        generationModel: img.generationModel,
        createdAt: img.createdAt,
        updatedAt: img.updatedAt,
        tags,
        _count: {
          charactersUsingAsDefault,
          chatAvatarOverrides,
        },
      };
    });

    return successResponse({ data });
  } catch (error) {
    logger.error('[Images v1] Error fetching images', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch images');
  }
});

// ============================================================================
// POST Handler - Upload/Import or Generate
// ============================================================================

export const POST = createContextHandler(async (request, { user, repos }) =>
  dispatchAction(
    request,
    {
      // Generation is synchronous here rather than queued, so it registers
      // with the activity registry to keep the "Img" chip honest (the
      // Concierge check inside counts under "Dgr" on its own).
      generate: () => trackActivity('image', () => handleGenerateImage(request, user, repos)),
    },
    // Default: upload or import image
    () => handleUploadOrImport(request, user, repos)
  )
);

// ============================================================================
// Helper: Generate Image
// ============================================================================

async function handleGenerateImage(request: NextRequest, user: { id: string }, repos: any): Promise<NextResponse> {
  const body = await request.json();
  const { prompt, profileId, chatId, tags, options = {} } = generateImageSchema.parse(body);

  // Load and validate connection profile
  let profile = await repos.connections.findById(profileId);

  if (!profile) {
    return badRequest('Connection profile not found');
  }

  // Concierge settings, resolved WITH the chat when one asked, so a chat's own
  // Concierge state (Locked, Unmoderated) governs its pictures too.
  // Fail safe, like the classification below: a settings read that fails
  // leaves the Concierge at its defaults rather than failing the picture.
  let chatSettings = null;
  let chatForConcierge = null;
  try {
    chatSettings = await repos.chatSettings.findByUserId(user.id);
    if (chatId) {
      chatForConcierge = await repos.chats.findById(chatId);
    }
  } catch (error) {
    logger.warn('[Images v1] Could not load Concierge settings; using defaults', {
      chatId: chatId ?? null,
      error: getErrorMessage(error),
    });
  }
  const conciergePolicy = resolveConciergeSettings(chatSettings ?? null, chatForConcierge);
  logger.debug('[Images v1] Generate: resolved Concierge policy', {
    chatId: chatId ?? null,
    conciergeSource: conciergePolicy.source,
    conciergeState: conciergePolicy.state,
    preScreen: conciergePolicy.preScreen.enabled,
    withChat: !!chatForConcierge,
  });

  // the Concierge integration: route an Unmoderated chat direct, or classify
  // the prompt and potentially reroute the provider
  try {
      if (conciergePolicy.routeDirect) {
        // The verdict is already in — no pre-screen to wait on.
        const direct = await resolveUncensoredTextUnderstudy({
          userId: user.id,
          conciergePolicy,
          exclude: [profile.id],
          filter: (candidate) => supportsImageGeneration(candidate.provider),
        });
        if (direct) {
          logger.info('[Images v1] Unmoderated chat routed direct to uncensored connection profile', {
            userId: user.id,
            chatId: chatId ?? null,
            originalProfileId: profileId,
            uncensoredProfileId: direct.profile.id,
            uncensoredProfileName: direct.profile.name,
          });
          profile = direct.profile;
        } else {
          logger.debug('[Images v1] Unmoderated chat has no uncensored image-capable profile; using original', {
            userId: user.id,
            chatId: chatId ?? null,
          });
        }
      }


      if (conciergePolicy.preScreen.enabled && conciergePolicy.preScreen.scanImagePrompts) {
        // Build cheap LLM selection for classification
        const allProfiles = await repos.connections.findByUserId(user.id);
        const cheapLLMConfig: CheapLLMConfig = chatSettings?.cheapLLMSettings ? {
          strategy: chatSettings.cheapLLMSettings.strategy,
          userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
          defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
          fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
        } : DEFAULT_CHEAP_LLM_CONFIG;

        const defaultProfile = allProfiles.find((p: any) => p.isDefault) || allProfiles[0];
        if (defaultProfile) {
          const cheapLLMSelection = getCheapLLMProvider(
            defaultProfile,
            cheapLLMConfig,
            allProfiles,
            false
          );

          const classification = await classifyDangerousContent(
            prompt,
            cheapLLMSelection,
            user.id,
            conciergePolicy
          );

          if (classification.isDangerous) {
            logger.info('[Images v1] Front page image prompt classified as dangerous', {
              userId: user.id,
              score: classification.score,
              categories: classification.categories.map(c => c.category),
              conciergeSource: conciergePolicy.source,
            });

            // Where failover is allowed, try to find an uncensored provider
            if (conciergePolicy.failoverAllowed) {
              const uncensoredProfile = allProfiles.find(
                (p: any) => p.isDangerousCompatible === true && p.id !== profile.id
              );

              if (uncensoredProfile) {
                profile = uncensoredProfile;
                logger.info('[Images v1] Rerouted to uncensored connection profile', {
                  userId: user.id,
                  originalProfileId: profileId,
                  uncensoredProfileId: uncensoredProfile.id,
                  uncensoredProfileName: uncensoredProfile.name,
                });
              } else {
                logger.warn('[Images v1] No uncensored connection profile available, using original', {
                  userId: user.id,
                });
              }
            }
          }
        }
      }
    } catch (error) {
      // Fail safe — never block on the Concierge errors
      logger.error('[Images v1] the Concierge classification failed, continuing normally', {
        userId: user.id,
        error: getErrorMessage(error),
      });
    }

  // Get API key if profile has one
  let decryptedKey = '';
  if (profile.apiKeyId) {
    const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId);
    if (apiKey) {
      decryptedKey = apiKey.key_value;
    }
  }

  // Fail fast when the chosen profile cannot draw at all.
  let primaryProvider;
  try {
    primaryProvider = createImageProvider(profile.provider as any, profile.baseUrl ?? undefined);
  } catch {
    return badRequest(`${profile.provider} provider does not support image generation`);
  }
  const primaryProfileId = profile.id;

  // One call against one connection profile. The shared builder gives this
  // route the profile's stored defaults, LoRAs and residual options the same
  // way the Salon's `generate_image` does. No orientation is resolved: this
  // route's caller passes an explicit size and means it.
  const attempt = async (candidate: ConnectionProfile, key: string) => {
    const provider = candidate.id === primaryProfileId
      ? primaryProvider
      : createImageProvider(candidate.provider as any, candidate.baseUrl ?? undefined);
    const { params } = buildImageGenParams({
      profile: candidate,
      prompt,
      overrides: {
        n: options.n,
        size: options.size,
        quality: options.quality,
        style: options.style,
        aspectRatio: options.aspectRatio,
      },
      logContext: { context: 'api.v1.images.generate', profileId: candidate.id },
    });
    return provider.generateImage(params, key);
  };

  // Generate through the Concierge's failover chokepoint. This route still
  // draws from CONNECTION profiles, so its understudy is an uncensored
  // connection profile whose provider can generate images.
  const failover = await generateImageWithConciergeFailover<Awaited<ReturnType<typeof attempt>>, ConnectionProfile>(
    { profile, apiKey: decryptedKey },
    attempt,
    {
      userId: user.id,
      chatId: chatId ?? null,
      purpose: 'dialog',
      conciergePolicy,
      chat: chatForConcierge,
      profileKind: 'connection',
      primaryVia: profile.id !== profileId ? 'concierge' : 'primary',
      resolveUnderstudy: (exclude) => resolveUncensoredTextUnderstudy({
        userId: user.id,
        conciergePolicy,
        exclude,
        filter: (candidate) => supportsImageGeneration(candidate.provider),
      }),
    },
  );
  const imageGenResponse = failover.result;
  if (failover.rerouted) {
    logger.info('[Images v1] Concierge rerouted a refused image request', {
      userId: user.id,
      originalProfileId: profile.id,
      answeringProfileId: failover.profile.id,
      answeringProvider: failover.profile.provider,
    });
    profile = failover.profile;
  }

  // Build linkedTo from the tags plus the chat that asked for the image.
  // Deduped: a caller passing both a CHAT tag and `chatId` must not link the
  // same id twice, which would double every inherited tag downstream.
  const linkedTo = Array.from(new Set([
    ...(tags?.map(t => t.tagId) ?? []),
    ...(chatId ? [chatId] : []),
  ]));
  logger.debug('[Images v1] Generate: resolved linkedTo', {
    profileId,
    chatId: chatId ?? null,
    tagCount: tags?.length ?? 0,
    linkedToCount: linkedTo.length,
  });

  // Store generated images as files
  const savedImages = await Promise.all(
    imageGenResponse.images.map(async (generatedImage, index) => {
      // Decode base64 to buffer
      const imageData = generatedImage.data || generatedImage.b64Json;
      if (!imageData) {
        throw new Error('Generated image has no data');
      }
      const rawBuffer = Buffer.from(imageData, 'base64');

      // Get file extension from mime type
      const providerMime = generatedImage.mimeType || 'image/png';
      const mimeTypeParts = providerMime.split('/');
      const ext = mimeTypeParts[1] === 'jpeg' ? 'jpg' : mimeTypeParts[1] || 'png';
      const providerFilename = `generated_${Date.now()}_${index}.${ext}`;

      // Convert to WebP for consistent storage
      const converted = await convertToWebP(rawBuffer, providerMime, providerFilename);
      const imageBuffer = converted.buffer;
      const imageMimeType = converted.mimeType;

      // Generate unique filename and hash
      const sha256 = sha256OfBuffer(imageBuffer);
      const shortHash = sha256.substring(0, 8);
      const filename = `generated_${Date.now()}_${index}_${shortHash}.webp`;

      // Generate a new file ID
      const fileId = crypto.randomUUID();
      const category: FileCategory = 'IMAGE';
      const source: FileSource = 'GENERATED';

      // Route through Lantern Backgrounds. The mount is provisioned by
      // provision-lantern-backgrounds-mount-v1; if it is somehow missing, fail
      // rather than leak generated bytes into the catch-all _general/ space.
      const lantern = await getLanternBackgroundsStore();
      if (!lantern) {
        throw new Error(
          'Lantern Backgrounds mount is not provisioned; cannot persist generated image.',
        );
      }
      const written = await writeLanternBackgroundToMountStore({
        filename,
        content: imageBuffer,
        contentType: imageMimeType,
        subfolder: 'tool',
      });
      const storageKey = written.storageKey;


      // Inherit tags from linked entities
      const inheritedTags = await getInheritedTags(linkedTo, user.id);

      // Create database record. The Lantern bridge transcodes bitmaps to
      // WebP; record the stored mime/size so vision providers don't reject
      // "media_type X but bytes are Y" mismatches.
      const file = await repos.files.create({
        sha256,
        userId: user.id,
        originalFilename: filename,
        mimeType: written.storedMimeType,
        size: written.sizeBytes,
        source,
        category,
        linkedTo,
        generationPrompt: prompt,
        generationModel: profile.modelName,
        generationRevisedPrompt: generatedImage.revisedPrompt || null,
        tags: inheritedTags,
        storageKey,
      }, { id: fileId });

      // Use API route for file path
      const filepath = `/api/v1/files/${file.id}`;

      return {
        id: file.id,
        filename: file.originalFilename,
        filepath,
        url: filepath,
        mimeType: file.mimeType,
        size: file.size,
        revisedPrompt: generatedImage.revisedPrompt,
        tags: tags || [],
      };
    })
  );

  logger.info('[Images v1] Image generation complete', {
    userId: user.id,
    generatedCount: savedImages.length,
  });

  return successResponse({
    data: savedImages,
    metadata: {
      prompt,
      provider: profile.provider,
      model: profile.modelName,
      count: savedImages.length,
    },
  }, 201);
}

// ============================================================================
// Helper: Upload or Import Image
// ============================================================================

async function handleUploadOrImport(request: NextRequest, user: { id: string }, repos: any): Promise<NextResponse> {
  const contentType = request.headers.get('content-type') || '';

  // Handle URL import (JSON payload)
  if (contentType.includes('application/json')) {
    const body = await request.json();
    const { url, tags } = importFromUrlSchema.parse(body);

    // Build linkedTo array from tags
    const linkedTo = tags ? tags.map(t => t.tagId) : [];

    // Import image from URL (creates file entry automatically)
    const imageData = await importImageFromUrl(url, user.id, linkedTo);

    // Add tags to the file using repository
    if (tags) {
      for (const tag of tags) {
        await repos.files.addTag(imageData.id, tag.tagId);
      }
    }

    logger.info('[Images v1] Image imported from URL', { imageId: imageData.id, userId: user.id });

    // Transform response - use filepath from ImageUploadResult
    const responseData = {
      id: imageData.id,
      userId: user.id,
      filename: imageData.filename,
      filepath: imageData.filepath,
      url: url,
      mimeType: imageData.mimeType,
      size: imageData.size,
      width: imageData.width,
      height: imageData.height,
      source: 'import',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: tags || [],
    };

    return successResponse({ data: responseData }, 201);
  }

  // Handle file upload (multipart/form-data)
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const tagsJson = formData.get('tags') as string | null;

    if (!file) {
      return badRequest('No file provided');
    }


    // Parse tags if provided
    let tags: Array<{ tagType: 'CHARACTER' | 'CHAT' | 'THEME'; tagId: string }> | undefined;
    if (tagsJson) {
      try {
        tags = JSON.parse(tagsJson);
      } catch {
        return badRequest('Invalid tags JSON');
      }
    }

    // Build linkedTo array from tags
    const linkedTo = tags ? tags.map(t => t.tagId) : [];

    // Upload image (creates file entry automatically)
    const imageData = await uploadImage(file, user.id, linkedTo);

    // Add tags to the file using repository
    if (tags) {
      for (const tag of tags) {
        await repos.files.addTag(imageData.id, tag.tagId);
      }
    }

    logger.info('[Images v1] Image uploaded', { imageId: imageData.id, userId: user.id });

    // Transform response - use filepath from ImageUploadResult
    const responseData = {
      id: imageData.id,
      userId: user.id,
      filename: imageData.filename,
      filepath: imageData.filepath,
      url: null,
      mimeType: imageData.mimeType,
      size: imageData.size,
      width: imageData.width,
      height: imageData.height,
      source: 'upload',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: tags || [],
    };

    return successResponse({ data: responseData }, 201);
  }

  return badRequest('Invalid content type');
}
