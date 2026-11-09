/**
 * Chats API v1 - Collection Endpoint
 *
 * GET  /api/v1/chats                          - List the operator's chats
 * GET  /api/v1/chats?action=casting-defaults  - The defaults a prospective cast would get
 * POST /api/v1/chats                          - Cast a chat (it opens when the Salon opens it)
 * POST /api/v1/chats?action=import            - Import a SillyTavern chat
 *
 * Casting is `castChat` (`lib/chat/opening/cast.ts`); the opening — dressing,
 * packing, the staff's posts and the greeting — is `runOpening`
 * (`lib/chat/opening/run.ts`), started by the Salon, an autonomous room's run
 * start, or `POST /api/v1/chats/[id]?action=open`.
 */

import { NextRequest } from 'next/server';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { notFound, badRequest, serverError, successResponse, created, errorResponse } from '@/lib/api/responses';
import {
  enrichParticipantSummary,
  enrichChatsForList,
  filterChatsByExcludedTags,
  cleanEnrichedChats,
} from '@/lib/services/chat-enrichment.service';
import {
  importMultiCharacterChat,
  importLegacyChat,
  type MultiCharacterImportOptions,
  type LegacyImportOptions,
} from '@/lib/import/sillytavern-import-service';
import { castChat } from '@/lib/chat/opening/cast';
import { createChatSchema, castingDefaultsQuerySchema } from '@/lib/chat/opening/schema';
import {
  CastingProjectNotFoundError,
  resolveCastingDefaults,
  type CastingSeat,
} from '@/lib/chat/opening/defaults';

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * List chats
 */
async function handleList(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const { searchParams } = req.nextUrl;
    const excludeTagIdsParam = searchParams.get('excludeTagIds');
    const limitParam = searchParams.get('limit');
    const includeAutonomous = searchParams.get('includeAutonomous') === 'true';
    const excludeTagIds = excludeTagIdsParam ? excludeTagIdsParam.split(',').filter(Boolean) : [];
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const allChatMetadata = await repos.chats.findByUserId(user.id);
    // Default Salon listing: salon chats only (no help, no autonomous unless asked).
    // Autonomous rooms with per-room runVisibility = 'household' | 'open' are
    // visible regardless of the includeAutonomous flag (per-room override
    // wins over the user-level visibility default).
    const chatMetadata = allChatMetadata.filter((c: any) => {
      if (!c.chatType || c.chatType === 'salon') return true;
      if (c.chatType === 'autonomous') {
        if (includeAutonomous) return true;
        if (c.runVisibility === 'household' || c.runVisibility === 'open') return true;
        return false;
      }
      return false;
    });
    const enrichedChats = await enrichChatsForList(chatMetadata, repos);
    // A chat cast but not yet opened says so, so the list can show it.
    const unopened = await repos.chats.findUnopenedChatStates();
    let filteredChats = filterChatsByExcludedTags(enrichedChats, excludeTagIds);

    if (limit && limit > 0) {
      filteredChats = filteredChats.slice(0, limit);
    }

    const result = cleanEnrichedChats(filteredChats).map((chat) => ({
      ...chat,
      openingState: unopened.get(chat.id) ?? 'done',
    }));

    return successResponse({ chats: result });
  } catch (error) {
    logger.error('[Chats v1] Error listing chats', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch chats');
  }
}

/**
 * Cast a chat. Returns as soon as the row exists, `openingState: 'pending'`.
 */
async function handleCreate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;
  const input = createChatSchema.parse(await req.json());

  const result = await castChat(input, { userId: user.id, repos });
  if (!result.ok) {
    return result.refusal.status === 404
      ? errorResponse(result.refusal.message, 404)
      : badRequest(result.refusal.message);
  }

  const participants = await Promise.all(
    result.chat.participants.map((p) => enrichParticipantSummary(p, repos))
  );
  return created({ chat: { ...result.chat, openingState: 'pending', participants } });
}

/**
 * The defaults a prospective cast would get — what the New Chat dialog shows
 * before the operator changes anything. Casting resolves the same way.
 */
async function handleCastingDefaults(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;
  const parsed = castingDefaultsQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return badRequest('characterIds is required (comma-separated character ids)');
  }
  const query = parsed.data;
  try {
    const userCharacterIds = new Set(query.userCharacterIds);
    const seats: CastingSeat[] = [];
    for (const characterId of query.characterIds) {
      const character = await repos.characters.findById(characterId);
      if (!character) return notFound('Character');
      seats.push({ character, controlledBy: userCharacterIds.has(characterId) ? 'user' : 'llm' });
    }
    if (query.continuationFromChatId && !(await repos.chats.findById(query.continuationFromChatId))) {
      return notFound('Source chat');
    }
    const defaults = await resolveCastingDefaults({
      repos,
      userId: user.id,
      seats,
      projectId: query.projectId ?? null,
      continuationFromChatId: query.continuationFromChatId ?? null,
      chatType: query.chatType,
    });
    return successResponse({ defaults });
  } catch (error) {
    if (error instanceof CastingProjectNotFoundError) return notFound('Project');
    logger.error('[Chats v1] Error resolving casting defaults', { error: getErrorMessage(error) }, error instanceof Error ? error : undefined);
    return serverError('Failed to resolve casting defaults');
  }
}

/**
 * Import chat (SillyTavern format)
 */
async function handleImport(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();

    // Detect which mode we're in based on request body
    if (body.mappings) {
      // Multi-character mode
      if (!body.chatData || !body.mappings || body.mappings.length === 0) {
        return badRequest('Chat data and mappings are required');
      }

      const options: MultiCharacterImportOptions = {
        chatData: body.chatData,
        mappings: body.mappings,
        defaultConnectionProfileId: body.defaultConnectionProfileId,
        triggerTitleGeneration: body.triggerTitleGeneration,
        createMemories: body.createMemories,
        title: body.title,
      };

      try {
        const result = await importMultiCharacterChat(user.id, options, repos);

        return created({
          ...result.chat,
          createdEntities: result.createdEntities,
          triggerTitleGeneration: options.triggerTitleGeneration || false,
          memoryJobCount: result.memoryJobCount,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('not found') || errorMessage.includes('At least one character')) {
          return badRequest(errorMessage);
        }

        throw error;
      }
    } else {
      // Legacy single-character mode
      if (!body.chatData || !body.characterId || !body.connectionProfileId) {
        return badRequest('Chat data, character ID, and connection profile ID are required');
      }

      const options: LegacyImportOptions = {
        chatData: body.chatData,
        characterId: body.characterId,
        connectionProfileId: body.connectionProfileId,
        title: body.title,
      };

      try {
        const result = await importLegacyChat(user.id, options, repos);

        const character = result.chat.participants.find((p) => p.type === 'CHARACTER')?.character;

        return created({
          ...result.chat,
          character,
          connectionProfile: { id: body.connectionProfileId },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('not found')) {
          return notFound('Resource');
        }

        throw error;
      }
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to import chat');
    logger.error('[Chats v1] Error importing chat', { errorMessage }, error instanceof Error ? error : undefined);
    return serverError(errorMessage);
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /api/v1/chats - List, or `?action=casting-defaults`
 */
export const GET = createContextHandler(async (req, context) =>
  dispatchAction(req, { 'casting-defaults': () => handleCastingDefaults(req, context) }, () => handleList(req, context))
);

/**
 * POST /api/v1/chats - Action dispatch or create
 */
export const POST = createContextHandler(async (req, context) =>
  dispatchAction(req, { import: () => handleImport(req, context) }, () => handleCreate(req, context))
);
