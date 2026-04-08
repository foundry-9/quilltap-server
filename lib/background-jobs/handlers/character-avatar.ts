/**
 * Character Avatar Generation Handler
 *
 * Generates a portrait avatar for a character based on their equipped wardrobe
 * items and physical descriptions. Triggered when outfits change in a chat
 * with avatar generation enabled.
 *
 * Follows the story-background handler pattern but generates portrait-oriented
 * character avatars instead of landscape backgrounds.
 */

import { createHash } from 'node:crypto';
import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import type { CharacterAvatarGenerationPayload } from '../queue-service';
import type { FileCategory, FileSource } from '@/lib/schemas/types';

/**
 * Handle CHARACTER_AVATAR_GENERATION job.
 *
 * 1. Load character + equipped wardrobe items
 * 2. Build appearance description from physical descriptions + equipped items
 * 3. Generate portrait image
 * 4. Store image and update chat.characterAvatars
 */
export async function handleCharacterAvatarGeneration(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as CharacterAvatarGenerationPayload;
  const repos = getRepositories();

  logger.info('[CharacterAvatar] Starting avatar generation', {
    context: 'background-jobs.character-avatar',
    jobId: job.id,
    chatId: payload.chatId,
    characterId: payload.characterId,
  });

  // 1. Load chat
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    throw new Error(`Chat not found: ${payload.chatId}`);
  }

  // 2. Load character
  const character = await repos.characters.findById(payload.characterId);
  if (!character) {
    throw new Error(`Character not found: ${payload.characterId}`);
  }

  // 3. Get image profile
  const imageProfile = await repos.imageProfiles.findById(payload.imageProfileId);
  if (!imageProfile) {
    throw new Error(`Image profile not found: ${payload.imageProfileId}`);
  }

  if (!imageProfile.apiKeyId) {
    logger.warn('[CharacterAvatar] Image profile has no API key, skipping', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      profileId: imageProfile.id,
    });
    return;
  }

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(imageProfile.apiKeyId, job.userId);
  if (!apiKey?.key_value) {
    logger.warn('[CharacterAvatar] API key not found or invalid, skipping', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    });
    return;
  }

  // 4. Build appearance description from physical descriptions + equipped wardrobe
  const appearanceParts: string[] = [];

  // Physical descriptions
  const physicalDescriptions = character.physicalDescriptions || [];
  if (physicalDescriptions.length > 0) {
    const desc = physicalDescriptions[0]; // Use first/default description
    const descText = desc.mediumPrompt || desc.shortPrompt || desc.longPrompt
      || desc.completePrompt || desc.fullDescription || '';
    if (descText) {
      appearanceParts.push(descText);
    }
  }

  // Equipped wardrobe items
  const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(payload.chatId, payload.characterId);
  if (equippedSlots) {
    const equippedItemIds = Object.values(equippedSlots).filter(Boolean) as string[];
    if (equippedItemIds.length > 0) {
      const items = await repos.wardrobe.findByIds(equippedItemIds);
      const clothingParts: string[] = [];
      for (const [slot, itemId] of Object.entries(equippedSlots)) {
        if (itemId) {
          const item = items.find(i => i.id === itemId);
          if (item) {
            const desc = item.description ? ` - ${item.description}` : '';
            clothingParts.push(`${slot}: ${item.title}${desc}`);
          }
        }
      }
      if (clothingParts.length > 0) {
        appearanceParts.push(`Wearing: ${clothingParts.join(', ')}`);
      }
    }
  }

  if (appearanceParts.length === 0) {
    logger.warn('[CharacterAvatar] No appearance data available, skipping', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      characterId: payload.characterId,
    });
    return;
  }

  // 5. Build portrait prompt — 3/4 shot from thighs up, with scenario context
  const appearanceText = appearanceParts.join('. ');
  const scenarioContext = chat.scenarioText
    ? ` Setting: ${chat.scenarioText.substring(0, 300)}.`
    : '';
  const prompt = `Three-quarter portrait of ${character.name}, from the thighs up. ${appearanceText}.${scenarioContext} Character portrait, detailed, high quality, natural lighting.`;

  logger.debug('[CharacterAvatar] Generated portrait prompt', {
    context: 'background-jobs.character-avatar',
    jobId: job.id,
    promptLength: prompt.length,
    promptPreview: prompt.substring(0, 200),
  });

  // 6. Generate portrait image
  const provider = createImageProvider(imageProfile.provider);
  const decryptedKey = apiKey.key_value;

  let generationResponse;
  try {
    generationResponse = await provider.generateImage({
      prompt,
      model: imageProfile.modelName,
      n: 1,
      size: '1024x1792', // Portrait orientation for 3/4 shot
      quality: (imageProfile.parameters as Record<string, unknown>)?.quality as 'standard' | 'hd' | undefined,
      style: 'natural',
    }, decryptedKey);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[CharacterAvatar] Image generation failed', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      error: errorMessage,
    }, error as Error);
    throw new Error(`Avatar image generation failed: ${errorMessage}`);
  }

  if (!generationResponse.images || generationResponse.images.length === 0) {
    logger.warn('[CharacterAvatar] No images returned from provider', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    });
    return;
  }

  // 7. Save generated image
  const imageData = generationResponse.images[0];
  const rawData = imageData.data || imageData.b64Json;
  if (!rawData) {
    logger.warn('[CharacterAvatar] Generated image has no data', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    });
    return;
  }

  const buffer = Buffer.from(rawData, 'base64');
  const sha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
  const mimeType = imageData.mimeType || 'image/png';
  const ext = mimeType.split('/')[1] || 'png';
  const originalFilename = `avatar_${character.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${ext}`;
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

    // Ensure /character-avatars/ folder record exists
    const existingFolder = await repos.folders.findByPath(job.userId, '/character-avatars/', null);
    if (!existingFolder) {
      await repos.folders.create({
        userId: job.userId,
        path: '/character-avatars/',
        name: 'character-avatars',
        parentFolderId: null,
        projectId: null,
      });
    }

    // Create file metadata record
    await repos.files.create({
      userId: job.userId,
      sha256,
      originalFilename,
      mimeType,
      size: buffer.length,
      width: 1024,
      height: 1792,
      linkedTo: [payload.chatId, payload.characterId],
      source,
      category,
      generationPrompt: prompt,
      generationModel: imageProfile.modelName,
      generationRevisedPrompt: imageData.revisedPrompt || null,
      description: `${character.name} — wardrobe portrait`,
      tags: [payload.characterId],
      storageKey: uploadResult.storageKey,
      projectId: null,
      folderPath: '/character-avatars/',
    }, { id: fileId });

    logger.info('[CharacterAvatar] Avatar image saved', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      fileId,
    });
  } catch (error) {
    logger.error('[CharacterAvatar] Failed to save avatar image', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    }, error as Error);
    throw new Error(`Failed to save avatar image: ${getErrorMessage(error)}`);
  }

  // 8. Update chat.characterAvatars with the new avatar
  const existingAvatars = (chat.characterAvatars && typeof chat.characterAvatars === 'object')
    ? chat.characterAvatars as Record<string, unknown>
    : {};

  const updatedAvatars = {
    ...existingAvatars,
    [payload.characterId]: {
      imageId: fileId,
      generatedAt: new Date().toISOString(),
      afterMessageCount: chat.messageCount ?? 0,
    },
  };

  await repos.chats.update(payload.chatId, {
    characterAvatars: updatedAvatars,
  });

  // 9. Also update character.avatarOverrides for this chat
  const existingOverrides = character.avatarOverrides || [];
  const filteredOverrides = existingOverrides.filter(o => o.chatId !== payload.chatId);
  filteredOverrides.push({ chatId: payload.chatId, imageId: fileId });

  await repos.characters.update(payload.characterId, {
    avatarOverrides: filteredOverrides,
  });

  logger.info('[CharacterAvatar] Avatar generation completed', {
    context: 'background-jobs.character-avatar',
    jobId: job.id,
    chatId: payload.chatId,
    characterId: payload.characterId,
    fileId,
  });
}
