/**
 * Characters API v1 - Collection Endpoint
 *
 * GET /api/v1/characters - List all characters
 * POST /api/v1/characters - Create a new character
 * POST /api/v1/characters?action=ai-wizard - AI wizard generation
 * POST /api/v1/characters?action=import - Import SillyTavern character
 * POST /api/v1/characters?action=quick-create - Quick create minimal character
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, AuthenticatedContext } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { decryptApiKey } from '@/lib/encryption';
import { createLLMProvider } from '@/lib/llm';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { profileSupportsMimeType } from '@/lib/llm/connection-profile-utils';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { importSTCharacter, parseSTCharacterPNG } from '@/lib/sillytavern/character';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError, notFound, validationError } from '@/lib/api/responses';
import type { ConnectionProfile, FileEntry } from '@/lib/schemas/types';
import type { FileAttachment } from '@/lib/llm/base';

// ============================================================================
// Schemas
// ============================================================================

const createCharacterSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  title: z.string().optional(),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  firstMessage: z.string().optional(),
  exampleDialogues: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  defaultConnectionProfileId: z.string().uuid().optional(),
  npc: z.boolean().optional(),
  systemPrompts: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100),
        content: z.string().min(1),
        isDefault: z.boolean().default(false),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
    )
    .optional(),
  physicalDescriptions: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1),
        shortPrompt: z.string().max(350).nullable().optional(),
        mediumPrompt: z.string().max(500).nullable().optional(),
        longPrompt: z.string().max(750).nullable().optional(),
        completePrompt: z.string().max(1000).nullable().optional(),
        fullDescription: z.string().nullable().optional(),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
    )
    .optional(),
});

const quickCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  defaultConnectionProfileId: z.string().uuid().optional(),
});

const wizardRequestSchema = z.object({
  primaryProfileId: z.string().uuid(),
  visionProfileId: z.string().uuid().optional(),
  sourceType: z.enum(['existing', 'upload', 'gallery', 'skip']),
  imageId: z.string().uuid().optional(),
  characterName: z.string().min(1),
  existingData: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      personality: z.string().optional(),
      scenario: z.string().optional(),
      exampleDialogues: z.string().optional(),
      systemPrompt: z.string().optional(),
    })
    .optional(),
  background: z.string(),
  fieldsToGenerate: z.array(
    z.enum([
      'title',
      'description',
      'personality',
      'scenario',
      'exampleDialogues',
      'systemPrompt',
      'physicalDescription',
    ])
  ),
  characterId: z.string().uuid().optional(),
});

type WizardRequest = z.infer<typeof wizardRequestSchema>;

// ============================================================================
// AI Wizard Helpers
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

function buildContextPrompt(
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

async function generateField(
  provider: ReturnType<typeof createLLMProvider> extends Promise<infer T> ? T : never,
  apiKey: string,
  modelName: string,
  contextPrompt: string,
  fieldPrompt: string,
  maxTokens: number = 500
): Promise<string> {
  const response = await provider.sendMessage(
    {
      model: modelName,
      messages: [
        { role: 'system', content: contextPrompt },
        { role: 'user', content: fieldPrompt },
      ],
      maxTokens,
      temperature: 0.8,
    },
    apiKey
  );

  if (!response?.content) {
    throw new Error('No response from model');
  }

  return response.content.trim();
}

const MAX_VISION_IMAGE_SIZE = 5 * 1024 * 1024;

async function generateImageDescription(
  imageFile: FileEntry,
  visionProfile: ConnectionProfile,
  apiKey: string
): Promise<string> {
  if (!imageFile.storageKey) {
    throw new Error('Image file has no storage key');
  }

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

  const response = await provider.sendMessage(
    {
      model: visionProfile.modelName,
      messages: [
        {
          role: 'user',
          content:
            'Please describe this image in great detail. Focus on the physical appearance of any person or character shown. Include: face shape, eye color/shape, hair color/style/length, skin tone, body type/build, clothing, pose, and any distinctive features. Be thorough and specific.',
          attachments: [attachment],
        },
      ],
      maxTokens: 1000,
      temperature: 0.7,
    },
    apiKey
  );

  if (!response?.content) {
    throw new Error('No response from vision model');
  }

  return response.content.trim();
}

interface GeneratedPhysicalDescription {
  name: string;
  shortPrompt: string;
  mediumPrompt: string;
  longPrompt: string;
  completePrompt: string;
  fullDescription: string;
}

async function generatePhysicalDescriptions(
  provider: ReturnType<typeof createLLMProvider> extends Promise<infer T> ? T : never,
  apiKey: string,
  modelName: string,
  contextPrompt: string
): Promise<GeneratedPhysicalDescription> {
  const results: Partial<GeneratedPhysicalDescription> = {
    name: 'AI Generated',
  };

  for (const [level, prompt] of Object.entries(PHYSICAL_DESCRIPTION_PROMPTS)) {
    const maxTokens = level === 'full' ? 1500 : level === 'complete' ? 400 : 300;
    const content = await generateField(provider, apiKey, modelName, contextPrompt, prompt, maxTokens);

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
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('[Characters v1] GET list', { userId: user.id });

    let characters = await repos.characters.findByUserId(user.id);

    const { searchParams } = new URL(req.url);

    // Filter by NPC status
    const npcFilter = searchParams.get('npc');
    if (npcFilter === 'true') {
      characters = characters.filter((c) => c.npc === true);
    } else if (npcFilter === 'false') {
      characters = characters.filter((c) => !c.npc);
    }

    // Filter by controlledBy
    const controlledByFilter = searchParams.get('controlledBy');
    if (controlledByFilter === 'user') {
      const beforeCount = characters.length;
      characters = characters.filter((c) => c.controlledBy === 'user');
      logger.debug('[Characters v1] Filtered by controlledBy=user', {
        beforeCount,
        afterCount: characters.length,
        userId: user.id,
      });
    } else if (controlledByFilter === 'llm') {
      characters = characters.filter((c) => c.controlledBy === 'llm' || c.controlledBy === undefined);
    }

    // Sort by createdAt descending
    characters.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Enrich characters
    const enrichedCharacters = await Promise.all(
      characters.map(async (character) => {
        let defaultImage = null;
        if (character.defaultImageId) {
          const fileEntry = await repos.files.findById(character.defaultImageId);
          if (fileEntry) {
            defaultImage = {
              id: fileEntry.id,
              filepath: getFilePath(fileEntry),
              url: null,
            };
          }
        }

        let defaultPartnerName: string | null = null;
        if (character.defaultPartnerId) {
          const partner = await repos.characters.findById(character.defaultPartnerId);
          if (partner) {
            defaultPartnerName = partner.name;
          }
        }

        const chats = await repos.chats.findByCharacterId(character.id);

        return {
          id: character.id,
          name: character.name,
          title: character.title,
          description: character.description,
          avatarUrl: character.avatarUrl,
          defaultImageId: character.defaultImageId,
          defaultImage,
          isFavorite: character.isFavorite,
          controlledBy: character.controlledBy ?? 'llm',
          defaultPartnerName,
          npc: character.npc ?? false,
          createdAt: character.createdAt,
          tags: character.tags || [],
          updatedAt: character.updatedAt,
          _count: {
            chats: chats.length,
          },
        };
      })
    );

    return NextResponse.json({
      characters: enrichedCharacters,
      count: enrichedCharacters.length,
    });
  } catch (error) {
    logger.error('[Characters v1] Error listing characters', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch characters');
  }
});

// ============================================================================
// POST Handlers
// ============================================================================

async function handleCreate(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const validatedData = createCharacterSchema.parse(body);

    const character = await repos.characters.create({
      userId: user.id,
      name: validatedData.name,
      title: validatedData.title || null,
      description: validatedData.description || null,
      personality: validatedData.personality || null,
      scenario: validatedData.scenario || null,
      firstMessage: validatedData.firstMessage || null,
      exampleDialogues: validatedData.exampleDialogues || null,
      avatarUrl: validatedData.avatarUrl || null,
      defaultConnectionProfileId: validatedData.defaultConnectionProfileId || null,
      isFavorite: false,
      npc: validatedData.npc ?? false,
      tags: [] as string[],
      personaLinks: [] as { personaId: string; isDefault: boolean }[],
      avatarOverrides: [] as { chatId: string; imageId: string }[],
      defaultImageId: null,
      physicalDescriptions: validatedData.physicalDescriptions || [],
      systemPrompts: validatedData.systemPrompts || [],
    });

    logger.info('[Characters v1] Character created', {
      characterId: character.id,
      name: character.name,
      npc: character.npc,
    });

    return NextResponse.json({ character }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Characters v1] Error creating character', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create character');
  }
}

async function handleQuickCreate(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const validatedData = quickCreateSchema.parse(body);

    logger.info('[Characters v1] Quick creating character', {
      userId: user.id,
      name: validatedData.name,
    });

    const character = await repos.characters.create({
      userId: user.id,
      name: validatedData.name,
      title: null,
      description: 'Character created during chat import',
      personality: null,
      scenario: null,
      firstMessage: null,
      exampleDialogues: null,
      avatarUrl: null,
      defaultConnectionProfileId: validatedData.defaultConnectionProfileId || null,
      isFavorite: false,
      tags: [] as string[],
      personaLinks: [] as { personaId: string; isDefault: boolean }[],
      avatarOverrides: [] as { chatId: string; imageId: string }[],
      defaultImageId: null,
      physicalDescriptions: [],
    });

    logger.info('[Characters v1] Quick create completed', {
      characterId: character.id,
      name: character.name,
    });

    return NextResponse.json({ character }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Characters v1] Error in quick create', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create character');
  }
}

async function handleImport(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const contentType = req.headers.get('content-type');

    let characterData = null;
    let avatarUrl = null;

    if (contentType?.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return badRequest('No file provided');
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      if (file.type === 'image/png' || file.name.endsWith('.png')) {
        characterData = await parseSTCharacterPNG(buffer);

        if (!characterData) {
          return badRequest('Invalid SillyTavern PNG file');
        }

        avatarUrl = null;
      } else if (file.type === 'application/json' || file.name.endsWith('.json')) {
        const jsonText = buffer.toString('utf-8');
        characterData = JSON.parse(jsonText);
      } else {
        return badRequest('Unsupported file type. Please upload PNG or JSON');
      }
    } else if (contentType?.includes('application/json')) {
      const body = await req.json();
      characterData = body.characterData || body;

      if (!characterData) {
        return badRequest('Character data is required');
      }
    } else {
      return badRequest('Unsupported content type');
    }

    const importedData = importSTCharacter(characterData);

    const character = await repos.characters.create({
      userId: user.id,
      ...importedData,
      avatarUrl: avatarUrl,
      isFavorite: false,
      tags: [] as string[],
      personaLinks: [] as { personaId: string; isDefault: boolean }[],
      avatarOverrides: [] as { chatId: string; imageId: string }[],
      defaultImageId: null,
      physicalDescriptions: [],
    });

    const chats = await repos.chats.findByCharacterId(character.id);

    logger.info('[Characters v1] Character imported', {
      characterId: character.id,
      name: character.name,
    });

    return NextResponse.json(
      {
        character: {
          id: character.id,
          name: character.name,
          description: character.description,
          avatarUrl: character.avatarUrl,
          createdAt: character.createdAt,
          updatedAt: character.updatedAt,
          _count: {
            chats: chats.length,
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('[Characters v1] Error importing character', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to import character');
  }
}

async function handleAiWizard(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const request = wizardRequestSchema.parse(body);

    logger.info('[Characters v1] AI Wizard started', {
      userId: user.id,
      characterName: request.characterName,
      fieldsToGenerate: request.fieldsToGenerate,
      sourceType: request.sourceType,
    });

    // Get primary profile
    const primaryProfile = await repos.connections.findById(request.primaryProfileId);
    if (!primaryProfile || primaryProfile.userId !== user.id) {
      return notFound('Primary profile');
    }

    // Get primary profile API key
    let primaryApiKey = '';
    if (primaryProfile.apiKeyId) {
      const apiKey = await repos.connections.findApiKeyByIdAndUserId(primaryProfile.apiKeyId, user.id);
      if (apiKey) {
        primaryApiKey = decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, user.id);
      }
    }

    // Ensure plugin system is initialized
    if (!isPluginSystemInitialized() || !providerRegistry.isInitialized()) {
      const initResult = await initializePlugins();
      if (!initResult.success) {
        return serverError('Plugin system initialization failed');
      }
    }

    // Create primary provider
    const primaryProvider = await createLLMProvider(primaryProfile.provider, primaryProfile.baseUrl || undefined);

    // Handle image description if needed
    let imageDescription: string | undefined;
    if ((request.sourceType === 'upload' || request.sourceType === 'gallery') && request.imageId) {
      const imageFile = await repos.files.findById(request.imageId);
      if (!imageFile || imageFile.userId !== user.id) {
        return notFound('Image');
      }

      let visionProfile = primaryProfile;
      let visionApiKey = primaryApiKey;

      if (!profileSupportsMimeType(primaryProfile, imageFile.mimeType)) {
        if (!request.visionProfileId) {
          return badRequest('Vision profile required for image analysis');
        }

        const secondaryProfile = await repos.connections.findById(request.visionProfileId);
        if (!secondaryProfile || secondaryProfile.userId !== user.id) {
          return notFound('Vision profile');
        }

        if (secondaryProfile.apiKeyId) {
          const apiKey = await repos.connections.findApiKeyByIdAndUserId(secondaryProfile.apiKeyId, user.id);
          if (apiKey) {
            visionApiKey = decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, user.id);
          }
        }

        visionProfile = secondaryProfile;
      }

      try {
        imageDescription = await generateImageDescription(imageFile, visionProfile, visionApiKey);
        logger.debug('[Characters v1] Image description generated', {
          descriptionLength: imageDescription.length,
        });
      } catch (error) {
        logger.error('[Characters v1] Failed to generate image description', {
          error: error instanceof Error ? error.message : String(error),
        });
        return serverError(`Failed to analyze image: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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
            contextPrompt
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
            maxTokens
          );
        }

        logger.debug(`[Characters v1] Generated field: ${field}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Generation failed';
        errors[field] = errorMessage;
        logger.error(`[Characters v1] Failed to generate field: ${field}`, {
          error: errorMessage,
        });
      }
    }

    logger.info('[Characters v1] AI Wizard complete', {
      fieldsGenerated: Object.keys(generated),
      fieldsWithErrors: Object.keys(errors),
    });

    return NextResponse.json({
      success: true,
      generated,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Characters v1] AI Wizard failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return serverError(error instanceof Error ? error.message : 'Generation failed');
  }
}

export const POST = createAuthenticatedHandler(async (req, context) => {
  const action = getActionParam(req);

  switch (action) {
    case 'ai-wizard':
      return handleAiWizard(req, context);
    case 'import':
      return handleImport(req, context);
    case 'quick-create':
      return handleQuickCreate(req, context);
    default:
      return handleCreate(req, context);
  }
});
