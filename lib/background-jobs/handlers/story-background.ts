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
import { craftStoryBackgroundPrompt, deriveSceneContext, extractVisibleConversation, type ChatMessage } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG, type CheapLLMConfig, type CheapLLMSelection } from '@/lib/llm/cheap-llm';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import type { StoryBackgroundGenerationPayload } from '../queue-service';
import type { FileCategory, FileSource } from '@/lib/schemas/types';
import {
  resolveCharacterAppearances,
  sanitizeAppearancesIfNeeded,
  type AppearanceResolutionInput,
  type AppearanceResolutionResult,
} from '@/lib/image-gen/appearance-resolution';
import {
  resolveDangerousContentSettings,
} from '@/lib/services/dangerous-content/resolver.service';

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

  // Use the standard cheap LLM for the initial attempt at story backgrounds
  // (imagePromptProfileId is used as a retry fallback if the safe provider returns empty)
  let cheapLLMSelection: CheapLLMSelection | null = null;
  {
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

  // 7. Fetch recent messages (needed for both scene context and appearance resolution)
  const chatEvents = await repos.chats.getMessages(payload.chatId);
  const recentMessages: ChatMessage[] = extractVisibleConversation(chatEvents).slice(-20);


  // 7b. Resolve Dangermouse settings
  const dangerousContentResolved = resolveDangerousContentSettings(chatSettings ?? null);
  const dangerSettings = dangerousContentResolved.settings;
  const isDangerousChat = chat.isDangerousChat === true;
  const hasUncensoredImageProvider = Boolean(dangerSettings.uncensoredImageProfileId);

  // 8. Derive scene context AND resolve character appearances in parallel
  let sceneContext = payload.sceneContext || chat.title;

  // Build appearance inputs from loaded characters
  const appearanceInputs: AppearanceResolutionInput[] = validCharacters.map(char => ({
    characterId: char!.id,
    characterName: char!.name,
    physicalDescriptions: char!.physicalDescriptions || [],
    clothingRecords: char!.clothingRecords || [],
  }));

  // Scene context prompt for appearance resolution
  const scenePromptForAppearance = payload.sceneContext || chat.title;

  // Build uncensored LLM selection once (used for appearance resolution and prompt crafting)
  let uncensoredLLMSelection: CheapLLMSelection | null = null;
  const uncensoredProfileId = chatSettings?.cheapLLMSettings?.imagePromptProfileId;
  if (uncensoredProfileId) {
    const uncensoredProfile = allProfiles.find(p => p.id === uncensoredProfileId);
    if (uncensoredProfile) {
      const isLocal = uncensoredProfile.provider === 'OLLAMA';
      uncensoredLLMSelection = {
        provider: uncensoredProfile.provider,
        modelName: uncensoredProfile.modelName,
        connectionProfileId: uncensoredProfile.id,
        baseUrl: isLocal ? (uncensoredProfile.baseUrl || 'http://localhost:11434') : undefined,
        isLocal,
      };
    }
  }

  // For appearance resolution: if the chat is already marked dangerous and we have an
  // uncensored provider, skip the safe provider entirely (it'll likely refuse anyway)
  const appearanceLLMSelection = (isDangerousChat && uncensoredLLMSelection)
    ? uncensoredLLMSelection
    : cheapLLMSelection;

  if (isDangerousChat && uncensoredLLMSelection) {
  }

  // Run scene context derivation and appearance resolution in parallel
  const [sceneResult, appearanceResolutionResult] = await Promise.all([
    // Scene context derivation
    recentMessages.length > 0
      ? deriveSceneContext(
          {
            chatTitle: chat.title,
            contextSummary: chat.contextSummary,
            recentMessages,
            characterNames: validCharacters.map(c => c!.name),
          },
          cheapLLMSelection,
          job.userId
        )
      : Promise.resolve(null),
    // Appearance resolution
    appearanceInputs.length > 0
      ? resolveCharacterAppearances(
          appearanceInputs,
          recentMessages,
          scenePromptForAppearance,
          appearanceLLMSelection,
          job.userId,
          payload.chatId
        ).catch(error => {
          logger.warn('[StoryBackground] Appearance resolution failed, using defaults', {
            context: 'background-jobs.story-background',
            jobId: job.id,
            error: getErrorMessage(error),
          });
          return null;
        })
      : Promise.resolve(null),
  ]);

  // Process scene context result
  if (sceneResult?.success && sceneResult.result) {
    sceneContext = sceneResult.result;
  } else if (recentMessages.length > 0) {
    logger.warn('[StoryBackground] Failed to derive scene context, using fallback', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      error: sceneResult?.error,
      fallback: sceneContext,
    });
  }

  // Process appearance resolution result
  // If the safe LLM failed/refused (likely content refusal) and we haven't already
  // used the uncensored provider, retry with it
  let appearanceResult = appearanceResolutionResult;

  if (appearanceResult && !appearanceResult.llmResolved
      && appearanceInputs.length > 0
      && appearanceLLMSelection === cheapLLMSelection  // Only retry if we used the safe provider
      && uncensoredLLMSelection) {
    logger.info('[StoryBackground] Appearance resolution fell back to defaults (likely content refusal), retrying with uncensored profile', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    });

    try {
      const retryResult = await resolveCharacterAppearances(
        appearanceInputs,
        recentMessages,
        scenePromptForAppearance,
        uncensoredLLMSelection,
        job.userId,
        payload.chatId
      );

      if (retryResult.llmResolved) {
        appearanceResult = retryResult;
        logger.info('[StoryBackground] Appearance resolution retry with uncensored profile succeeded', {
          context: 'background-jobs.story-background',
          jobId: job.id,
        });
      } else {
        logger.warn('[StoryBackground] Appearance resolution retry also fell back to defaults', {
          context: 'background-jobs.story-background',
          jobId: job.id,
        });
      }
    } catch (error) {
      logger.warn('[StoryBackground] Appearance resolution retry with uncensored profile failed', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        error: getErrorMessage(error),
      });
    }
  } else if (appearanceResult && !appearanceResult.llmResolved && !uncensoredLLMSelection) {
  }

  // Extract appearances and apply Dangermouse sanitization
  let resolvedAppearances = appearanceResult?.appearances ?? null;
  if (resolvedAppearances && resolvedAppearances.length > 0) {
    try {
      resolvedAppearances = await sanitizeAppearancesIfNeeded(
        resolvedAppearances,
        dangerSettings,
        isDangerousChat,
        hasUncensoredImageProvider,
        cheapLLMSelection,
        job.userId,
        payload.chatId
      );
    } catch (error) {
      logger.warn('[StoryBackground] Appearance sanitization failed, using unsanitized', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        error: getErrorMessage(error),
      });
    }
  }

  // Build character descriptions from resolved appearances (or fall back to simple logic)
  const characterDescriptions = validCharacters.map(char => {
    const resolved = resolvedAppearances?.find(a => a.characterId === char!.id);

    if (resolved) {
      const descParts = [resolved.physicalDescription];
      if (resolved.clothingDescription) {
        descParts.push(`Wearing: ${resolved.clothingDescription}`);
      }
      return {
        name: char!.name,
        description: descParts.join('. '),
      };
    }

    // Fallback: simple first-description logic
    const primary = char!.physicalDescriptions?.[0];
    const primaryOutfit = char!.clothingRecords?.[0];
    const descParts = [primary?.mediumPrompt || primary?.shortPrompt || char!.name];
    if (primaryOutfit?.description) {
      descParts.push(`Wearing: ${primaryOutfit.description}`);
    }
    return {
      name: char!.name,
      description: descParts.join('. '),
    };
  });


  // 9. Craft the background prompt using cheap LLM

  const craftResult = await craftStoryBackgroundPrompt(
    {
      sceneContext,
      characters: characterDescriptions,
      provider: imageProfile.provider,
    },
    cheapLLMSelection,
    job.userId
  );

  let finalPrompt: string | undefined = craftResult.result;

  if (!craftResult.success) {
    // Actual error from the cheap LLM
    logger.warn('[StoryBackground] Failed to craft background prompt', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      error: craftResult.error,
    });
    return;
  }

  if (!finalPrompt) {
    // Success but empty result — treat as a silent content refusal
    logger.warn('[StoryBackground] Empty response from safe provider, treating as content refusal', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      sceneContext,
    });

    if (uncensoredLLMSelection) {
      logger.info('[StoryBackground] Retrying prompt crafting with uncensored profile', {
        context: 'background-jobs.story-background',
        jobId: job.id,
      });

      const retryResult = await craftStoryBackgroundPrompt(
        {
          sceneContext,
          characters: characterDescriptions,
          provider: imageProfile.provider,
        },
        uncensoredLLMSelection,
        job.userId
      );

      if (retryResult.success && retryResult.result) {
        finalPrompt = retryResult.result;
        logger.info('[StoryBackground] Retry with uncensored profile succeeded', {
          context: 'background-jobs.story-background',
          jobId: job.id,
          promptLength: finalPrompt.length,
        });
      } else {
        logger.warn('[StoryBackground] Retry with uncensored profile also failed', {
          context: 'background-jobs.story-background',
          jobId: job.id,
          error: retryResult.error,
        });
        return;
      }
    } else {
      logger.warn('[StoryBackground] No uncensored image prompt profile configured, cannot retry', {
        context: 'background-jobs.story-background',
        jobId: job.id,
      });
      return;
    }
  }


  // 10. Generate the image
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

  // 11. Save the generated image
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

    // Ensure /story-backgrounds/ folder record exists in database
    const folderProjectId = payload.projectId ?? null;
    const existingFolder = await repos.folders.findByPath(
      job.userId,
      '/story-backgrounds/',
      folderProjectId
    );
    if (!existingFolder) {
      await repos.folders.create({
        userId: job.userId,
        path: '/story-backgrounds/',
        name: 'story-backgrounds',
        parentFolderId: null,
        projectId: folderProjectId,
      });

    }

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
      projectId: folderProjectId,
      folderPath: '/story-backgrounds/',
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

  // 12. Update chat with the new background image ID
  await repos.chats.update(payload.chatId, {
    storyBackgroundImageId: fileId,
    lastBackgroundGeneratedAt: new Date().toISOString(),
  });

  // 13. If chat belongs to a project with 'latest_chat' display mode, update project reference
  if (payload.projectId) {
    const project = await repos.projects.findById(payload.projectId);
    if (project && project.backgroundDisplayMode === 'latest_chat') {
      await repos.projects.update(payload.projectId, {
        storyBackgroundImageId: fileId,
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
