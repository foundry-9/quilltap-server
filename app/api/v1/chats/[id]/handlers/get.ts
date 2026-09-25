/**
 * Chats API v1 - GET Handler
 *
 * GET /api/v1/chats/[id] - Get a specific chat
 * GET /api/v1/chats/[id]?action=export - Export chat (SillyTavern JSONL)
 * GET /api/v1/chats/[id]?action=export-markdown - Export chat as a Markdown transcript
 * GET /api/v1/chats/[id]?action=cost - Get cost breakdown
 * GET /api/v1/chats/[id]?action=get-avatars - Get avatar overrides for chat
 * GET /api/v1/chats/[id]?action=get-state - Get chat state (merged with project)
 * GET /api/v1/chats/[id]?action=get-background - Get story background URL
 * GET /api/v1/chats/[id]?action=outfit - Get equipped outfit state
 * GET /api/v1/chats/[id]?action=outfit-summary - Equipped outfit with resolved item titles
 * GET /api/v1/chats/[id]?action=photo-albums - Candidate save targets for an image
 * GET /api/v1/chats/[id]?action=informs - List the pending Inform batches
 * GET /api/v1/chats/[id]?action=group-stores - Document stores of the persona's groups
 * GET /api/v1/chats/[id]?action=mailbox&characterId=… - A player-character's mailbox letters
 * GET /api/v1/chats/[id]?action=accessible-stores[&all=true] - Stores for the Open-Document picker
 * GET /api/v1/chats/[id]?action=gallery - List every image in the conversation
 *
 * An unregistered `?action=` answers 400 with the list above; it never falls
 * through to the chat body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { exportSTChatAsJSONL } from '@/lib/sillytavern/chat';
import { getChatCostBreakdown, getDetailedChatCostBreakdown } from '@/lib/services/cost-estimation.service';
import { enrichParticipantDetail } from '@/lib/services/chat-enrichment.service';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { resolveAgentModeSetting } from '@/lib/services/chat-message/agent-mode-resolver.service';
import { reconcileTerminalSessionsForChat } from '@/lib/terminal/reconcile';
import { surfaceOperatorMailForChat } from '@/lib/post-office/surface-operator-mail';
import { maybeEnqueueColdChunkReembed } from '@/lib/scriptorium/cold-chunk-reembed';
import { projectChatTranscript } from '@/lib/chat/transcript-projection';
import {
  handleGetAvatars,
  handleGetState,
  handleGetOutfit,
  handleGetOutfitSummary,
  handleGetPhotoAlbums,
  handleGetGroupStores,
  handleAccessibleStores,
  handleGetMailbox,
  handleExportMarkdown,
  handleGetInforms,
  handleGetStoryBackground,
} from '../actions';
import { getChatGallery } from '@/lib/photos/chat-gallery';
import type { RequestContext } from '@/lib/api/middleware';
import { getConciergeProvenance, getConciergeReason, getConciergeState } from '@/lib/services/dangerous-content/chat-override';

/**
 * GET handler for individual chat
 */
export async function handleGet(
  req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  return dispatchAction(
    req,
    {
      'export': () => handleExport(req, ctx, chatId),
      'export-markdown': () => handleExportMarkdown(chatId, ctx),
      'get-avatars': () => handleGetAvatars(chatId, ctx),
      'get-state': () => handleGetState(chatId, ctx),
      'outfit': () => handleGetOutfit(chatId, ctx),
      'outfit-summary': () => handleGetOutfitSummary(chatId, ctx),
      'photo-albums': () => handleGetPhotoAlbums(chatId, ctx),
      'informs': () => handleGetInforms(chatId, ctx),
      'group-stores': () => handleGetGroupStores(chatId, ctx),
      'mailbox': () => handleGetMailbox(req, chatId, ctx),
      // `?all=true` is the Open-Document picker's "look everywhere" mode
      // (every enabled store, not just this chat's reach).
      'accessible-stores': () =>
        handleAccessibleStores(chatId, ctx, { all: req.nextUrl.searchParams.get('all') === 'true' }),
      'get-background': () => handleGetStoryBackground(chatId, ctx),
      'gallery': () => handleGallery(req, ctx, chatId),
      'cost': () => handleCost(req, ctx, chatId),
    },
    () => handleGetChat(req, ctx, chatId)
  );
}

/**
 * Handle export action - the chat as a SillyTavern JSONL download
 */
async function handleExport(
  _req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    const allEvents = await repos.chats.getMessages(chatId);
    const messages = allEvents.filter((event) => event.type === 'message');

    const characterParticipants = chat.participants.filter(
      (p) => p.type === 'CHARACTER' && p.characterId
    );
    const primaryParticipant = characterParticipants[0];
    if (!primaryParticipant?.characterId) {
      return notFound('No character in chat');
    }

    // Load every character participant so each message can be attributed to
    // its real author. The map is keyed by participant id (what messages
    // carry in `participantId`); broken-vault characters are dropped by
    // findByIds and simply fall back to the primary name in the export.
    const characters = await repos.characters.findByIds(
      characterParticipants
        .map((p) => p.characterId)
        .filter((id): id is string => typeof id === 'string')
    );
    const charactersById = new Map(characters.map((c) => [c.id, c]));
    const participantNames = new Map<string, string>();
    for (const p of characterParticipants) {
      const name = p.characterId ? charactersById.get(p.characterId)?.name : undefined;
      if (name) participantNames.set(p.id, name);
    }

    const primaryCharacter = charactersById.get(primaryParticipant.characterId);
    if (!primaryCharacter) {
      return notFound('Character');
    }

    const userName = user.name || 'User';

    const formattedMessages = messages.map((msg) => ({
      id: msg.id,
      chatId,
      role: msg.role,
      content: msg.content,
      createdAt: new Date(msg.createdAt),
      updatedAt: new Date(msg.createdAt),
      swipeGroupId: msg.swipeGroupId || null,
      swipeIndex: msg.swipeIndex || null,
      tokenCount: msg.tokenCount || null,
      rawResponse: msg.rawResponse || null,
      participantId: msg.participantId || null,
    }));

    const chatForExport = {
      ...chat,
      createdAt: new Date(chat.createdAt),
      updatedAt: new Date(chat.updatedAt),
    };

    const jsonlContent = exportSTChatAsJSONL(
      chatForExport,
      formattedMessages,
      primaryCharacter.name,
      userName,
      participantNames
    );
    const chatCreatedTime = new Date(chat.createdAt).getTime();
    const filename = `${primaryCharacter.name}_chat_${chatCreatedTime}.jsonl`;

    return new NextResponse(jsonlContent, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error('[Chats v1] Error exporting chat', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to export chat');
  }
}

/**
 * Handle gallery action — every image in the conversation, whatever made it.
 * The nine sources and their dedup live in `lib/photos/chat-gallery.ts`; this
 * route only answers with what the enumerator found.
 */
async function handleGallery(
  _req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  const { repos } = ctx;

  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    const gallery = await getChatGallery(chatId, repos);
    logger.debug('[Chats v1] Gallery listed', {
      chatId,
      total: gallery.total,
      counts: gallery.counts,
    });
    return NextResponse.json(gallery);
  } catch (error) {
    logger.error('[Chats v1] Failed to list chat gallery', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to list chat gallery');
  }
}

/**
 * Handle cost action - the chat's cost breakdown (`?detailed=true` for the
 * per-message form)
 */
async function handleCost(
  req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    const searchParams = req.nextUrl.searchParams;
    const detailed = searchParams.get('detailed') === 'true';

    const breakdown = detailed
      ? await getDetailedChatCostBreakdown(chatId, user.id)
      : await getChatCostBreakdown(chatId, user.id);
    return NextResponse.json(breakdown);
  } catch (error) {
    logger.error('[Chats v1] Failed to get cost breakdown', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to get cost breakdown');
  }
}

/**
 * Default: the chat itself, with its enriched participants and projected
 * transcript
 */
async function handleGetChat(
  _req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {
    const chatMetadata = await repos.chats.findById(chatId);
    if (!chatMetadata) {
      return notFound('Chat');
    }

    // Cold-tier re-warm: if the maintenance sweep cold-tiered this chat's
    // conversation-chunk embeddings, opening it re-enqueues them through the
    // standard embedding pipeline. Fire-and-forget (debounced + deduped
    // inside) — never allowed to slow or break the chat load.
    maybeEnqueueColdChunkReembed(user.id, chatId).catch((error) => {
      logger.warn('[Chats v1] Cold-chunk re-embed check failed — continuing', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Sweep terminal sessions whose PTYs were lost across a server restart
    // (DB row says "live" but ptyManager doesn't have it) and post the close
    // announcements before we read the message history below.
    await reconcileTerminalSessionsForChat(chatId);

    // The Post Office: announce any letters addressed to the operator's own
    // character(s) before we read the history below. A user-controlled
    // participant never takes an LLM turn, so the per-turn mail check never
    // covers it; without this, mail to the operator's character would sit
    // unannounced in an idle room. Idempotent and warn-only inside.
    await surfaceOperatorMailForChat(chatId, chatMetadata.participants);

    const enrichedParticipants = await Promise.all(
      chatMetadata.participants.map((p) => enrichParticipantDetail(p, repos, chatId))
    );

    // The transcript itself — attachments, pre-rendered HTML and the off-scene
    // author cards — is projected by the one module the conditional re-read
    // (`GET /api/v1/messages?chatId=…&action=transcript`) also uses, so the two
    // reads of the same conversation cannot drift apart.
    //
    // The counter is read here rather than taken from `chatMetadata`, which was
    // loaded before the terminal reconciliation and the operator-mail sweep
    // above — both of which can post a message. Reading it now, still before
    // the projection, keeps the version no newer than the rows it is handed out
    // with: too old only ever costs the tab a redundant read, while too new
    // would have it answered "unchanged" for a message it never received.
    const transcriptVersion = await repos.chats.getTranscriptVersion(chatId);
    const { messages, offSceneCharacters } = await projectChatTranscript(
      chatId,
      chatMetadata,
      repos,
      user.id,
    );

    let projectName: string | null = null;
    let project = null;
    if (chatMetadata.projectId) {
      try {
        project = await repos.projects.findById(chatMetadata.projectId);
        if (project) {
          projectName = project.name;
        }
      } catch {
        // Project might have been deleted
      }
    }

    // Resolve agent mode through the cascade: Global → Character → Project → Chat
    let primaryCharacter = null;
    const characterParticipant = chatMetadata.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId
    );
    if (characterParticipant?.characterId) {
      try {
        primaryCharacter = await repos.characters.findById(characterParticipant.characterId);
      } catch {
        // Character might have been deleted
      }
    }

    const chatSettings = await repos.chatSettings.findByUserId(user.id);
    // The Concierge's tally, for the helper text of a chat he moved after
    // refusals ("after N refusals"). Emptied when the chat returns to Moderated.
    const conciergeLedger = await repos.chats.getModerationRefusalLedger(chatId);
    const resolvedAgentMode = resolveAgentModeSetting(chatMetadata, project, primaryCharacter, chatSettings);

    const chat = {
      id: chatMetadata.id,
      title: chatMetadata.title,
      // Surfaced so the Salon sidebar can gate the "Edit Enclave" control to
      // autonomous rooms. Defaults to 'salon' for legacy rows without the column.
      chatType: chatMetadata.chatType ?? 'salon',
      contextSummary: chatMetadata.contextSummary,
      roleplayTemplateId: chatMetadata.roleplayTemplateId,
      imageProfileId: chatMetadata.imageProfileId ?? null,
      lastTurnParticipantId: chatMetadata.lastTurnParticipantId ?? null,
      // Impersonation overlay state — projected so a reload (or a mid-session
      // server restart) restores the "speaking as" selection and the impersonated
      // seats instead of snapping every seat back to LLM-controlled. Without these
      // the client's useImpersonation sync reads `undefined` and shows an
      // impersonated character as not impersonated.
      impersonatingParticipantIds: chatMetadata.impersonatingParticipantIds ?? [],
      activeTypingParticipantId: chatMetadata.activeTypingParticipantId ?? null,
      // The cycle's rotation and who has already spoken in it (bug 147). The
      // Salon recomputes "whose turn is it" locally from these two columns plus
      // history — `calculateTurnStateFromHistory` takes them as arguments — and
      // without them on the wire it reads `undefined` for both, which parses to
      // an empty rotation and an empty spoken-set. `selectNextSpeaker` then can
      // never take its cycle-order branch and falls through to a fresh weighted
      // roll on every recompute, so the client contradicts the server's already
      // drawn and persisted rotation. They are strings on purpose: the column is
      // the JSON the turn manager's parsers expect, and re-encoding it here would
      // put a second shape of the same fact on the wire.
      spokenThisCycleParticipantIds: chatMetadata.spokenThisCycleParticipantIds ?? '[]',
      cycleOrderParticipantIds: chatMetadata.cycleOrderParticipantIds ?? '[]',
      isPaused: chatMetadata.isPaused ?? false,
      // All-LLM-pause bookkeeping — surfaced so the client can explain a silent
      // pause (opens AllLLMPauseModal on load / mid-session).
      allLLMPauseTurnCount: chatMetadata.allLLMPauseTurnCount ?? 0,
      isManuallyRenamed: chatMetadata.isManuallyRenamed ?? false,
      updatedAt: chatMetadata.updatedAt,
      createdAt: chatMetadata.createdAt,
      participants: enrichedParticipants,
      user: { id: user.id, name: user.name, image: user.image },
      messages,
      // The counter that came back with this transcript. The Salon keeps it and
      // hands it to `?action=transcript` on the next realtime hint, which is how
      // an unchanged conversation is answered without being serialized again.
      transcriptVersion,
      projectId: chatMetadata.projectId || null,
      projectName,
      // The scene in force. Projected so the sidebar's scenario picker can open
      // on what the chat actually has rather than always on "Custom…".
      scenarioText: chatMetadata.scenarioText ?? null,
      disabledTools: chatMetadata.disabledTools || [],
      disabledToolGroups: chatMetadata.disabledToolGroups || [],
      allowCrossCharacterVaultReads: chatMetadata.allowCrossCharacterVaultReads ?? false,
      coreWhisperEnabled: chatMetadata.coreWhisperEnabled ?? null,
      coreWhisperInterval: chatMetadata.coreWhisperInterval ?? null,
      turnSkippingEnabled: chatMetadata.turnSkippingEnabled ?? null,
      // Controlled selects in chat settings — projected so the UI reflects the
      // saved value on reload instead of snapping back to its default.
      timelineMode: chatMetadata.timelineMode ?? null,
      alertCharactersOfLanternImages: chatMetadata.alertCharactersOfLanternImages ?? null,
      showThinking: chatMetadata.showThinking ?? null,
      answerConfirmationOverride: chatMetadata.answerConfirmationOverride ?? null,
      agentModeEnabled: chatMetadata.agentModeEnabled ?? false,
      resolvedAgentModeEnabled: resolvedAgentMode.enabled,
      agentModeSource: resolvedAgentMode.enabledSource,
      avatarGenerationEnabled: chatMetadata.avatarGenerationEnabled ?? null,
      isDangerousChat: chatMetadata.isDangerousChat ?? null,
      dangerCategories: chatMetadata.dangerCategories || [],
      conciergeState: getConciergeState(chatMetadata),
      conciergeSetBy: getConciergeProvenance(chatMetadata),
      conciergeReason: getConciergeReason(chatMetadata),
      conciergeRefusalCount: conciergeLedger.count,
      documentEditingMode: chatMetadata.documentEditingMode ?? false,
      documentMode: chatMetadata.documentMode || 'normal',
      dividerPosition: chatMetadata.dividerPosition ?? 45,
      terminalMode: chatMetadata.terminalMode || 'normal',
      activeTerminalSessionId: chatMetadata.activeTerminalSessionId ?? null,
      rightPaneVerticalSplit: chatMetadata.rightPaneVerticalSplit ?? 50,
      offSceneCharacters,
    };

    return NextResponse.json({ chat });
  } catch (error) {
    logger.error('[Chats v1] Error fetching chat', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch chat');
  }
}
