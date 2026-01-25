/**
 * Images API v1 - Collection Endpoint
 *
 * GET /api/v1/images - List images with optional filtering
 * POST /api/v1/images - Upload or import image
 * POST /api/v1/images?action=generate - Generate images using LLM providers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { uploadImage, importImageFromUrl } from '@/lib/images-v2';
import { decryptApiKey } from '@/lib/encryption';
import { createLLMProvider } from '@/lib/llm';
import { logger } from '@/lib/logger';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { getInheritedTags } from '@/lib/files/tag-inheritance';
import { z } from 'zod';
import { successResponse, badRequest, serverError, validationError } from '@/lib/api/responses';
import { createHash } from 'crypto';
import type { FileCategory, FileSource } from '@/lib/schemas/types';

const importFromUrlSchema = z.object({
  url: z.url(),
  tags: z
    .array(
      z.object({
        tagType: z.enum(['CHARACTER', 'PERSONA', 'CHAT', 'THEME']),
        tagId: z.string(),
      })
    )
    .optional(),
});

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  profileId: z.uuid(),
  tags: z
    .array(
      z.object({
        tagType: z.enum(['CHARACTER', 'PERSONA', 'CHAT', 'THEME']),
        tagId: z.string(),
      })
    )
    .optional(),
  options: z
    .object({
      n: z.int().min(1).max(10).optional(),
      size: z.string().optional(),
      quality: z.enum(['standard', 'hd']).optional(),
      style: z.enum(['vivid', 'natural']).optional(),
      aspectRatio: z.string().optional(),
    })
    .optional(),
});

// ============================================================================
// GET Handler - List images
// ============================================================================

export const GET = createAuthenticatedHandler(async (request, { user, repos }) => {
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
      const filepath = (img.storageKey || img.s3Key) ? `/api/v1/files/${img.id}` : img.originalFilename;

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

    logger.info('[Images v1] Retrieved image list', { userId: user.id, imageCount: data.length });

    return successResponse({ data });
  } catch (error) {
    logger.error('[Images v1] Error fetching images', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch images');
  }
});

// ============================================================================
// POST Handler - Upload/Import or Generate
// ============================================================================

export const POST = createAuthenticatedHandler(async (request, { user, repos }) => {
  const action = getActionParam(request);

  // Handle generate action
  if (action === 'generate') {
    return handleGenerateImage(request, user, repos);
  }

  // Default: upload or import image
  return handleUploadOrImport(request, user, repos);
});

// ============================================================================
// Helper: Generate Image
// ============================================================================

async function handleGenerateImage(request: NextRequest, user: { id: string }, repos: any): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { prompt, profileId, tags, options = {} } = generateImageSchema.parse(body);


    // Load and validate connection profile
    const profile = await repos.connections.findById(profileId);

    if (!profile || profile.userId !== user.id) {
      return badRequest('Connection profile not found');
    }

    // Get API key if profile has one
    let decryptedKey = '';
    if (profile.apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId);
      if (apiKey) {
        decryptedKey = decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, user.id);
      }
    }

    // Create provider instance
    const provider = await createLLMProvider(profile.provider as any, profile.baseUrl ?? undefined);

    // Verify provider supports image generation
    if (!provider.supportsImageGeneration) {
      return badRequest(`${profile.provider} provider does not support image generation`);
    }

    // Build image generation request
    const imageGenRequest = {
      prompt,
      model: profile.modelName,
      n: options.n,
      size: options.size,
      quality: options.quality,
      style: options.style,
      aspectRatio: options.aspectRatio,
    };

    // Generate images - generateImage takes (request, apiKey)
    const imageGenResponse = await provider.generateImage(imageGenRequest, decryptedKey);

    // Build linkedTo from tags
    const linkedTo = tags?.map(t => t.tagId) || [];

    // Store generated images as files
    const savedImages = await Promise.all(
      imageGenResponse.images.map(async (generatedImage, index) => {
        // Decode base64 to buffer
        const imageBuffer = Buffer.from(generatedImage.data, 'base64');

        // Get file extension from mime type
        const mimeTypeParts = generatedImage.mimeType.split('/');
        const ext = mimeTypeParts[1] === 'jpeg' ? 'jpg' : mimeTypeParts[1] || 'png';

        // Generate unique filename and hash
        const sha256 = createHash('sha256').update(new Uint8Array(imageBuffer)).digest('hex');
        const shortHash = sha256.substring(0, 8);
        const filename = `generated_${Date.now()}_${index}_${shortHash}.${ext}`;

        // Generate a new file ID
        const fileId = crypto.randomUUID();
        const category: FileCategory = 'IMAGE';
        const source: FileSource = 'GENERATED';

        // Upload to file storage
        const { storageKey, mountPointId } = await fileStorageManager.uploadFile({
          userId: user.id,
          fileId,
          filename,
          content: imageBuffer,
          contentType: generatedImage.mimeType,
          projectId: null,
          folderPath: '/',
        });


        // Inherit tags from linked entities
        const inheritedTags = await getInheritedTags(linkedTo, user.id);

        // Create database record
        const file = await repos.files.create({
          sha256,
          userId: user.id,
          originalFilename: filename,
          mimeType: generatedImage.mimeType,
          size: imageBuffer.length,
          source,
          category,
          linkedTo,
          generationPrompt: prompt,
          generationModel: profile.modelName,
          generationRevisedPrompt: generatedImage.revisedPrompt || null,
          tags: inheritedTags,
          storageKey,
          mountPointId,
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Images v1] Error generating images', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to generate images');
  }
}

// ============================================================================
// Helper: Upload or Import Image
// ============================================================================

async function handleUploadOrImport(request: NextRequest, user: { id: string }, repos: any): Promise<NextResponse> {
  try {
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
      let tags: Array<{ tagType: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME'; tagId: string }> | undefined;
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Images v1] Error uploading/importing image', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to upload/import image');
  }
}
