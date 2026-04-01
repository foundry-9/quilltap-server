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
import { createAuthenticatedHandler, AuthenticatedContext, enrichWithDefaultImage } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { importSTCharacter, parseSTCharacterPNG } from '@/lib/sillytavern/character';
import { runCharacterWizard, runCharacterWizardStreaming, type WizardRequest, type WizardProgressEvent } from '@/lib/services/character-wizard.service';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError, notFound, validationError } from '@/lib/api/responses';

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
  avatarUrl: z.url().optional().or(z.literal('')),
  defaultConnectionProfileId: z.uuid().optional(),
  controlledBy: z.enum(['llm', 'user']).optional(),
  npc: z.boolean().optional(),
  systemPrompts: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(100),
        content: z.string().min(1),
        isDefault: z.boolean().prefault(false),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
    )
    .optional(),
  physicalDescriptions: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().min(1),
        usageContext: z.string().max(200).nullable().optional(),
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
  clothingRecords: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().min(1),
        usageContext: z.string().max(200).nullable().optional(),
        description: z.string().nullable().optional(),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
    )
    .optional(),
});

const quickCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  defaultConnectionProfileId: z.uuid().optional(),
});

const wizardRequestSchema = z.object({
  primaryProfileId: z.uuid(),
  visionProfileId: z.uuid().optional(),
  sourceType: z.enum(['existing', 'upload', 'gallery', 'document', 'skip']),
  imageId: z.uuid().optional(),
  documentId: z.uuid().optional(),
  characterName: z.string(),
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
      'name',
      'title',
      'description',
      'personality',
      'scenario',
      'exampleDialogues',
      'systemPrompt',
      'physicalDescription',
    ])
  ),
  characterId: z.uuid().optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {

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
      characters = characters.filter((c) => c.controlledBy === 'user');} else if (controlledByFilter === 'llm') {
      characters = characters.filter((c) => c.controlledBy === 'llm' || c.controlledBy === undefined);
    }

    // Sort by createdAt descending
    characters.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Enrich characters
    const enrichedCharacters = await Promise.all(
      characters.map(async (character) => {
        const defaultImage = await enrichWithDefaultImage(character.defaultImageId, repos);

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
      controlledBy: validatedData.controlledBy || 'llm',
      isFavorite: false,
      npc: validatedData.npc ?? false,
      tags: [] as string[],
      personaLinks: [] as { personaId: string; isDefault: boolean }[],
      avatarOverrides: [] as { chatId: string; imageId: string }[],
      defaultImageId: null,
      physicalDescriptions: validatedData.physicalDescriptions || [],
      clothingRecords: validatedData.clothingRecords || [],
      systemPrompts: validatedData.systemPrompts || [],
    });

    logger.info('[Characters v1] Character created', {
      characterId: character.id,
      name: character.name,
      controlledBy: character.controlledBy || 'llm',
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
      clothingRecords: [],
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
      clothingRecords: [],
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
    const request = wizardRequestSchema.parse(body) as WizardRequest;

    logger.info('[Characters v1] AI Wizard starting', {
      userId: user.id,
      characterName: request.characterName,
      fieldsToGenerate: request.fieldsToGenerate,
      sourceType: request.sourceType,
    });

    const result = await runCharacterWizard(request, user.id, repos);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    const errorMessage = error instanceof Error ? error.message : 'Generation failed';

    // Handle specific error types with appropriate responses
    if (errorMessage.includes('not found')) {
      return notFound(errorMessage.replace(' not found', ''));
    }
    if (errorMessage.includes('required')) {
      return badRequest(errorMessage);
    }

    logger.error('[Characters v1] AI Wizard failed', { error: errorMessage });
    return serverError(errorMessage);
  }
}

async function handleAiWizardStream(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const request = wizardRequestSchema.parse(body) as WizardRequest;

    logger.info('[Characters v1] AI Wizard starting (streaming)', {
      userId: user.id,
      characterName: request.characterName,
      fieldsToGenerate: request.fieldsToGenerate,
      sourceType: request.sourceType,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (event: WizardProgressEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Stream may be closed
          }
        };

        await runCharacterWizardStreaming(request, user.id, repos, enqueue);

        try {
          controller.close();
        } catch {
          // Stream may already be closed
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    const errorMessage = error instanceof Error ? error.message : 'Generation failed';
    logger.error('[Characters v1] AI Wizard stream failed', { error: errorMessage });
    return serverError(errorMessage);
  }
}

export const POST = createAuthenticatedHandler(async (req, context) => {
  const action = getActionParam(req);

  switch (action) {
    case 'ai-wizard':
      return handleAiWizard(req, context);
    case 'ai-wizard-stream':
      return handleAiWizardStream(req, context);
    case 'import':
      return handleImport(req, context);
    case 'quick-create':
      return handleQuickCreate(req, context);
    default:
      return handleCreate(req, context);
  }
});
