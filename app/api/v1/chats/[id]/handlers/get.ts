/**
 * Chats API v1 - GET Handler
 *
 * GET /api/v1/chats/[id] - Get a specific chat
 * GET /api/v1/chats/[id]?action=export - Export chat (SillyTavern JSONL)
 * GET /api/v1/chats/[id]?action=export-markdown - Export chat as a Markdown transcript
 * GET /api/v1/chats/[id]?action=cost - Get cost breakdown
 * GET /api/v1/chats/[id]?action=get-avatars - Get avatar overrides for chat
 * GET /api/v1/chats/[id]?action=get-background - Get story background URL
 * GET /api/v1/chats/[id]?action=outfit - Get equipped outfit state
 * GET /api/v1/chats/[id]?action=gallery - List every image in the conversation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { getActionParam } from '@/lib/api/middleware/actions';
import { exportSTChatAsJSONL } from '@/lib/sillytavern/chat';
import { getChatCostBreakdown, getDetailedChatCostBreakdown } from '@/lib/services/cost-estimation.service';
import { enrichParticipantDetail, getCharacterDetail } from '@/lib/services/chat-enrichment.service';
import { renderMarkdownToHtml, canPreRenderMessage } from '@/lib/services/markdown-renderer.service';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError } from '@/lib/api/responses';
import { resolveAgentModeSetting } from '@/lib/services/chat-message/agent-mode-resolver.service';
import { reconcileTerminalSessionsForChat } from '@/lib/terminal/reconcile';
import { surfaceOperatorMailForChat } from '@/lib/post-office/surface-operator-mail';
import { maybeEnqueueColdChunkReembed } from '@/lib/scriptorium/cold-chunk-reembed';
import { projectChatTranscript } from '@/lib/chat/transcript-projection';
import { handleGetAvatars, handleGetState, handleGetOutfit, handleGetOutfitSummary, handleGetPhotoAlbums, handleGetGroupStores, handleAccessibleStores, handleGetMailbox, handleExportMarkdown } from '../actions';
import {
  getPhotoLinkSummaryBySha256,
  type PhotoLinkSummary,
} from '@/lib/photos/photo-link-summary';
import { getChatGallery } from '@/lib/photos/chat-gallery';
import type { RequestContext } from '@/lib/api/middleware';
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';

/**
 * GET handler for individual chat
 */
export async function handleGet(
  req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const action = getActionParam(req);

  // Handle export action
  if (action === 'export') {
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

  // Handle export-markdown action
  if (action === 'export-markdown') {
    return handleExportMarkdown(chatId, ctx);
  }

  // Handle get-avatars action
  if (action === 'get-avatars') {
    return handleGetAvatars(chatId, ctx);
  }

  // Handle get-state action
  if (action === 'get-state') {
    return handleGetState(chatId, ctx);
  }

  // Handle outfit action - return equipped outfit state
  if (action === 'outfit') {
    return handleGetOutfit(chatId, ctx);
  }

  // Handle outfit-summary action - equipped outfit with resolved item titles
  if (action === 'outfit-summary') {
    return handleGetOutfitSummary(chatId, ctx);
  }

  // Handle photo-albums action - resolve candidate save targets for an image
  if (action === 'photo-albums') {
    return handleGetPhotoAlbums(chatId, ctx);
  }

  // Handle group-stores action - document stores of groups the user persona belongs to
  if (action === 'group-stores') {
    return handleGetGroupStores(chatId, ctx);
  }

  // Handle mailbox action - letters in a player-character's Mail/ folder, for the
  // Compose Mail modal's "In reply to" dropdown.
  if (action === 'mailbox') {
    return handleGetMailbox(req, chatId, ctx);
  }

  // Handle accessible-stores action - document stores for the Open-Document
  // picker's right-column accordions. `?all=true` is the picker's "look
  // everywhere" mode (every enabled store, not just this chat's reach).
  if (action === 'accessible-stores') {
    const all = req.nextUrl.searchParams.get('all') === 'true';
    return handleAccessibleStores(chatId, ctx, { all });
  }

  // Handle get-background action - returns story background URL for the chat
  if (action === 'get-background') {
    try {
      const chat = await repos.chats.findById(chatId);
      if (!chat) {
        return notFound('Chat');
      }

      // Check if the chat has a story background image
      if (!chat.storyBackgroundImageId) {
        return NextResponse.json({ backgroundUrl: null, fileId: null, filename: null, sha256: null, linkSummary: null });
      }

      // Get the file info to build the URL
      const file = await repos.files.findById(chat.storyBackgroundImageId);
      if (!file) {
        logger.warn('[Chats v1] Story background file not found', {
          chatId,
          storyBackgroundImageId: chat.storyBackgroundImageId,
        });
        return NextResponse.json({ backgroundUrl: null, fileId: null, filename: null, sha256: null, linkSummary: null });
      }

      const backgroundUrl = getFilePath(file);
      const linkSummary = file.sha256
        ? await getPhotoLinkSummaryBySha256(file.sha256, repos)
        : null;
      return NextResponse.json({
        backgroundUrl,
        fileId: file.id,
        filename: file.originalFilename,
        sha256: file.sha256,
        linkSummary,
      });
    } catch (error) {
      logger.error('[Chats v1] Failed to get story background', { chatId }, error instanceof Error ? error : undefined);
      return serverError('Failed to get story background');
    }
  }

  // Handle gallery action — every image in the conversation, whatever made it.
  // The nine sources and their dedup live in `lib/photos/chat-gallery.ts`; this
  // route only answers with what the enumerator found.
  if (action === 'gallery') {
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

  // Handle cost action
  if (action === 'cost') {
    try {
      const chat = await repos.chats.findById(chatId);
      if (!chat) {
        return notFound('Chat');
      }

      const searchParams = req.nextUrl.searchParams;
      const detailed = searchParams.get('detailed') === 'true';

      const breakdown = detailed
        ? await getDetailedChatCostBreakdown(chatId, user.id)
        : await getChatCostBreakdown(chatId, user.id);return NextResponse.json(breakdown);
    } catch (error) {
      logger.error('[Chats v1] Failed to get cost breakdown', { chatId }, error instanceof Error ? error : undefined);
      return serverError('Failed to get cost breakdown');
    }
  }

  // Default: get chat
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
      transcriptVersion: chatMetadata.transcriptVersion ?? 0,
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
      conciergeOverride: chatMetadata.conciergeOverride ?? null,
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
