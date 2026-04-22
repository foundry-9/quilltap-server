/**
 * Characters API v1 - Individual Character Endpoint
 *
 * GET /api/v1/characters/[id] - Get a specific character
 * PUT /api/v1/characters/[id] - Update a character
 * DELETE /api/v1/characters/[id] - Delete a character (supports cascade)
 *
 * GET Actions:
 * - export - Export character
 * - chats - List recent chats with this character
 * - cascade-preview - Get cascade delete preview
 * - default-partner - Get default partner
 * - get-tags - Get character tags
 *
 * POST Actions:
 * - favorite - Toggle favorite
 * - avatar - Set avatar
 * - add-tag - Add tag
 * - remove-tag - Remove tag
 * - toggle-controlled-by - Toggle user/LLM control
 * - set-default-partner - Set default partner
 * - generate-external-prompt - Generate standalone system prompt for external tools
 * - refresh-archive - Re-render and re-embed all conversations for this character
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedParamsHandler, checkOwnership, enrichWithDefaultImage, getFilePath } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { executeCascadeDelete, getCascadeDeletePreview } from '@/lib/cascade-delete';
import { exportSTCharacter, createSTCharacterPNG } from '@/lib/sillytavern/character';
import { readImageBuffer } from '@/lib/images-v2';
import { z } from 'zod';
import { PronounsSchema } from '@/lib/schemas/character.types';
import { TimestampConfigSchema } from '@/lib/schemas/settings.types';
import type { Character } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { notFound, forbidden, badRequest, serverError } from '@/lib/api/responses';
import { runCharacterOptimizer } from '@/lib/services/character-optimizer.service';
import type { OptimizerProgressEvent } from '@/lib/services/character-optimizer.service';
import { generateExternalPrompt } from '@/lib/services/external-prompt-generator.service';
import { enqueueConversationRender } from '@/lib/background-jobs/queue-service';
import {
  readCharacterVaultProperties,
  readCharacterVaultDescription,
  readCharacterVaultPersonality,
  readCharacterVaultExampleDialogues,
  readCharacterVaultPhysicalDescription,
  readCharacterVaultPhysicalPrompts,
  readCharacterVaultSystemPrompts,
  readCharacterVaultScenarios,
  readCharacterVaultWardrobe,
} from '@/lib/database/repositories/character-properties-overlay';

// ============================================================================
// Schemas
// ============================================================================

const updateCharacterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenarios: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        content: z.string().min(1),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
      })
    )
    .optional(),
  firstMessage: z.string().optional(),
  exampleDialogues: z.string().optional(),
  avatarUrl: z.url()
    .optional()
    .or(z.literal('')),
  defaultConnectionProfileId: z.uuid()
    .optional()
    .or(
      z.literal('').transform(() => undefined)
    ),
  defaultImageProfileId: z.uuid()
    .optional()
    .or(
      z.literal('').transform(() => undefined)
    )
    .nullable(),
  aliases: z.array(z.string()).optional(),
  pronouns: PronounsSchema.nullable().optional(),
  controlledBy: z.enum(['llm', 'user']).optional(),
  npc: z.boolean().optional(),
  defaultAgentModeEnabled: z.boolean().nullable().optional(),
  defaultHelpToolsEnabled: z.boolean().nullable().optional(),
  defaultTimestampConfig: TimestampConfigSchema.nullable().optional(),
  defaultScenarioId: z.uuid().nullable().optional(),
  defaultSystemPromptId: z.uuid().nullable().optional(),
  characterDocumentMountPointId: z.uuid()
    .optional()
    .or(z.literal('').transform(() => null))
    .nullable(),
  readPropertiesFromDocumentStore: z.boolean().nullable().optional(),
});

const avatarSchema = z.object({
  imageId: z.string().nullable(),
});

const addTagSchema = z.object({
  tagId: z.uuid(),
});

const removeTagSchema = z.object({
  tagId: z.uuid(),
});

const setDefaultPartnerSchema = z.object({
  partnerId: z.uuid().nullable(),
});

const optimizeStreamSchema = z.object({
  connectionProfileId: z.string().uuid(),
  maxMemories: z.number().int().min(5).max(200).optional().default(30),
  searchQuery: z.string().max(500).optional().default(''),
  useSemanticSearch: z.boolean().optional().default(true),
  sinceDate: z.string().nullable().optional().default(null),
  beforeDate: z.string().nullable().optional().default(null),
});

const CHARACTER_GET_ACTIONS = ['export', 'chats', 'cascade-preview', 'default-partner', 'get-tags'] as const;
type CharacterGetAction = typeof CHARACTER_GET_ACTIONS[number];

const generateExternalPromptSchema = z.object({
  connectionProfileId: z.string().uuid(),
  systemPromptId: z.string().uuid(),
  scenarioId: z.string().uuid().optional(),
  descriptionId: z.string().uuid().optional(),
  clothingRecordId: z.string().uuid().optional(),
  maxTokens: z.number().int().min(1000).max(20000),
});

const CHARACTER_POST_ACTIONS = ['favorite', 'avatar', 'add-tag', 'remove-tag', 'toggle-controlled-by', 'set-default-partner', 'optimize-stream', 'generate-external-prompt', 'refresh-archive', 'sync-properties-from-vault'] as const;
type CharacterPostAction = typeof CHARACTER_POST_ACTIONS[number];

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const action = getActionParam(req);

  // First verify ownership for all actions
  const character = await repos.characters.findById(id);
  if (!checkOwnership(character, user.id)) {
    return notFound('Character');
  }

  const handleDefaultGet = async (): Promise<NextResponse> => {
    try {
      const defaultImage = await enrichWithDefaultImage(character.defaultImageId, repos);
      const chats = await repos.chats.findByCharacterId(id);

      const enrichedCharacter = {
        ...character,
        defaultImage,
        _count: {
          chats: chats.length,
        },
      };

      return NextResponse.json({ character: enrichedCharacter });
    } catch (error) {
      logger.error('[Characters v1] Error fetching character', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch character');
    }
  };

  if (!action || !isValidAction(action, CHARACTER_GET_ACTIONS)) {
    return handleDefaultGet();
  }

  const actionHandlers: Record<CharacterGetAction, () => Promise<NextResponse>> = {
    export: async () => {
      try {
        const { searchParams } = req.nextUrl;
        const format = searchParams.get('format') || 'json';

        if (format === 'png') {
          let avatarBuffer: Buffer | undefined;
          if (character.defaultImageId) {
            try {
              avatarBuffer = await readImageBuffer(character.defaultImageId);
            } catch (error) {
              logger.warn('[Characters v1] Could not read avatar for PNG export, using placeholder', {
                characterId: id,
                imageId: character.defaultImageId,
              });
            }
          }

          const pngBuffer = await createSTCharacterPNG(character, avatarBuffer);

          return new NextResponse(new Uint8Array(pngBuffer), {
            headers: {
              'Content-Type': 'image/png',
              'Content-Disposition': `attachment; filename="${character.name}.png"`,
            },
          });
        }

        const stCharacter = exportSTCharacter(character);
        return new NextResponse(JSON.stringify(stCharacter, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${character.name}.json"`,
          },
        });
      } catch (error) {
        logger.error('[Characters v1] Error exporting character', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to export character');
      }
    },
    chats: async () => {
      try {
        const { searchParams } = req.nextUrl;
        const search = searchParams.get('search')?.toLowerCase() || '';
        const limit = parseInt(searchParams.get('limit') || '10', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        const allChats = await repos.chats.findByCharacterId(id);
        const userChats = allChats.filter((chat) => chat.userId === user.id);

        const chatsWithMessages = await Promise.all(
          userChats.map(async (chat) => {
            const allMessages = await repos.chats.getMessages(chat.id);
            const messageTimestamps = allMessages
              .filter((msg) => msg.type === 'message')
              .map((msg) => new Date(msg.createdAt).getTime());
            const lastMessageAt = messageTimestamps.length > 0
              ? new Date(Math.max(...messageTimestamps)).toISOString()
              : chat.updatedAt;
            return { chat, messages: allMessages, lastMessageAt };
          })
        );

        chatsWithMessages.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

        let filteredChats = chatsWithMessages;
        if (search) {
          filteredChats = chatsWithMessages.filter(({ chat, messages }) => {
            if (chat.title?.toLowerCase().includes(search)) {
              return true;
            }
            return messages.some(msg => msg.type === 'message' && msg.content.toLowerCase().includes(search));
          });
        }

        const paginatedChats = filteredChats.slice(offset, offset + limit);

        const projectIds = new Set<string>();
        for (const { chat } of paginatedChats) {
          if (chat.projectId) {
            projectIds.add(chat.projectId);
          }
        }

        const projectMap = new Map<string, { id: string; name: string }>();
        for (const projectId of projectIds) {
          const project = await repos.projects.findById(projectId);
          if (project) {
            projectMap.set(projectId, { id: project.id, name: project.name });
          }
        }

        const enrichedChats = await Promise.all(
          paginatedChats.map(async ({ chat, messages, lastMessageAt }) => {
            const tagData = await Promise.all(
              (chat.tags || []).map(async (tagId) => {
                const tag = await repos.tags.findById(tagId);
                return tag ? { tag: { id: tag.id, name: tag.name } } : null;
              })
            );

            const messageCount = messages.filter((msg) => msg.type === 'message' && msg.role !== 'SYSTEM' && msg.role !== 'TOOL').length;
            const memoryCount = await repos.memories.countByChatId(chat.id);

            // Scriptorium status: check rendered markdown and embedded chunks
            const hasRenderedMarkdown = !!chat.renderedMarkdown;
            let embeddedChunkCount = 0;
            let totalChunkCount = 0;
            if (hasRenderedMarkdown) {
              const chunks = await repos.conversationChunks.findByChatId(chat.id);
              totalChunkCount = chunks.length;
              embeddedChunkCount = chunks.filter(c => c.embedding !== null && c.embedding !== undefined).length;
            }

            const recentMessages = messages
              .filter((msg) => msg.type === 'message')
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .slice(0, 3)
              .map((msg) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                createdAt: msg.createdAt,
              }));

            const project = chat.projectId ? projectMap.get(chat.projectId) || null : null;

            let storyBackground = null;
            if (chat.storyBackgroundImageId) {
              const bgFile = await repos.files.findById(chat.storyBackgroundImageId);
              if (bgFile) {
                storyBackground = {
                  id: bgFile.id,
                  filepath: getFilePath(bgFile),
                };
              }
            }

            return {
              id: chat.id,
              title: chat.title,
              createdAt: chat.createdAt,
              updatedAt: chat.updatedAt,
              lastMessageAt,
              character: {
                id: character.id,
                name: character.name,
              },
              project,
              storyBackground,
              messages: recentMessages,
              tags: tagData.filter((tag): tag is { tag: { id: string; name: string } } => tag !== null),
              isDangerousChat: chat.isDangerousChat === true,
              _count: {
                messages: messageCount,
                memories: memoryCount,
              },
              scriptoriumStatus: hasRenderedMarkdown
                ? (embeddedChunkCount >= totalChunkCount && totalChunkCount > 0 ? 'embedded' : 'rendered')
                : 'none',
            };
          })
        );

        return NextResponse.json({ chats: enrichedChats, total: filteredChats.length });
      } catch (error) {
        logger.error('[Characters v1] Error fetching character chats', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to fetch chats');
      }
    },
    'cascade-preview': async () => {
      try {
        const preview = await getCascadeDeletePreview(id);

        if (!preview) {
          return serverError('Failed to generate preview');
        }

        return NextResponse.json({
          characterId: preview.characterId,
          characterName: preview.characterName,
          exclusiveChats: preview.exclusiveChats.map(c => ({
            id: c.chat.id,
            title: c.chat.title,
            messageCount: c.messageCount,
            lastMessageAt: c.chat.lastMessageAt,
          })),
          exclusiveCharacterImageCount: preview.exclusiveCharacterImages.length,
          exclusiveChatImageCount: preview.exclusiveChatImages.length,
          totalExclusiveImageCount:
            preview.exclusiveCharacterImages.length + preview.exclusiveChatImages.length,
          memoryCount: preview.memoryCount,
        });
      } catch (error) {
        logger.error('[Characters v1] Error generating cascade delete preview', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to generate preview');
      }
    },
    'default-partner': async () => {
      try {
        return NextResponse.json({
          partnerId: character.defaultPartnerId || null,
        });
      } catch (error) {
        logger.error('[Characters v1] Error fetching default partner', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to fetch default partner');
      }
    },
    'get-tags': async () => {
      try {
        const tagDetails = await Promise.all(
          (character.tags || []).map(async (tagId) => {
            const tag = await repos.tags.findById(tagId);
            return tag ? { id: tag.id, name: tag.name, visualStyle: tag.visualStyle } : null;
          })
        );

        const validTags = tagDetails.filter(Boolean);
        return NextResponse.json({ tags: validTags });
      } catch (error) {
        logger.error('[Characters v1] Error fetching character tags', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to fetch character tags');
      }
    },
  };

  return actionHandlers[action]();
});

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const existingCharacter = await repos.characters.findById(id);

  if (!checkOwnership(existingCharacter, user.id)) {
    return notFound('Character');
  }

  const body = await req.json();
  const validatedData = updateCharacterSchema.parse(body);

  // Normalize scenarios: fill in missing id/createdAt/updatedAt
  const { scenarios: rawScenarios, ...restValidatedData } = validatedData;
  const updatePayload: Partial<Character> = { ...restValidatedData };
  if (rawScenarios) {
    const now = new Date().toISOString();
    updatePayload.scenarios = rawScenarios.map(s => ({
      id: s.id ?? crypto.randomUUID(),
      title: s.title,
      content: s.content,
      createdAt: s.createdAt ?? now,
      updatedAt: s.updatedAt ?? now,
    }));
  }

  const character = await repos.characters.update(id, updatePayload);

  revalidatePath('/');

  logger.info('[Characters v1] Character updated', { characterId: id });

  return NextResponse.json({ character });
});

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {
    const existingCharacter = await repos.characters.findById(id);

    if (!checkOwnership(existingCharacter, user.id)) {
      return notFound('Character');
    }

    // Parse cascade options
    const { searchParams } = req.nextUrl;
    const cascadeChats = searchParams.get('cascadeChats') === 'true';
    const cascadeImages = searchParams.get('cascadeImages') === 'true';

    const result = await executeCascadeDelete(id, {
      deleteExclusiveChats: cascadeChats,
      deleteExclusiveImages: cascadeImages,
    });

    if (!result.success) {
      return serverError('Failed to delete character');
    }

    logger.info('[Characters v1] Character deleted', {
      characterId: id,
      deletedChats: result.deletedChats,
      deletedImages: result.deletedImages,
      deletedMemories: result.deletedMemories,
    });

    return NextResponse.json({
      success: true,
      deletedChats: result.deletedChats,
      deletedImages: result.deletedImages,
      deletedMemories: result.deletedMemories,
    });
  } catch (error) {
    logger.error('[Characters v1] Error deleting character', { characterId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete character');
  }
});

// ============================================================================
// POST Handler - Helper Functions
// ============================================================================

async function handleOptimizeStream(
  req: NextRequest,
  user: any,
  repos: any,
  characterId: string
): Promise<NextResponse> {

  const body = await req.json();
  const { connectionProfileId, maxMemories, searchQuery, useSemanticSearch, sinceDate, beforeDate } = optimizeStreamSchema.parse(body);

  logger.info('[Characters v1] Character optimizer starting (streaming)', {
    userId: user.id,
    characterId,
    connectionProfileId,
    maxMemories,
    searchQuery: searchQuery || '(none)',
    useSemanticSearch,
    sinceDate,
    beforeDate,
  });

  const encoder = new TextEncoder();
  const optimizerOptions = { maxMemories, searchQuery, useSemanticSearch, sinceDate, beforeDate };

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: OptimizerProgressEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream may be closed
        }
      };

      await runCharacterOptimizer(characterId, connectionProfileId, user.id, repos, enqueue, optimizerOptions);

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
}

// ============================================================================
// POST Handler - Actions
// ============================================================================

export const POST = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const action = getActionParam(req);

  // Verify ownership first
  const character = await repos.characters.findById(id);
  if (!checkOwnership(character, user.id)) {
    return notFound('Character');
  }

  if (!isValidAction(action, CHARACTER_POST_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${CHARACTER_POST_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<CharacterPostAction, () => Promise<NextResponse>> = {
    favorite: async () => {
      try {
        const updatedCharacter = await repos.characters.setFavorite(id, !character.isFavorite);
        logger.info('[Characters v1] Favorite toggled', {
          characterId: id,
          isFavorite: updatedCharacter?.isFavorite,
        });
        return NextResponse.json({ character: updatedCharacter });
      } catch (error) {
        logger.error('[Characters v1] Error toggling favorite', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to toggle favorite');
      }
    },

    avatar: async () => {
      const body = await req.json();
      const { imageId } = avatarSchema.parse(body);

      // Validate image if provided
      if (imageId) {
        const fileEntry = await repos.files.findById(imageId);

        if (!fileEntry) {
          return notFound('Image file');
        }

        if (fileEntry.category !== 'IMAGE' && fileEntry.category !== 'AVATAR') {
          return badRequest(`Invalid file type. Expected IMAGE or AVATAR, got ${fileEntry.category}`);
        }
      }

      const updatedCharacter = await repos.characters.update(id, {
        defaultImageId: imageId,
      });

      // Build response with file info
      const defaultImage = await enrichWithDefaultImage(updatedCharacter?.defaultImageId, repos);

      logger.info('[Characters v1] Avatar updated', {
        characterId: id,
        newImageId: imageId,
      });

      return NextResponse.json({
        data: {
          ...updatedCharacter,
          defaultImage,
        },
      });
    },

    'add-tag': async () => {
      const body = await req.json();
      const validatedData = addTagSchema.parse(body);

      // Verify tag exists and belongs to user
      const tag = await repos.tags.findById(validatedData.tagId);

      if (!tag) {
        return notFound('Tag');
      }

      await repos.characters.addTag(id, validatedData.tagId);

      logger.info('[Characters v1] Tag added', {
        characterId: id,
        tagId: validatedData.tagId,
      });

      return NextResponse.json({ success: true, tag }, { status: 201 });
    },

    'remove-tag': async () => {
      const body = await req.json();
      const validatedData = removeTagSchema.parse(body);

      await repos.characters.removeTag(id, validatedData.tagId);

      logger.info('[Characters v1] Tag removed', {
        characterId: id,
        tagId: validatedData.tagId,
      });

      return NextResponse.json({ success: true });
    },

    'toggle-controlled-by': async () => {
      try {
        // Toggle the controlledBy property
        const newControlledBy = character.controlledBy === 'user' ? 'llm' : 'user';
        const updatedCharacter = await repos.characters.setControlledBy(id, newControlledBy);

        logger.info('[Characters v1] ControlledBy toggled', { characterId: id, controlledBy: newControlledBy });

        return NextResponse.json({ character: updatedCharacter });
      } catch (error) {
        logger.error('[Characters v1] Error toggling controlledBy', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to toggle controlled-by');
      }
    },

    'set-default-partner': async () => {
      const body = await req.json();
      const { partnerId } = setDefaultPartnerSchema.parse(body);

      // If partnerId is provided, verify it exists and is user-controlled
      if (partnerId) {
        const partner = await repos.characters.findById(partnerId);
        if (!partner) {
          return notFound('Partner character');
        }
        if (partner.controlledBy !== 'user') {
          return badRequest('Partner must be a user-controlled character');
        }
        if (partnerId === id) {
          return badRequest('Character cannot be its own partner');
        }
      }

      await repos.characters.update(id, {
        defaultPartnerId: partnerId,
      });

      logger.info('[Characters v1] Default partner updated', {
        characterId: id,
        partnerId,
      });

      return NextResponse.json({
        partnerId,
        success: true,
      });
    },

    'optimize-stream': () => handleOptimizeStream(req, user, repos, id),

    'generate-external-prompt': async () => {
      const body = await req.json();
      const validated = generateExternalPromptSchema.parse(body);

      logger.info('[Characters v1] External prompt generation starting', {
        userId: user.id,
        characterId: id,
        connectionProfileId: validated.connectionProfileId,
        maxTokens: validated.maxTokens,
      });

      const result = await generateExternalPrompt(id, validated, user.id, repos);

      if (!result.success) {
        return serverError(result.error || 'Generation failed');
      }

      return NextResponse.json({ prompt: result.prompt, tokensUsed: result.tokensUsed });
    },

    'sync-properties-from-vault': async () => {
      try {
        // Use the raw character so we see the canonical DB state, not the overlay.
        const rawCharacter = await repos.characters.findByIdRaw(id);
        if (!rawCharacter) {
          return notFound('Character');
        }
        if (!rawCharacter.characterDocumentMountPointId) {
          return badRequest('Character has no linked document-store vault to sync from');
        }

        const mountId = rawCharacter.characterDocumentMountPointId;
        const [
          props,
          descMd,
          persMd,
          dialoguesMd,
          physDescMd,
          physPromptsJson,
          vaultPrompts,
          vaultScenarios,
          vaultWardrobe,
        ] = await Promise.all([
          readCharacterVaultProperties(mountId, rawCharacter.id),
          readCharacterVaultDescription(mountId, rawCharacter.id),
          readCharacterVaultPersonality(mountId, rawCharacter.id),
          readCharacterVaultExampleDialogues(mountId, rawCharacter.id),
          readCharacterVaultPhysicalDescription(mountId, rawCharacter.id),
          readCharacterVaultPhysicalPrompts(mountId, rawCharacter.id),
          readCharacterVaultSystemPrompts(mountId, rawCharacter.id),
          readCharacterVaultScenarios(mountId, rawCharacter.id),
          readCharacterVaultWardrobe(mountId, rawCharacter.id),
        ]);

        const patch: Record<string, unknown> = {};

        if (props) {
          patch.pronouns = props.pronouns;
          patch.aliases = props.aliases;
          patch.title = props.title;
          patch.firstMessage = props.firstMessage;
          patch.talkativeness = props.talkativeness;
        }

        if (descMd !== null) {
          patch.description = descMd === '' ? null : descMd;
        }
        if (persMd !== null) {
          patch.personality = persMd === '' ? null : persMd;
        }
        if (dialoguesMd !== null) {
          patch.exampleDialogues = dialoguesMd === '' ? null : dialoguesMd;
        }

        if (vaultPrompts.length > 0) {
          patch.systemPrompts = vaultPrompts;
        }
        if (vaultScenarios.length > 0) {
          patch.scenarios = vaultScenarios;
        }

        const existingPhysical = rawCharacter.physicalDescriptions ?? [];
        const hasPhysicalInput = physDescMd !== null || physPromptsJson !== null;
        let physicalSkippedNoPrimary = false;

        if (hasPhysicalInput) {
          if (existingPhysical.length === 0) {
            physicalSkippedNoPrimary = true;
          } else {
            const first = existingPhysical[0];
            const patched = { ...first };
            if (physDescMd !== null) {
              patched.fullDescription = physDescMd === '' ? null : physDescMd;
            }
            if (physPromptsJson !== null) {
              patched.shortPrompt = physPromptsJson.short;
              patched.mediumPrompt = physPromptsJson.medium;
              patched.longPrompt = physPromptsJson.long;
              patched.completePrompt = physPromptsJson.complete;
            }
            patched.updatedAt = new Date().toISOString();
            patch.physicalDescriptions = [patched, ...existingPhysical.slice(1)];
          }
        }

        // Wardrobe syncs against separate tables (wardrobe_items,
        // outfit_presets), not character-row columns, so it doesn't feed
        // `patch`. When the vault file is valid we replace the character's
        // active wardrobe wholesale — the same "vault is the list" semantics
        // used for systemPrompts / scenarios above.
        let wardrobeItemsWritten = 0;
        let wardrobePresetsWritten = 0;
        const wardrobeSynced = vaultWardrobe !== null;
        if (vaultWardrobe) {
          const existingItems = await repos.wardrobe.findByCharacterIdRaw(
            rawCharacter.id,
            true,
          );
          for (const item of existingItems) {
            await repos.wardrobe.delete(item.id);
          }
          const existingPresets = await repos.outfitPresets.findByCharacterIdRaw(
            rawCharacter.id,
          );
          for (const preset of existingPresets) {
            await repos.outfitPresets.delete(preset.id);
          }

          for (const item of vaultWardrobe.items) {
            await repos.wardrobe.create(
              {
                characterId: rawCharacter.id,
                title: item.title,
                description: item.description ?? null,
                types: item.types,
                appropriateness: item.appropriateness ?? null,
                isDefault: item.isDefault,
                migratedFromClothingRecordId: item.migratedFromClothingRecordId ?? null,
                archivedAt: item.archivedAt ?? null,
              },
              { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt },
            );
            wardrobeItemsWritten++;
          }
          for (const preset of vaultWardrobe.presets) {
            await repos.outfitPresets.create(
              {
                characterId: rawCharacter.id,
                name: preset.name,
                description: preset.description ?? null,
                slots: preset.slots,
              },
              {
                id: preset.id,
                createdAt: preset.createdAt,
                updatedAt: preset.updatedAt,
              },
            );
            wardrobePresetsWritten++;
          }
        }

        if (Object.keys(patch).length === 0 && !wardrobeSynced) {
          return badRequest(
            "This character's vault has no valid overlay files to sync; nothing to do"
          );
        }

        const updatedCharacter =
          Object.keys(patch).length > 0
            ? await repos.characters.update(id, patch)
            : await repos.characters.findById(id);

        logger.info('[Characters v1] Synced character properties from vault', {
          characterId: id,
          mountPointId: mountId,
          syncedProperties: !!props,
          syncedDescription: descMd !== null,
          syncedPersonality: persMd !== null,
          syncedExampleDialogues: dialoguesMd !== null,
          syncedPhysicalDescription: physDescMd !== null && !physicalSkippedNoPrimary,
          syncedPhysicalPrompts: physPromptsJson !== null && !physicalSkippedNoPrimary,
          physicalSkippedNoPrimary,
          syncedSystemPromptCount: vaultPrompts.length,
          syncedScenarioCount: vaultScenarios.length,
          syncedWardrobe: wardrobeSynced,
          wardrobeItemsWritten,
          wardrobePresetsWritten,
        });

        return NextResponse.json({ character: updatedCharacter });
      } catch (error) {
        logger.error('[Characters v1] Error syncing properties from vault', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to sync properties from vault');
      }
    },

    'refresh-archive': async () => {
      try {
        // Find all chats this character participates in
        const chats = await repos.chats.findByCharacterId(id);

        if (chats.length === 0) {
          return NextResponse.json({ queued: 0 });
        }

        let queued = 0;
        for (const chat of chats) {
          try {
            await enqueueConversationRender(user.id, {
              chatId: chat.id,
              fullReembed: true,
            });
            queued++;
          } catch (err) {
            // Skip chats that already have a pending render job
            logger.debug('[Characters v1] Skipped render enqueue (likely already pending)', {
              characterId: id,
              chatId: chat.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        logger.info('[Characters v1] Conversation archive refresh queued', {
          characterId: id,
          userId: user.id,
          totalChats: chats.length,
          queued,
        });

        return NextResponse.json({ queued, total: chats.length });
      } catch (error) {
        logger.error('[Characters v1] Error refreshing conversation archive', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to refresh conversation archive');
      }
    },
  };

  return actionHandlers[action]();
});
