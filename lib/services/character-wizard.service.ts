/**
 * Character AI Wizard Service
 *
 * Provides AI-powered character generation capabilities for creating
 * character profiles with LLM assistance.
 */

import { createLLMProvider } from '@/lib/llm';
import { decryptApiKey } from '@/lib/encryption';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { profileSupportsMimeType } from '@/lib/llm/connection-profile-utils';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { logger } from '@/lib/logger';
import type { ConnectionProfile, FileEntry } from '@/lib/schemas/types';
import type { FileAttachment } from '@/lib/llm/base';
import type { RepositoryContainer } from '@/lib/repositories/factory';

// ============================================================================
// Types
// ============================================================================

export interface WizardRequest {
  primaryProfileId: string;
  visionProfileId?: string;
  sourceType: 'existing' | 'upload' | 'gallery' | 'skip';
  imageId?: string;
  characterName: string;
  existingData?: {
    title?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    exampleDialogues?: string;
    systemPrompt?: string;
  };
  background: string;
  fieldsToGenerate: (
    | 'title'
    | 'description'
    | 'personality'
    | 'scenario'
    | 'exampleDialogues'
    | 'systemPrompt'
    | 'physicalDescription'
  )[];
  characterId?: string;
}

export interface GeneratedPhysicalDescription {
  name: string;
  shortPrompt: string;
  mediumPrompt: string;
  longPrompt: string;
  completePrompt: string;
  fullDescription: string;
}

export interface WizardResult {
  success: boolean;
  generated: Record<string, unknown>;
  errors?: Record<string, string>;
}

// ============================================================================
// Prompt Templates
// ============================================================================

const FIELD_PROMPTS: Record<string, string> = {
  title: `Generate a short, evocative title or epithet for this character (2-5 words).
Examples: "The Wandering Scholar", "Knight of the Fallen Star", "Last of the Old Guard"

Respond with ONLY the title, no quotes or explanation.`,

  description: `Write a comprehensive description of this character in 2-3 paragraphs. Include:
- Physical appearance (if visual reference available)
- Background and history
- Current situation/role
- Notable traits or features

Write in third person, present tense. Be vivid and specific.`,

  personality: `Describe this character's personality in 1-2 paragraphs. Include:
- Core personality traits (3-5 dominant traits)
- How they interact with others
- Their emotional tendencies
- Quirks or unique behavioral patterns

Write as instructions for how the character behaves, not as a story.`,

  scenario: `Write a default scenario/setting for interactions with this character in 1-2 paragraphs. Include:
- The typical environment where interactions take place
- The relationship context (stranger, friend, etc.)
- Any ongoing situation or circumstances
- Time period and world details if relevant

Write in present tense, setting the scene for roleplay.`,

  exampleDialogues: `Write 2-3 example dialogue exchanges that demonstrate this character's voice and personality.

Format each exchange as:
{{char}}: [Character's dialogue and actions]
{{user}}: [User's response]
{{char}}: [Character's follow-up]

Show variety in the character's emotional range and speech patterns. Include *actions* and *expressions* in asterisks.`,

  systemPrompt: `Write a system prompt that instructs an AI how to roleplay as this character. Include:
- Core identity and self-perception
- Speech patterns and vocabulary
- Key behaviors and reactions
- Important boundaries or limitations
- Relationship dynamics to maintain

Write as direct instructions to the AI, in second person ("You are...", "You always...").
Keep it under 500 words but comprehensive.`,
};

const PHYSICAL_DESCRIPTION_PROMPTS: Record<string, string> = {
  short: `Create an extremely concise visual description for image generation, maximum 350 characters.
Focus ONLY on: hair, eyes, skin, body type, and one distinctive feature.
Format: [trait], [trait], [trait]...
No sentences, just comma-separated descriptors.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  medium: `Create a concise visual description for image generation, maximum 500 characters.
Include: hair color/style, eye color, skin tone, body type, facial features, one or two clothing/style notes.
Write as a continuous description, no line breaks.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  long: `Create a detailed visual description for image generation, maximum 750 characters.
Include: complete hair description, eye details, skin, facial structure, body type, typical clothing style, posture, any distinctive marks or features.
Write as flowing description suitable for stable diffusion or DALL-E.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  complete: `Create a comprehensive visual description for image generation, maximum 1000 characters.
Include all physical details: hair (color, length, style, texture), eyes (color, shape, expression), face (shape, features, expression), body (type, height, build), skin (tone, texture, any marks), clothing (typical style, colors, accessories), posture and body language.
Optimized for AI image generation.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  full: `Write a complete, detailed physical description of this character in markdown format.
Structure with headers:
## Overview
Brief 1-2 sentence summary

## Face & Head
Hair, eyes, face shape, expressions, any facial features

## Body
Build, height, posture, distinguishing physical traits

## Style & Appearance
Typical clothing, accessories, grooming

## Distinctive Features
Unique marks, mannerisms, or visual traits

Be thorough and specific. This will be used as reference for consistent character portrayal.`,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build the context prompt for field generation
 */
export function buildContextPrompt(
  characterName: string,
  background: string,
  existingData?: WizardRequest['existingData'],
  imageDescription?: string
): string {
  let context = `You are a character creation assistant for a roleplay/chat application. You are helping create a character profile that will be used by an AI to roleplay as this character.

Character Name: ${characterName}
`;

  if (background.trim()) {
    context += `
Background/World Context:
${background}
`;
  }

  if (imageDescription) {
    context += `
Visual Reference (from image analysis):
${imageDescription}
`;
  }

  if (existingData) {
    const existingFields = [];
    if (existingData.title?.trim()) existingFields.push(`Title: ${existingData.title}`);
    if (existingData.description?.trim()) existingFields.push(`Description: ${existingData.description}`);
    if (existingData.personality?.trim()) existingFields.push(`Personality: ${existingData.personality}`);
    if (existingData.scenario?.trim()) existingFields.push(`Scenario: ${existingData.scenario}`);

    if (existingFields.length > 0) {
      context += `
Existing Character Information:
${existingFields.join('\n')}
`;
    }
  }

  return context;
}

type LLMProvider = ReturnType<typeof createLLMProvider> extends Promise<infer T> ? T : never;

/**
 * Generate a single field using the LLM
 */
export async function generateField(
  provider: LLMProvider,
  apiKey: string,
  modelName: string,
  contextPrompt: string,
  fieldPrompt: string,
  maxTokens: number = 500,
  userId?: string,
  characterId?: string,
  profileProvider?: string
): Promise<string> {
  logger.debug('[CharacterWizard] Generating field', {
    modelName,
    maxTokens,
    promptLength: fieldPrompt.length,
  });

  const messages = [
    { role: 'system' as const, content: contextPrompt },
    { role: 'user' as const, content: fieldPrompt },
  ];

  const startTime = Date.now();

  const response = await provider.sendMessage(
    {
      model: modelName,
      messages,
      maxTokens,
      temperature: 0.8,
    },
    apiKey
  );

  const durationMs = Date.now() - startTime;

  if (!response?.content) {
    throw new Error('No response from model');
  }

  // Log the wizard LLM call if userId is available (fire and forget)
  if (userId && profileProvider) {
    logLLMCall({
      userId,
      type: 'CHARACTER_WIZARD',
      characterId: characterId || undefined,
      provider: profileProvider,
      modelName,
      request: {
        messages: [
          { role: 'system', content: contextPrompt },
          { role: 'user', content: fieldPrompt },
        ],
        temperature: 0.8,
        maxTokens,
      },
      response: {
        content: response.content,
        error: undefined,
      },
      usage: response.usage,
      durationMs,
    }).catch(err => {
      logger.warn('Failed to log character wizard LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return response.content.trim();
}

const MAX_VISION_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * Generate a description of an image using a vision-capable model
 */
export async function generateImageDescription(
  imageFile: FileEntry,
  visionProfile: ConnectionProfile,
  apiKey: string,
  userId?: string,
  characterId?: string
): Promise<string> {
  if (!imageFile.storageKey) {
    throw new Error('Image file has no storage key');
  }

  logger.debug('[CharacterWizard] Generating image description', {
    imageId: imageFile.id,
    provider: visionProfile.provider,
    model: visionProfile.modelName,
  });

  const imageBuffer = await fileStorageManager.downloadFile(imageFile);

  if (imageBuffer.length > MAX_VISION_IMAGE_SIZE) {
    const sizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Image is too large (${sizeMB}MB). Vision models have a 5MB limit. ` +
        `Please use a smaller image or resize it before uploading.`
    );
  }

  const base64Data = imageBuffer.toString('base64');

  const attachment: FileAttachment = {
    id: imageFile.id,
    filepath: imageFile.storageKey,
    filename: imageFile.originalFilename,
    mimeType: imageFile.mimeType,
    size: imageBuffer.length,
    data: base64Data,
  };

  const provider = await createLLMProvider(visionProfile.provider, visionProfile.baseUrl || undefined);

  const messages = [
    {
      role: 'user' as const,
      content:
        'Please describe this image in great detail. Focus on the physical appearance of any person or character shown. Include: face shape, eye color/shape, hair color/style/length, skin tone, body type/build, clothing, pose, and any distinctive features. Be thorough and specific.',
      attachments: [attachment],
    },
  ];

  const startTime = Date.now();

  const response = await provider.sendMessage(
    {
      model: visionProfile.modelName,
      messages,
      maxTokens: 1000,
      temperature: 0.7,
    },
    apiKey
  );

  const durationMs = Date.now() - startTime;

  if (!response?.content) {
    throw new Error('No response from vision model');
  }

  logger.debug('[CharacterWizard] Image description generated', {
    descriptionLength: response.content.length,
  });

  // Log the vision LLM call if userId is available (fire and forget)
  if (userId) {
    logLLMCall({
      userId,
      type: 'CHARACTER_WIZARD',
      characterId: characterId || undefined,
      provider: visionProfile.provider,
      modelName: visionProfile.modelName,
      request: {
        messages: [
          {
            role: 'user',
            content:
              'Please describe this image in great detail. Focus on the physical appearance of any person or character shown. Include: face shape, eye color/shape, hair color/style/length, skin tone, body type/build, clothing, pose, and any distinctive features. Be thorough and specific.',
            attachments: [{ id: attachment.id }],
          },
        ],
        temperature: 0.7,
        maxTokens: 1000,
      },
      response: {
        content: response.content,
        error: undefined,
      },
      usage: response.usage,
      durationMs,
    }).catch(err => {
      logger.warn('Failed to log character wizard image description LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return response.content.trim();
}

/**
 * Generate all physical description variants
 */
export async function generatePhysicalDescriptions(
  provider: LLMProvider,
  apiKey: string,
  modelName: string,
  contextPrompt: string,
  userId?: string,
  characterId?: string,
  profileProvider?: string
): Promise<GeneratedPhysicalDescription> {
  logger.debug('[CharacterWizard] Generating physical descriptions', { modelName });

  const results: Partial<GeneratedPhysicalDescription> = {
    name: 'AI Generated',
  };

  for (const [level, prompt] of Object.entries(PHYSICAL_DESCRIPTION_PROMPTS)) {
    const maxTokens = level === 'full' ? 1500 : level === 'complete' ? 400 : 300;
    const content = await generateField(
      provider,
      apiKey,
      modelName,
      contextPrompt,
      prompt,
      maxTokens,
      userId,
      characterId,
      profileProvider
    );

    switch (level) {
      case 'short':
        results.shortPrompt = content.substring(0, 350);
        break;
      case 'medium':
        results.mediumPrompt = content.substring(0, 500);
        break;
      case 'long':
        results.longPrompt = content.substring(0, 750);
        break;
      case 'complete':
        results.completePrompt = content.substring(0, 1000);
        break;
      case 'full':
        results.fullDescription = content;
        break;
    }
  }

  return results as GeneratedPhysicalDescription;
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Run the AI character wizard
 */
export async function runCharacterWizard(
  request: WizardRequest,
  userId: string,
  repos: RepositoryContainer
): Promise<WizardResult> {
  logger.info('[CharacterWizard] Starting', {
    userId,
    characterName: request.characterName,
    fieldsToGenerate: request.fieldsToGenerate,
    sourceType: request.sourceType,
  });

  // Get primary profile
  const primaryProfile = await repos.connections.findById(request.primaryProfileId);
  if (!primaryProfile || primaryProfile.userId !== userId) {
    throw new Error('Primary profile not found');
  }

  // Get primary profile API key
  let primaryApiKey = '';
  if (primaryProfile.apiKeyId) {
    const apiKey = await repos.connections.findApiKeyByIdAndUserId(primaryProfile.apiKeyId, userId);
    if (apiKey) {
      primaryApiKey = decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, userId);
    }
  }

  // Ensure plugin system is initialized
  if (!isPluginSystemInitialized() || !providerRegistry.isInitialized()) {
    const initResult = await initializePlugins();
    if (!initResult.success) {
      throw new Error('Plugin system initialization failed');
    }
  }

  // Create primary provider
  const primaryProvider = await createLLMProvider(primaryProfile.provider, primaryProfile.baseUrl || undefined);

  // Handle image description if needed
  let imageDescription: string | undefined;
  if ((request.sourceType === 'upload' || request.sourceType === 'gallery') && request.imageId) {
    const imageFile = await repos.files.findById(request.imageId);
    if (!imageFile || imageFile.userId !== userId) {
      throw new Error('Image not found');
    }

    let visionProfile = primaryProfile;
    let visionApiKey = primaryApiKey;

    if (!profileSupportsMimeType(primaryProfile, imageFile.mimeType)) {
      if (!request.visionProfileId) {
        throw new Error('Vision profile required for image analysis');
      }

      const secondaryProfile = await repos.connections.findById(request.visionProfileId);
      if (!secondaryProfile || secondaryProfile.userId !== userId) {
        throw new Error('Vision profile not found');
      }

      if (secondaryProfile.apiKeyId) {
        const apiKey = await repos.connections.findApiKeyByIdAndUserId(secondaryProfile.apiKeyId, userId);
        if (apiKey) {
          visionApiKey = decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, userId);
        }
      }

      visionProfile = secondaryProfile;
    }

    imageDescription = await generateImageDescription(
      imageFile,
      visionProfile,
      visionApiKey,
      userId,
      request.characterId
    );
  }

  // Build context prompt
  const contextPrompt = buildContextPrompt(
    request.characterName,
    request.background,
    request.existingData,
    imageDescription
  );

  // Generate requested fields
  const generated: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const field of request.fieldsToGenerate) {
    try {
      if (field === 'physicalDescription') {
        generated.physicalDescription = await generatePhysicalDescriptions(
          primaryProvider,
          primaryApiKey,
          primaryProfile.modelName,
          contextPrompt,
          userId,
          request.characterId,
          primaryProfile.provider
        );
      } else {
        const fieldPrompt = FIELD_PROMPTS[field];
        const maxTokens = field === 'exampleDialogues' || field === 'systemPrompt' ? 1000 : 500;
        generated[field] = await generateField(
          primaryProvider,
          primaryApiKey,
          primaryProfile.modelName,
          contextPrompt,
          fieldPrompt,
          maxTokens,
          userId,
          request.characterId,
          primaryProfile.provider
        );
      }

      logger.debug(`[CharacterWizard] Generated field: ${field}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Generation failed';
      errors[field] = errorMessage;
      logger.error(`[CharacterWizard] Failed to generate field: ${field}`, {
        error: errorMessage,
      });
    }
  }

  logger.info('[CharacterWizard] Complete', {
    fieldsGenerated: Object.keys(generated),
    fieldsWithErrors: Object.keys(errors),
  });

  return {
    success: true,
    generated,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}
