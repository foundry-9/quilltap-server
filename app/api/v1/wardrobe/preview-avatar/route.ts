/**
 * Wardrobe Avatar Preview API v1
 *
 * POST /api/v1/wardrobe/preview-avatar
 *
 * Generates a one-off character avatar against an arbitrary equipped-slot
 * snapshot the dialog is showing. The result is saved as a regular generated
 * image (so the user can download it from the dialog), but is NOT persisted
 * onto the character's `avatarOverrides` or any chat's `characterAvatars`.
 * Out-of-chat avatars never overwrite the canonical character avatar.
 *
 * Body: { characterId, equippedSlots, imageProfileId? }
 *
 * Response: { fileId, url, mimeType, prompt }
 */

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, serverError } from '@/lib/api/responses';
import { buildCharacterAvatarPrompt } from '@/lib/wardrobe/avatar-prompt';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { convertToWebP } from '@/lib/files/webp-conversion';
import type { FileCategory, FileSource } from '@/lib/schemas/types';
import { EquippedSlotsSchema } from '@/lib/schemas/wardrobe.types';

const previewAvatarSchema = z.object({
  characterId: z.string().min(1, 'characterId is required'),
  equippedSlots: EquippedSlotsSchema,
  imageProfileId: z.string().min(1).optional(),
});

export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  let parsed: z.infer<typeof previewAvatarSchema>;
  try {
    parsed = previewAvatarSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return badRequest(err.issues.map((e) => e.message).join(', '));
    }
    throw err;
  }

  const { characterId, equippedSlots, imageProfileId } = parsed;

  const character = await repos.characters.findById(characterId);
  if (!character || character.userId !== user.id) {
    return badRequest('Character not found');
  }

  // Resolve image profile: explicit override → default
  let imageProfile = null;
  if (imageProfileId) {
    imageProfile = await repos.imageProfiles.findById(imageProfileId);
  }
  if (!imageProfile) {
    const all = await repos.imageProfiles.findAll();
    imageProfile = all.find((p) => p.isDefault) ?? all[0] ?? null;
  }

  if (!imageProfile) {
    return badRequest('No image profile available for avatar generation');
  }

  if (!imageProfile.apiKeyId) {
    return badRequest('Selected image profile has no API key configured');
  }

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(
    imageProfile.apiKeyId,
    user.id,
  );
  if (!apiKey?.key_value) {
    return badRequest('API key for image profile is missing or invalid');
  }

  const { prompt, hasAppearance, leafCounts } = await buildCharacterAvatarPrompt(
    repos,
    character,
    { equippedSlots },
  );

  if (!hasAppearance) {
    return badRequest(
      'No appearance data available — add a physical description or equip wardrobe items first',
    );
  }

  logger.debug('[Avatar Preview] Generating preview', {
    context: 'wardrobe.preview-avatar',
    characterId,
    profile: imageProfile.name,
    promptLength: prompt.length,
    leafCounts,
  });

  // Generate the portrait. We deliberately skip the dangerous-content
  // classifier here: this is an explicit, user-initiated one-shot — the
  // operator chose the model and the outfit, and the in-chat regen path is
  // where the classifier guards against character-driven generations.
  const provider = createImageProvider(imageProfile.provider);
  const generationResponse = await provider.generateImage(
    {
      prompt,
      model: imageProfile.modelName,
      n: 1,
      size: '1024x1792',
      quality: (imageProfile.parameters as Record<string, unknown>)?.quality as
        | 'standard'
        | 'hd'
        | undefined,
      style: 'natural',
    },
    apiKey.key_value,
  );

  const imageData = generationResponse.images?.[0];
  const rawData = imageData?.data || imageData?.b64Json;
  if (!imageData || !rawData) {
    return serverError('Image provider returned no image data');
  }

  const rawBuffer = Buffer.from(rawData, 'base64');
  const providerMimeType = imageData.mimeType || 'image/png';
  const providerExt = providerMimeType.split('/')[1] || 'png';
  const safeName = character.name.replace(/[^a-zA-Z0-9]/g, '_');
  const providerFilename = `avatar_preview_${safeName}_${Date.now()}.${providerExt}`;

  const converted = await convertToWebP(rawBuffer, providerMimeType, providerFilename);
  const buffer = converted.buffer;
  const mimeType = converted.mimeType;
  const originalFilename = converted.filename;

  const sha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
  const fileId = crypto.randomUUID();

  const category: FileCategory = 'IMAGE';
  const source: FileSource = 'GENERATED';

  try {
    const uploadResult = await fileStorageManager.uploadFile({
      filename: originalFilename,
      content: buffer,
      contentType: mimeType,
      projectId: null,
      folderPath: '/character-avatars/',
    });

    const existingFolder = await repos.folders.findByPath(
      user.id,
      '/character-avatars/',
      null,
    );
    if (!existingFolder) {
      await repos.folders.create({
        userId: user.id,
        path: '/character-avatars/',
        name: 'character-avatars',
        parentFolderId: null,
        projectId: null,
      });
    }

    await repos.files.create(
      {
        userId: user.id,
        sha256,
        originalFilename,
        mimeType,
        size: buffer.length,
        width: 1024,
        height: 1792,
        // Linked to the character so it surfaces in the character's gallery,
        // but NOT to a chat — the caller may have no chat context, and even
        // when they do, this preview is intentionally not bound to it.
        linkedTo: [characterId],
        source,
        category,
        generationPrompt: prompt,
        generationModel: imageProfile.modelName,
        generationRevisedPrompt: imageData.revisedPrompt || null,
        description: `${character.name} — outfit preview`,
        // tags must be UUIDs (tag IDs); the "preview" nature is captured in the
        // description and folder path, not via a string tag.
        tags: [characterId],
        storageKey: uploadResult.storageKey,
        projectId: null,
        folderPath: '/character-avatars/',
      },
      { id: fileId },
    );

    logger.info('[Avatar Preview] Preview saved', {
      context: 'wardrobe.preview-avatar',
      characterId,
      fileId,
    });

    return NextResponse.json({
      fileId,
      url: `/api/v1/files/${fileId}?action=download`,
      mimeType,
      prompt,
    });
  } catch (error) {
    logger.error(
      '[Avatar Preview] Failed to save preview image',
      { characterId },
      error instanceof Error ? error : undefined,
    );
    return serverError('Failed to save avatar preview');
  }
});
