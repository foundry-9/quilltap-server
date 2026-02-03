/**
 * Story Background Generation Job Handler
 *
 * Handles STORY_BACKGROUND_GENERATION background jobs by generating
 * atmospheric landscape images based on chat context and characters.
 */

import { createHash } from 'node:crypto';
import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { decryptApiKey } from '@/lib/encryption';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { craftStoryBackgroundPrompt } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG, type CheapLLMConfig, type CheapLLMSelection } from '@/lib/llm/cheap-llm';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import type { StoryBackgroundGenerationPayload } from '../queue-service';
import type { FileCategory, FileSource } from '@/lib/schemas/types';

/**
 * Handle a story background generation job
 */
export async function handleStoryBackgroundGeneration(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as StoryBackgroundGenerationPayload;
  const repos = getRepositories();

  logger.info('[StoryBackground] Starting background generation', {
    context: 'background-jobs.story-background',
    jobId: job.id,
    chatId: payload.chatId,
    characterCount: payload.characterIds.length,
  });

  // 1. Get the chat
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    throw new Error(`Chat not found: ${payload.chatId}`);
  }

  // 2. Get the image profile
  const imageProfile = await repos.imageProfiles.findById(payload.imageProfileId);
  if (!imageProfile) {
    throw new Error(`Image profile not found: ${payload.imageProfileId}`);
  }

  // 3. Validate profile has an API key
  if (!imageProfile.apiKeyId) {
    logger.warn('[StoryBackground] Image profile has no API key, skipping generation', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      profileId: imageProfile.id,
    });
    return;
  }

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(imageProfile.apiKeyId, job.userId);
  if (!apiKey?.ciphertext) {
    logger.warn('[StoryBackground] API key not found or invalid, skipping generation', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    });
    return;
  }

  // 4. Load character data for descriptions
  const characters = await Promise.all(
    payload.characterIds.map(id => repos.characters.findById(id))
  );
  const validCharacters = characters.filter(c => c !== null);

  logger.debug('[StoryBackground] Loaded characters', {
    context: 'background-jobs.story-background',
    jobId: job.id,
    characterNames: validCharacters.map(c => c!.name),
  });

  // 5. Get user's chat settings for cheap LLM configuration
  const chatSettings = await repos.chatSettings.findByUserId(job.userId);

  // 6. Get cheap LLM selection for prompt crafting
  // Prioritize the Image Prompt Expansion LLM if configured
  const allProfiles = await repos.connections.findByUserId(job.userId);
  const defaultProfile = allProfiles.find(p => p.isDefault) || allProfiles[0];

  if (!defaultProfile) {
    logger.warn('[StoryBackground] No connection profiles available for prompt crafting', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    });
    return;
  }

  let cheapLLMSelection: CheapLLMSelection | null = null;

  // Check if user has a specific image prompt profile override
  if (chatSettings?.cheapLLMSettings?.imagePromptProfileId) {
    const imagePromptProfile = allProfiles.find(p => p.id === chatSettings.cheapLLMSettings!.imagePromptProfileId);
    if (imagePromptProfile) {
      // Create a direct selection from the override profile
      const isLocal = imagePromptProfile.provider === 'OLLAMA';
      cheapLLMSelection = {
        provider: imagePromptProfile.provider,
        modelName: imagePromptProfile.modelName,
        connectionProfileId: imagePromptProfile.id,
        baseUrl: isLocal ? (imagePromptProfile.baseUrl || 'http://localhost:11434') : undefined,
        isLocal,
      };
      logger.debug('[StoryBackground] Using Image Prompt Expansion LLM override', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        provider: imagePromptProfile.provider,
        model: imagePromptProfile.modelName,
      });
    } else {
      logger.warn('[StoryBackground] Image prompt profile not found, falling back to global cheap LLM', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        configuredProfileId: chatSettings.cheapLLMSettings.imagePromptProfileId,
      });
    }
  }

  // If no override selection, use the standard cheap LLM logic
  if (!cheapLLMSelection) {
    const cheapLLMConfig: CheapLLMConfig = chatSettings?.cheapLLMSettings ? {
      strategy: chatSettings.cheapLLMSettings.strategy,
      userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
      defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
      fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
    } : DEFAULT_CHEAP_LLM_CONFIG;

    cheapLLMSelection = getCheapLLMProvider(
      defaultProfile,
      cheapLLMConfig,
      allProfiles,
      false
    );
  }

  // 7. Build character context for prompt crafting
  const characterDescriptions = validCharacters.map(char => {
    const primary = char!.physicalDescriptions?.[0];
    return {
      name: char!.name,
      description: primary?.mediumPrompt || primary?.shortPrompt || char!.name,
    };
  });

  // 8. Craft the background prompt using cheap LLM
  logger.debug('[StoryBackground] Crafting background prompt', {
    context: 'background-jobs.story-background',
    jobId: job.id,
    sceneContext: payload.sceneContext,
  });

  const craftResult = await craftStoryBackgroundPrompt(
    {
      sceneContext: payload.sceneContext || chat.title,
      characters: characterDescriptions,
      provider: imageProfile.provider,
    },
    cheapLLMSelection,
    job.userId
  );

  if (!craftResult.success || !craftResult.result) {
    logger.warn('[StoryBackground] Failed to craft background prompt', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      error: craftResult.error,
    });
    return;
  }

  const finalPrompt = craftResult.result;

  logger.debug('[StoryBackground] Crafted prompt', {
    context: 'background-jobs.story-background',
    jobId: job.id,
    promptLength: finalPrompt.length,
  });

  // 9. Generate the image
  const provider = createImageProvider(imageProfile.provider);

  let decryptedKey: string;
  try {
    decryptedKey = decryptApiKey(
      apiKey.ciphertext,
      apiKey.iv,
      apiKey.authTag,
      job.userId
    );
  } catch (error) {
    logger.error('[StoryBackground] Failed to decrypt API key', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    }, error as Error);
    throw new Error('Failed to decrypt API key');
  }

  let generationResponse;
  try {
    // Request landscape-oriented image for backgrounds
    generationResponse = await provider.generateImage({
      prompt: finalPrompt,
      model: imageProfile.modelName,
      n: 1,
      size: '1792x1024', // Wide landscape for backgrounds (16:9 roughly)
      quality: (imageProfile.parameters as Record<string, unknown>)?.quality as 'standard' | 'hd' | undefined,
      style: 'natural', // Natural style works better for ambient backgrounds
    }, decryptedKey);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[StoryBackground] Image generation failed', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      error: errorMessage,
    }, error as Error);
    throw new Error(`Image generation failed: ${errorMessage}`);
  }

  // 10. Save the generated image
  if (!generationResponse.images || generationResponse.images.length === 0) {
    logger.warn('[StoryBackground] No images returned from provider', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    });
    return;
  }

  const imageData = generationResponse.images[0];
  const buffer = Buffer.from(imageData.data, 'base64');
  const sha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
  const ext = imageData.mimeType.split('/')[1] || 'png';
  const originalFilename = `story_background_${Date.now()}.${ext}`;
  const fileId = crypto.randomUUID();

  // Build linkedTo array with chat and character IDs
  const linkedTo = [payload.chatId, ...payload.characterIds];

  try {
    // Upload to file storage
    const uploadResult = await fileStorageManager.uploadFile({
      userId: job.userId,
      fileId,
      filename: originalFilename,
      content: buffer,
      contentType: imageData.mimeType,
      projectId: payload.projectId ?? null,
      folderPath: '/story-backgrounds/',
    });

    // Create file metadata record
    const category: FileCategory = 'IMAGE';
    const source: FileSource = 'GENERATED';

    await repos.files.create({
      userId: job.userId,
      sha256,
      originalFilename,
      mimeType: imageData.mimeType,
      size: buffer.length,
      width: 1792,
      height: 1024,
      linkedTo,
      source,
      category,
      generationPrompt: finalPrompt,
      generationModel: imageProfile.modelName,
      generationRevisedPrompt: imageData.revisedPrompt || null,
      description: `Story background for: ${payload.sceneContext || chat.title}`,
      tags: [],
      storageKey: uploadResult.storageKey,
      mountPointId: uploadResult.mountPointId,
    }, { id: fileId });

    logger.info('[StoryBackground] Image saved successfully', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      fileId,
    });
  } catch (error) {
    logger.error('[StoryBackground] Failed to save image', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    }, error as Error);
    throw new Error(`Failed to save generated image: ${getErrorMessage(error)}`);
  }

  // 11. Update chat with the new background image ID
  await repos.chats.update(payload.chatId, {
    storyBackgroundImageId: fileId,
    lastBackgroundGeneratedAt: new Date().toISOString(),
  });

  // 12. If chat belongs to a project with 'latest_chat' display mode, update project reference
  if (payload.projectId) {
    const project = await repos.projects.findById(payload.projectId);
    if (project && project.backgroundDisplayMode === 'latest_chat') {
      await repos.projects.update(payload.projectId, {
        storyBackgroundImageId: fileId,
      });

      logger.debug('[StoryBackground] Updated project with latest chat background', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        projectId: payload.projectId,
      });
    }
  }

  logger.info('[StoryBackground] Story background generation completed', {
    context: 'background-jobs.story-background',
    jobId: job.id,
    chatId: payload.chatId,
    fileId,
  });
}
