/**
 * Image Generation Tool Execution Handler
 * Handles execution of image generation tool calls from LLMs
 */

import { createHash } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';

import type { FileCategory, FileSource } from '@/lib/schemas/types';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { getImageProviderConstraints } from '@/lib/plugins/provider-registry';
import {
  ImageGenerationToolInput,
  ImageGenerationToolOutput,
  GeneratedImageResult,
  validateImageGenerationInput,
} from '@/lib/tools/image-generation-tool';
import { convertToWebP } from '@/lib/files/webp-conversion';
import { preparePromptExpansion, buildExpansionContext, parsePlaceholders, resolvePlaceholders } from '@/lib/image-gen/prompt-expansion';
import { craftImagePrompt, type ChatMessage } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection, DEFAULT_CHEAP_LLM_CONFIG, type CheapLLMConfig, type CheapLLMSelection } from '@/lib/llm/cheap-llm';
import type { CheapLLMSettings, DangerousContentSettings } from '@/lib/schemas/settings.types';
import type { ChatSettings } from '@/lib/schemas/types';
import {
  resolveCharacterAppearances,
  sanitizeAppearancesIfNeeded,
  type AppearanceResolutionInput,
  type ResolvedCharacterAppearance,
} from '@/lib/image-gen/appearance-resolution';
import { logger } from '@/lib/logger';
import { getInheritedTags } from '@/lib/files/tag-inheritance';
import { getErrorMessage } from '@/lib/errors';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import {
  resolveDangerousContentSettings,
} from '@/lib/services/dangerous-content/resolver.service';
import {
  classifyContent as classifyDangerousContent,
} from '@/lib/services/dangerous-content/gatekeeper.service';
import {
  resolveImageProviderForDangerousContent,
} from '@/lib/services/dangerous-content/provider-routing.service';
import { postLanternImageNotification } from '@/lib/services/lantern-notifications/writer';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';

/**
 * Execution context for image generation tool
 */
export interface ImageToolExecutionContext {
  userId: string;
  profileId: string;
  chatId?: string;
  /** ID of the participant calling the tool (for resolving {{me}}) */
  callingParticipantId?: string;
}

/**
 * Error class for image generation failures
 */
export class ImageGenerationError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

/**
 * Resolve the display name of the character/persona calling a tool, or return
 * "the storyteller" when the user invoked it directly (no participantId).
 */
async function resolveRequesterName(
  chatId: string | undefined,
  callingParticipantId: string | undefined
): Promise<string> {
  if (!chatId || !callingParticipantId) {
    return 'the storyteller';
  }
  try {
    const repos = getRepositories();
    const chat = await repos.chats.findById(chatId);
    if (!chat) return 'the storyteller';
    const participant = chat.participants.find(p => p.id === callingParticipantId);
    if (!participant?.characterId) return 'the storyteller';
    const character = await repos.characters.findById(participant.characterId);
    return character?.name || 'the storyteller';
  } catch {
    return 'the storyteller';
  }
}

/**
 * Save generated image to storage and database
 */
async function saveGeneratedImage(
  imageData: string, // Base64-encoded image data
  mimeType: string,
  userId: string,
  chatId: string | undefined, // Now used to tag the image with the chat
  callingParticipantId: string | undefined,
  metadata: {
    prompt: string;
    revisedPrompt?: string;
    model: string;
    provider: string;
  }
): Promise<GeneratedImageResult> {
  try {
    // Decode base64 to buffer and convert to WebP
    const rawBuffer = Buffer.from(imageData, 'base64');
    const providerExt = mimeType.split('/')[1] || 'png';
    const providerFilename = `generated_${Date.now()}.${providerExt}`;
    const converted = await convertToWebP(rawBuffer, mimeType, providerFilename);
    const buffer = converted.buffer;
    const finalMimeType = converted.mimeType;
    const originalFilename = converted.filename;

    const sha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex');

    // Build linkedTo array
    const linkedTo = chatId ? [chatId] : [];

    const repos = getRepositories();
    const category: FileCategory = 'IMAGE';

    // Generate a new file ID
    const fileId = crypto.randomUUID();

    // Upload to file storage
    const uploadResult = await fileStorageManager.uploadFile({
      filename: originalFilename,
      content: buffer,
      contentType: finalMimeType,
      projectId: null,
      folderPath: '/',
    });
    // Inherit tags from linked entities (e.g., the chat)
    const inheritedTags = await getInheritedTags(linkedTo, userId);

    // Create metadata in repository
    // IMPORTANT: Pass the fileId to ensure metadata matches storage path
    const fileEntry = await repos.files.create({
      userId,
      sha256,
      originalFilename,
      mimeType: finalMimeType,
      size: buffer.length,
      width: null,
      height: null,
      linkedTo,
      source: 'GENERATED' as FileSource,
      category,
      generationPrompt: metadata.prompt,
      generationModel: metadata.model,
      generationRevisedPrompt: metadata.revisedPrompt || null,
      description: null,
      tags: inheritedTags,
      storageKey: uploadResult.storageKey,
    }, { id: fileId });

    // Always use API route for S3-backed files
    const filepath = `/api/v1/files/${fileEntry.id}`;

    if (chatId) {
      const requesterName = await resolveRequesterName(chatId, callingParticipantId);
      await postLanternImageNotification({
        chatId,
        fileId: fileEntry.id,
        kind: { kind: 'character-image', requesterName },
      });
    }

    return {
      id: fileEntry.id,
      url: `/api/v1/images/${fileEntry.id}`,
      filename: fileEntry.originalFilename,
      revisedPrompt: metadata.revisedPrompt,
      filepath,
      mimeType: fileEntry.mimeType,
      size: fileEntry.size,
      width: fileEntry.width ?? undefined,
      height: fileEntry.height ?? undefined,
      sha256: fileEntry.sha256,
    };
  } catch (error) {
    throw new ImageGenerationError(
      'STORAGE_ERROR',
      'Failed to save generated image',
      getErrorMessage(error)
    );
  }
}

/**
 * Merge tool input with profile defaults
 */
function mergeParameters(
  input: ImageGenerationToolInput,
  profileDefaults: Record<string, unknown> = {},
  model?: string // Model should be passed separately from profile
): {
  prompt: string;
  negativePrompt?: string;
  model: string;
  n?: number;
  size?: string;
  aspectRatio?: string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  seed?: number;
  guidanceScale?: number;
  steps?: number;
} {
  return {
    prompt: input.prompt,
    negativePrompt: input.negativePrompt || (profileDefaults.negativePrompt as string | undefined),
    model: model || (profileDefaults.model as string) || 'dall-e-3', // Model from parameter, profile defaults, or default to dall-e-3
    n: input.count ?? (profileDefaults.n as number | undefined) ?? 1,
    size: input.size || (profileDefaults.size as string | undefined),
    aspectRatio: input.aspectRatio || (profileDefaults.aspectRatio as string | undefined),
    quality: input.quality ||
      (profileDefaults.quality as 'standard' | 'hd' | undefined),
    style: input.style ||
      (profileDefaults.style as 'vivid' | 'natural' | undefined),
    seed: profileDefaults.seed as number | undefined,
    guidanceScale: profileDefaults.guidanceScale as number | undefined,
    steps: profileDefaults.steps as number | undefined,
  };
}

/**
 * Validate and load image profile with error handling
 */
async function loadAndValidateProfile(
  profileId: string,
  userId: string
): Promise<{ success: boolean; profile?: any; output?: ImageGenerationToolOutput }> {
  try {
    const repos = getRepositories();
    const imageProfile = await repos.imageProfiles.findById(profileId);

    if (!imageProfile || imageProfile.userId !== userId) {
      return {
        success: false,
        output: {
          success: false,
          error: 'Image profile not found or not authorized',
          message: `Image profile "${profileId}" does not exist or you do not have access to it`,
        },
      };
    }

    // Get the API key if profile has one (verify ownership)
    let apiKey = null;
    if (imageProfile.apiKeyId) {
      apiKey = await repos.connections.findApiKeyByIdAndUserId(imageProfile.apiKeyId, userId);
    }

    if (!apiKey?.key_value) {
      return {
        success: false,
        output: {
          success: false,
          error: 'No API key configured',
          message: `Image profile "${imageProfile.name}" does not have a valid API key configured`,
        },
      };
    }

    return { success: true, profile: { ...imageProfile, apiKey } };
  } catch (error) {
    throw new ImageGenerationError(
      'DATABASE_ERROR',
      'Failed to load image profile',
      getErrorMessage(error)
    );
  }
}

/**
 * Generate images using the provider
 */
async function generateImagesWithProvider(
  toolInput: ImageGenerationToolInput,
  imageProfile: any,
  userId: string,
  chatId?: string,
  callingParticipantId?: string
): Promise<GeneratedImageResult[]> {
  const provider = createImageProvider(imageProfile.provider);

  // Get the API key
  const decryptedKey: string = imageProfile.apiKey.key_value;

  // Merge parameters (profile defaults + user input)
  const mergedParams = mergeParameters(
    toolInput,
    imageProfile.parameters as Record<string, unknown>,
    imageProfile.modelName
  );

  // Generate images
  let generationResponse;
  const genStartTime = Date.now();
  try {
    generationResponse = await provider.generateImage(mergedParams, decryptedKey);

    const genDurationMs = Date.now() - genStartTime;
    const revisedPrompt = generationResponse.images?.[0]?.revisedPrompt || '';

    logLLMCall({
      userId,
      type: 'IMAGE_GENERATION',
      chatId,
      provider: imageProfile.provider,
      modelName: imageProfile.modelName,
      request: {
        messages: [{ role: 'user', content: toolInput.prompt }],
      },
      response: {
        content: revisedPrompt || `Generated ${generationResponse.images?.length ?? 0} image(s)`,
      },
      durationMs: genDurationMs,
    }).catch(err => {
      logger.warn('[Image Generation] Failed to log image generation to LLM Inspector', {
        error: getErrorMessage(err),
      });
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const genDurationMs = Date.now() - genStartTime;

    logLLMCall({
      userId,
      type: 'IMAGE_GENERATION',
      chatId,
      provider: imageProfile.provider,
      modelName: imageProfile.modelName,
      request: {
        messages: [{ role: 'user', content: toolInput.prompt }],
      },
      response: {
        content: '',
        error: errorMessage,
      },
      durationMs: genDurationMs,
    }).catch(() => { /* never block on logging */ });

    logger.error('Image generation failed:', { errorMessage }, error as Error);
    throw new ImageGenerationError(
      'PROVIDER_ERROR',
      `Image generation failed: ${errorMessage}`,
      error
    );
  }

  // Save images and create database records
  try {
    return await Promise.all(
      generationResponse.images.map((img) =>
        saveGeneratedImage(img.data || img.b64Json || '', img.mimeType || 'image/png', userId, chatId, callingParticipantId, {
          prompt: toolInput.prompt,
          revisedPrompt: img.revisedPrompt,
          model: imageProfile.modelName,
          provider: imageProfile.provider,
        })
      )
    );
  } catch (error) {
    logger.error('Failed to save images:', {}, error as Error);
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    throw new ImageGenerationError(
      'STORAGE_ERROR',
      'Failed to save generated images',
      getErrorMessage(error)
    );
  }
}

/**
 * Options for prompt expansion with style trigger phrases
 */
interface PromptExpansionOptions {
  /** Style trigger phrase to incorporate into the prompt */
  styleTriggerPhrase?: string;
  /** Name of the selected style (for context) */
  styleName?: string;
}

/**
 * Expand prompt with character/user character placeholders using cheap LLM
 */
async function expandPromptWithDescriptions(
  originalPrompt: string,
  userId: string,
  provider: string,
  chatId?: string,
  callingParticipantId?: string,
  cheapLLMSettings?: CheapLLMSettings,
  styleOptions?: PromptExpansionOptions,
  isDangerous?: boolean,
  resolvedAppearances?: ResolvedCharacterAppearance[]
): Promise<{ expandedPrompt: string; wasExpanded: boolean }> {
  try {
    // Map ImageProvider string to the enum type
    const imageProvider = provider as 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN';

    // Parse and resolve placeholders
    const rawPlaceholders = parsePlaceholders(originalPrompt);
    if (rawPlaceholders.length === 0) {
      return {
        expandedPrompt: originalPrompt,
        wasExpanded: false,
      };
    }

    const resolvedPlaceholders = await resolvePlaceholders(
      rawPlaceholders,
      userId,
      chatId,
      callingParticipantId
    );

    // Build expansion context, injecting resolved appearances if available
    const expansionContext = buildExpansionContext(
      originalPrompt,
      resolvedPlaceholders,
      imageProvider,
      resolvedAppearances
    );

    // Get cheap LLM selection
    const repos = getRepositories();
    const allProfiles = await repos.connections.findByUserId(userId);

    // Use the uncensored image prompt profile only when the prompt was flagged as dangerous
    let cheapLLMSelection: CheapLLMSelection | null = null;
    if (isDangerous && cheapLLMSettings?.imagePromptProfileId) {
      const imagePromptProfile = allProfiles.find(p => p.id === cheapLLMSettings.imagePromptProfileId);
      if (imagePromptProfile) {
        // Create a direct selection from the uncensored override profile
        const isLocal = imagePromptProfile.provider === 'OLLAMA';
        cheapLLMSelection = {
          provider: imagePromptProfile.provider,
          modelName: imagePromptProfile.modelName,
          connectionProfileId: imagePromptProfile.id,
          baseUrl: isLocal ? (imagePromptProfile.baseUrl || 'http://localhost:11434') : undefined,
          isLocal,
        };
        logger.info('[Image Generation] Using uncensored image prompt profile for dangerous content', {
          context: 'llm-api',
          profileId: imagePromptProfile.id,
          profileName: imagePromptProfile.name,
        });
      } else {
        logger.warn('[Image Generation] Uncensored image prompt profile not found, falling back to global cheap LLM', {
          context: 'llm-api',
          configuredProfileId: cheapLLMSettings.imagePromptProfileId,
        });
      }
    }

    // If no override selection, use the standard cheap LLM logic
    if (!cheapLLMSelection) {
      // Build config from user settings if provided, otherwise use defaults
      const cheapLLMConfig: CheapLLMConfig = cheapLLMSettings ? {
        strategy: cheapLLMSettings.strategy,
        userDefinedProfileId: cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: cheapLLMSettings.fallbackToLocal,
      } : DEFAULT_CHEAP_LLM_CONFIG;

      const defaultProfile = allProfiles.find(p => p.isDefault) || allProfiles[0];

      if (!defaultProfile) {
        // No profiles available, return original prompt
        return {
          expandedPrompt: originalPrompt,
          wasExpanded: false,
        };
      }

      cheapLLMSelection = getCheapLLMProvider(
        defaultProfile,
        cheapLLMConfig,
        allProfiles,
        false // ollamaAvailable - could be detected
      );

    }

    const craftResult = await craftImagePrompt(
      {
        originalPrompt: expansionContext.originalPrompt,
        placeholders: expansionContext.placeholders,
        targetLength: expansionContext.targetLength,
        provider: expansionContext.provider,
        styleTriggerPhrase: styleOptions?.styleTriggerPhrase,
        styleName: styleOptions?.styleName,
      },
      cheapLLMSelection,
      userId,
      chatId
    );

    if (craftResult.success && craftResult.result) {
      return {
        expandedPrompt: craftResult.result,
        wasExpanded: true,
      };
    }

    // If crafting failed, fall back to simple substitution using the longest available description
    let fallbackPrompt = originalPrompt;
    for (const placeholder of expansionContext.placeholders) {
      const description =
        placeholder.tiers.complete ||
        placeholder.tiers.long ||
        placeholder.tiers.medium ||
        placeholder.tiers.short ||
        placeholder.name;

      fallbackPrompt = fallbackPrompt.replace(placeholder.placeholder, description);
    }

    return {
      expandedPrompt: fallbackPrompt,
      wasExpanded: true,
    };
  } catch (error) {
    logger.error('Prompt expansion failed:', {}, error as Error);
    // On error, return original prompt
    return {
      expandedPrompt: originalPrompt,
      wasExpanded: false,
    };
  }
}

/**
 * Validate input and load the image profile and provider
 */
async function validateAndLoadProfile(
  input: unknown,
  context: ImageToolExecutionContext
): Promise<{ toolInput: ImageGenerationToolInput; imageProfile: any } | ImageGenerationToolOutput> {
  // 1. Validate input
  if (!validateImageGenerationInput(input)) {
    return {
      success: false,
      error: 'Invalid input: prompt is required and must be a non-empty string',
      message: 'Image generation tool received invalid parameters',
    };
  }

  const toolInput = input as unknown as ImageGenerationToolInput;

  // 2. Load and validate profile
  const profileResult = await loadAndValidateProfile(context.profileId, context.userId);
  if (!profileResult.success) {
    return profileResult.output as ImageGenerationToolOutput;
  }

  const imageProfile = profileResult.profile;

  // 3. Validate provider
  try {
    createImageProvider(imageProfile.provider);
  } catch (e) {
    return {
      success: false,
      error: 'Unknown provider',
      message: `Image provider "${imageProfile.provider}" is not supported`,
      provider: imageProfile.provider,
      model: imageProfile.modelName,
    };
  }

  return { toolInput, imageProfile };
}

/**
 * Classify content for dangerous material and reroute the image provider if needed
 */
async function classifyAndRouteForDangerousContent(
  toolInput: ImageGenerationToolInput,
  imageProfile: any,
  chatSettings: ChatSettings | undefined,
  dangerSettings: DangerousContentSettings,
  cheapLLMSelection: CheapLLMSelection | null,
  context: ImageToolExecutionContext
): Promise<{
  imagePromptDangerous: boolean;
  effectiveImageProfile: any;
  styleOptions: PromptExpansionOptions | undefined;
}> {
  let imagePromptDangerous = false;
  let effectiveImageProfile = imageProfile;

  // 5. Get style trigger phrase if available
  let styleOptions: PromptExpansionOptions | undefined;
  const constraints = getImageProviderConstraints(imageProfile.provider);

  if (constraints?.styleInfo) {
    // Determine the selected style from tool input or profile defaults
    const selectedStyle =
      toolInput.style ||
      (imageProfile.parameters as Record<string, unknown>)?.style as string | undefined;

    if (selectedStyle && constraints.styleInfo[selectedStyle]) {
      const styleInfo = constraints.styleInfo[selectedStyle];
      if (styleInfo.triggerPhrase) {
        styleOptions = {
          styleTriggerPhrase: styleInfo.triggerPhrase,
          styleName: styleInfo.name,
        };
      }
    }
  }

  // 5b. Classify user's image prompt before expansion (scanImagePrompts)
  if (dangerSettings.mode !== 'OFF' && dangerSettings.scanImagePrompts && cheapLLMSelection) {
    try {
      const promptClassification = await classifyDangerousContent(
        toolInput.prompt,
        cheapLLMSelection,
        context.userId,
        dangerSettings,
        context.chatId
      );

      if (promptClassification.isDangerous) {
        imagePromptDangerous = true;
        logger.info('[Image Generation] User image prompt classified as dangerous', {
          chatId: context.chatId,
          score: promptClassification.score,
          categories: promptClassification.categories.map(c => c.category),
          mode: dangerSettings.mode,
        });

        // If AUTO_ROUTE, reroute the image provider
        if (dangerSettings.mode === 'AUTO_ROUTE') {
          const routeResult = await resolveImageProviderForDangerousContent(
            imageProfile,
            imageProfile.apiKey.key_value,
            dangerSettings,
            context.userId
          );

          if (routeResult.rerouted) {
            effectiveImageProfile = { ...routeResult.imageProfile, apiKey: imageProfile.apiKey };
            // Reload the full profile with API key for the rerouted provider
            const reroutedProfileResult = await loadAndValidateProfile(routeResult.imageProfile.id, context.userId);
            if (reroutedProfileResult.success && reroutedProfileResult.profile) {
              effectiveImageProfile = reroutedProfileResult.profile;
            }
            logger.info('[Image Generation] Rerouted to uncensored image provider', {
              chatId: context.chatId,
              originalProfile: imageProfile.name,
              uncensoredProfile: routeResult.imageProfile.name,
              reason: routeResult.reason,
            });
          } else {
            logger.warn('[Image Generation] No uncensored image provider available, using original', {
              chatId: context.chatId,
              reason: routeResult.reason,
            });
          }
        }
      }
    } catch (error) {
      // Fail safe - never block on classification errors
      logger.error('[Image Generation] Image prompt classification failed, continuing normally', {
        chatId: context.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imagePromptDangerous, effectiveImageProfile, styleOptions };
}

/**
 * Resolve character appearances including wardrobe and sanitization
 */
async function resolveAppearances(
  toolInput: ImageGenerationToolInput,
  chatSettings: ChatSettings | undefined,
  dangerSettings: DangerousContentSettings,
  cheapLLMSelection: CheapLLMSelection | null,
  context: ImageToolExecutionContext
): Promise<{
  recentChatMessages: ChatMessage[];
  isDangerousChat: boolean;
  resolvedAppearances: ResolvedCharacterAppearance[] | undefined;
}> {
  const repos = getRepositories();

  // 5c. Fetch recent chat messages for appearance resolution (if chatId)
  let recentChatMessages: ChatMessage[] = [];
  let isDangerousChat = false;
  if (context.chatId) {
    try {
      const chat = await repos.chats.findById(context.chatId);
      isDangerousChat = chat?.isDangerousChat === true;

      const chatEvents = await repos.chats.getMessages(context.chatId);
      recentChatMessages = chatEvents
        .filter((event: any): event is Extract<typeof event, { type: 'message' }> => event.type === 'message')
        .filter((msg: any) => msg.role === 'USER' || msg.role === 'ASSISTANT')
        .slice(-20)
        .map((msg: any) => ({
          role: msg.role === 'USER' ? 'user' as const : 'assistant' as const,
          content: msg.content,
        }));

    } catch (error) {
      logger.warn('[Image Generation] Failed to fetch chat messages, skipping appearance resolution', {
        chatId: context.chatId,
        errorMessage: getErrorMessage(error),
      });
    }
  }

  // 5d. Resolve character appearances (context-aware)
  let resolvedAppearances: ResolvedCharacterAppearance[] | undefined;
  if (parsePlaceholders(toolInput.prompt).length > 0) {
    try {
      // Build a cheap LLM selection for appearance resolution
      let appearanceLLMSelection = cheapLLMSelection;
      if (!appearanceLLMSelection) {
        const allProfiles = await repos.connections.findByUserId(context.userId);
        const cheapLLMConfig: CheapLLMConfig = chatSettings?.cheapLLMSettings ? {
          strategy: chatSettings.cheapLLMSettings.strategy,
          userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
          defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
          fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
        } : DEFAULT_CHEAP_LLM_CONFIG;

        const defaultProfile = allProfiles.find(p => p.isDefault) || allProfiles[0];
        if (defaultProfile) {
          appearanceLLMSelection = getCheapLLMProvider(
            defaultProfile,
            cheapLLMConfig,
            allProfiles,
            false
          );
        }
      }

      // For dangerous chats, use uncensored provider for appearance resolution
      if (isDangerousChat && appearanceLLMSelection) {
        const profilesForUncensored = await repos.connections.findByUserId(context.userId);
        appearanceLLMSelection = resolveUncensoredCheapLLMSelection(
          appearanceLLMSelection,
          true,
          dangerSettings,
          profilesForUncensored
        );
      }

      if (appearanceLLMSelection) {
        // Resolve placeholders to get character data
        const rawPlaceholders = parsePlaceholders(toolInput.prompt);
        const resolvedPlaceholders = await resolvePlaceholders(
          rawPlaceholders,
          context.userId,
          context.chatId,
          context.callingParticipantId
        );

        // Build appearance inputs from resolved placeholders, enriched with
        // equipped wardrobe items. Equipped slots are arrays-per-slot and may
        // contain composite items; resolveEquippedOutfitForCharacter expands
        // composites and returns per-slot leaf items.
        const repos = getRepositories();
        const appearanceInputs: AppearanceResolutionInput[] = [];
        for (const p of resolvedPlaceholders.filter(p => p.entityId && p.descriptions?.length)) {
          let equippedWardrobeItems: Array<{ slot: string; title: string; description?: string | null }> | undefined;
          if (context.chatId && p.entityId) {
            try {
              const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(context.chatId, p.entityId);
              if (equippedSlots) {
                const resolved = await resolveEquippedOutfitForCharacter(repos, p.entityId, equippedSlots);
                const flat: Array<{ slot: string; title: string; description?: string | null }> = [];
                for (const slot of ['top', 'bottom', 'footwear', 'accessories'] as const) {
                  for (const item of resolved.leafItemsBySlot[slot]) {
                    flat.push({ slot, title: item.title, description: item.description });
                  }
                }
                if (flat.length > 0) {
                  equippedWardrobeItems = flat;
                }
                logger.debug('[Image Generation] Resolved equipped wardrobe for character', {
                  characterId: p.entityId,
                  chatId: context.chatId,
                  itemCount: flat.length,
                });
              }
            } catch (err) {
              logger.warn('[Image Generation] Failed to load equipped wardrobe items for character', {
                characterId: p.entityId,
                chatId: context.chatId,
                error: getErrorMessage(err),
              });
            }
          }
          appearanceInputs.push({
            characterId: p.entityId!,
            characterName: p.name,
            physicalDescriptions: p.descriptions || [],
            equippedWardrobeItems,
          });
        }

        if (appearanceInputs.length > 0) {
          const resolutionResult = await resolveCharacterAppearances(
            appearanceInputs,
            recentChatMessages,
            toolInput.prompt,
            appearanceLLMSelection,
            context.userId,
            context.chatId
          );
          resolvedAppearances = resolutionResult.appearances;

          // Determine if uncensored image provider is available
          const hasUncensoredImageProvider = Boolean(
            dangerSettings.uncensoredImageProfileId
          );

          // Sanitize appearances through the Concierge
          resolvedAppearances = await sanitizeAppearancesIfNeeded(
            resolvedAppearances,
            dangerSettings,
            isDangerousChat,
            hasUncensoredImageProvider,
            appearanceLLMSelection,
            context.userId,
            context.chatId
          );

        }
      }
    } catch (error) {
      // Fail safe — fall back to current behavior
      logger.warn('[Image Generation] Appearance resolution failed, using raw descriptions', {
        chatId: context.chatId,
        errorMessage: getErrorMessage(error),
      });
      resolvedAppearances = undefined;
    }
  }

  return { recentChatMessages, isDangerousChat, resolvedAppearances };
}

/**
 * Expand the prompt with context and classify expanded content for dangerous material
 */
async function expandPromptWithContext(
  toolInput: ImageGenerationToolInput,
  imageProfile: any,
  effectiveImageProfile: any,
  chatSettings: ChatSettings | undefined,
  dangerSettings: DangerousContentSettings,
  cheapLLMSelection: CheapLLMSelection | null,
  imagePromptDangerous: boolean,
  styleOptions: PromptExpansionOptions | undefined,
  resolvedAppearances: ResolvedCharacterAppearance[] | undefined,
  context: ImageToolExecutionContext
): Promise<{
  expandedPrompt: string;
  effectiveImageProfile: any;
}> {
  // 6. Expand prompt with character/user character descriptions if needed
  let expandedPrompt = toolInput.prompt;
  try {
    const expandResult = await expandPromptWithDescriptions(
      toolInput.prompt,
      context.userId,
      effectiveImageProfile.provider,
      context.chatId,
      context.callingParticipantId,
      chatSettings?.cheapLLMSettings,
      styleOptions,
      imagePromptDangerous,
      resolvedAppearances
    );
    expandedPrompt = expandResult.expandedPrompt;
  } catch (error) {
    // If expansion fails, just use the original prompt
    logger.warn('Prompt expansion failed, using original prompt:', { errorMessage: getErrorMessage(error) });
    expandedPrompt = toolInput.prompt;
  }

  // 6b. Classify expanded prompt before image generation (scanImageGeneration)
  if (dangerSettings.mode !== 'OFF' && dangerSettings.scanImageGeneration && cheapLLMSelection && expandedPrompt !== toolInput.prompt) {
    try {
      const expandedClassification = await classifyDangerousContent(
        expandedPrompt,
        cheapLLMSelection,
        context.userId,
        dangerSettings,
        context.chatId
      );

      if (expandedClassification.isDangerous && !imagePromptDangerous) {
        // The expanded prompt is dangerous but original wasn't - still try to reroute
        logger.info('[Image Generation] Expanded prompt classified as dangerous', {
          chatId: context.chatId,
          score: expandedClassification.score,
          categories: expandedClassification.categories.map(c => c.category),
          mode: dangerSettings.mode,
        });

        if (dangerSettings.mode === 'AUTO_ROUTE' && effectiveImageProfile === imageProfile) {
          const routeResult = await resolveImageProviderForDangerousContent(
            imageProfile,
            imageProfile.apiKey.key_value,
            dangerSettings,
            context.userId
          );

          if (routeResult.rerouted) {
            const reroutedProfileResult = await loadAndValidateProfile(routeResult.imageProfile.id, context.userId);
            if (reroutedProfileResult.success && reroutedProfileResult.profile) {
              effectiveImageProfile = reroutedProfileResult.profile;
            }
            logger.info('[Image Generation] Rerouted to uncensored image provider (expanded prompt)', {
              chatId: context.chatId,
              originalProfile: imageProfile.name,
              uncensoredProfile: routeResult.imageProfile.name,
            });
          }
        }
      }
    } catch (error) {
      // Fail safe
      logger.error('[Image Generation] Expanded prompt classification failed, continuing normally', {
        chatId: context.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { expandedPrompt, effectiveImageProfile };
}

/**
 * Load chat settings and build the cheap LLM selection for dangerous content classification
 */
async function loadSettingsAndBuildCheapLLM(
  userId: string,
  chatSettings: ChatSettings | undefined
): Promise<{
  dangerSettings: DangerousContentSettings;
  cheapLLMSelection: CheapLLMSelection | null;
}> {
  // 4b. Resolve dangerous content settings
  const dangerousContentResolved = resolveDangerousContentSettings(chatSettings ?? null);
  const dangerSettings = dangerousContentResolved.settings;

  // 4c. Build cheap LLM selection for dangerous content classification
  let cheapLLMSelection: CheapLLMSelection | null = null;
  if (dangerSettings.mode !== 'OFF' && (dangerSettings.scanImagePrompts || dangerSettings.scanImageGeneration)) {
    try {
      const repos = getRepositories();
      const allProfiles = await repos.connections.findByUserId(userId);
      const cheapLLMConfig: CheapLLMConfig = chatSettings?.cheapLLMSettings ? {
        strategy: chatSettings.cheapLLMSettings.strategy,
        userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
      } : DEFAULT_CHEAP_LLM_CONFIG;

      const defaultProfile = allProfiles.find(p => p.isDefault) || allProfiles[0];
      if (defaultProfile) {
        cheapLLMSelection = getCheapLLMProvider(
          defaultProfile,
          cheapLLMConfig,
          allProfiles,
          false
        );
      }
    } catch (error) {
      logger.warn('[Image Generation] Failed to build cheap LLM selection for danger classification', {
        errorMessage: getErrorMessage(error),
      });
    }
  }

  return { dangerSettings, cheapLLMSelection };
}

/**
 * Execute the image generation tool
 */
export async function executeImageGenerationTool(
  input: unknown,
  context: ImageToolExecutionContext
): Promise<ImageGenerationToolOutput> {
  let imageProfile: any = null;

  try {
    // 1-3. Validate input, load profile, validate provider
    const validationResult = await validateAndLoadProfile(input, context);
    if ('success' in validationResult && !('toolInput' in validationResult)) {
      return validationResult as ImageGenerationToolOutput;
    }
    const { toolInput, imageProfile: loadedProfile } = validationResult as { toolInput: ImageGenerationToolInput; imageProfile: any };
    imageProfile = loadedProfile;

    // 4. Fetch user's chat settings for cheap LLM configuration
    const repos = getRepositories();
    let chatSettings: ChatSettings | undefined;
    try {
      chatSettings = await repos.chatSettings.findByUserId(context.userId) ?? undefined;
    } catch (error) {
      logger.warn('[Image Generation] Failed to load chat settings, using defaults', {
        errorMessage: getErrorMessage(error),
      });
    }

    // 4b-4c. Resolve dangerous content settings and build cheap LLM selection
    const { dangerSettings, cheapLLMSelection } = await loadSettingsAndBuildCheapLLM(
      context.userId,
      chatSettings
    );

    // 5-5b. Classify content, resolve style options, and reroute if needed
    const {
      imagePromptDangerous,
      effectiveImageProfile: profileAfterClassification,
      styleOptions,
    } = await classifyAndRouteForDangerousContent(
      toolInput,
      imageProfile,
      chatSettings,
      dangerSettings,
      cheapLLMSelection,
      context
    );

    // 5c-5d. Resolve character appearances
    const {
      resolvedAppearances,
    } = await resolveAppearances(
      toolInput,
      chatSettings,
      dangerSettings,
      cheapLLMSelection,
      context
    );

    // 6-6b. Expand prompt and classify expanded content
    const {
      expandedPrompt,
      effectiveImageProfile: finalProfile,
    } = await expandPromptWithContext(
      toolInput,
      imageProfile,
      profileAfterClassification,
      chatSettings,
      dangerSettings,
      cheapLLMSelection,
      imagePromptDangerous,
      styleOptions,
      resolvedAppearances,
      context
    );

    // Update the tool input with the expanded prompt
    const finalInput = {
      ...toolInput,
      prompt: expandedPrompt,
    };

    // 7. Generate images (using effective profile which may have been rerouted)
    const savedImages = await generateImagesWithProvider(
      finalInput,
      finalProfile,
      context.userId,
      context.chatId,
      context.callingParticipantId
    );

    // 8. Return success response
    return {
      success: true,
      images: savedImages,
      message: `Successfully generated ${savedImages.length} image(s) using ${finalProfile.modelName}`,
      provider: finalProfile.provider,
      model: finalProfile.modelName,
      expandedPrompt: expandedPrompt,
    };
  } catch (error) {
    logger.error('Image generation tool error:', {}, error as Error);

    // Include provider and model in error response if profile was loaded
    const errorResponse: ImageGenerationToolOutput = {
      success: false,
      error: 'UNKNOWN_ERROR',
      message: `An unexpected error occurred`,
    };

    if (imageProfile) {
      errorResponse.provider = imageProfile.provider;
      errorResponse.model = imageProfile.modelName;
    }

    if (error instanceof ImageGenerationError) {
      errorResponse.error = error.code;
      errorResponse.message = error.message;
      return errorResponse;
    }

    // Unexpected error
    const errorMessage = getErrorMessage(error);
    errorResponse.message = `An unexpected error occurred: ${errorMessage}`;
    return errorResponse;
  }
}

/**
 * Validate that a profile can be used for image generation
 */
export async function validateImageProfile(
  profileId: string,
  userId: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const repos = getRepositories();
    const profile = await repos.imageProfiles.findById(profileId);

    if (!profile || profile.userId !== userId) {
      return {
        valid: false,
        error: 'Profile not found or not authorized',
      };
    }

    // Get the API key if profile has one (verify ownership)
    let apiKey = null;
    if (profile.apiKeyId) {
      apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
    }

    if (!apiKey?.key_value) {
      return {
        valid: false,
        error: 'Profile does not have a valid API key',
      };
    }

    // Verify provider exists
    try {
      createImageProvider(profile.provider);
    } catch {
      return {
        valid: false,
        error: `Provider "${profile.provider}" is not supported`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: getErrorMessage(error, 'Database error'),
    };
  }
}

/**
 * Get default image profile for user
 */
export async function getDefaultImageProfile(userId: string) {
  try {
    const repos = getRepositories();
    const profile = await repos.imageProfiles.findDefault(userId);

    if (!profile) {
      return null;
    }

    // Enrich with API key info (verify ownership)
    let apiKey = null;
    if (profile.apiKeyId) {
      const key = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
      if (key) {
        apiKey = {
          id: key.id,
          provider: key.provider,
          label: key.label,
        };
      }
    }

    return { ...profile, apiKey };
  } catch {
    // Database error - return null for missing profile
    return null;
  }
}
