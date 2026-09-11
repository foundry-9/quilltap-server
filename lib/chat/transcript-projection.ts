/**
 * Chat transcript projection
 *
 * The one place a stored chat transcript is turned into the rows the Salon
 * renders: attachments resolved (uploaded files *and* Scriptorium mount files),
 * simple messages pre-rendered to HTML under the chat's roleplay template and
 * typography settings, and the off-scene character cards an announcement or a
 * Carina answer needs in order to draw an avatar for someone who isn't a
 * participant.
 *
 * It has two readers and must have exactly one implementation:
 *
 *   - `GET /api/v1/chats/[id]`, which embeds the whole transcript in the chat
 *     object the Salon loads at mount;
 *   - `GET /api/v1/messages?chatId=…&action=transcript`, the conditional
 *     re-read a realtime `chats` hint drives.
 *
 * A second serialization of a message is the drift this module exists to
 * prevent — the same reasoning that keeps message bodies off the realtime
 * socket (see `docs/developer/features/complete/realtime-updates.md`,
 * decision 1). Change the shape here and both readers change together.
 *
 * @module lib/chat/transcript-projection
 */

import { getFilePath } from '@/lib/api/middleware/file-path';
import { getCharacterDetail } from '@/lib/services/chat-enrichment.service';
import { renderMarkdownToHtml, canPreRenderMessage } from '@/lib/services/markdown-renderer.service';
import { logger } from '@/lib/logger';
import { BRAHMA_CARINA_ANSWERER_ID } from '@/lib/services/carina/brahma-answerer';
import {
  getPhotoLinkSummaryBySha256,
  type PhotoLinkSummary,
} from '@/lib/photos/photo-link-summary';
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';
import type { ChatEvent, ChatMetadata } from '@/lib/schemas/types';
import type { RepositoryContainer } from '@/lib/repositories/factory';

/** An off-scene character referenced by a bubble whose author is not a participant. */
export interface OffSceneCharacter {
  id: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
}

/**
 * Everything a Salon transcript read returns beyond the chat row itself:
 * display rows in stored order (the Salon collapses swipe groups client-side)
 * and the avatar/name cards for authors who aren't participants.
 *
 * Inferred rather than restated, so the projected message shape has exactly one
 * definition — the object literal below — and cannot drift from its type.
 */
export type ProjectedTranscript = Awaited<ReturnType<typeof projectChatTranscript>>;

/**
 * Project a chat's stored events into the transcript the Salon renders.
 *
 * @param chatId The chat to read.
 * @param chatMetadata The chat row, already loaded and ownership-checked.
 * @param repos The request's repository container.
 * @param userId The owner, whose chat settings decide display typography.
 */
export async function projectChatTranscript(
  chatId: string,
  chatMetadata: ChatMetadata,
  repos: RepositoryContainer,
  userId: string,
) {
  logger.debug('[Transcript] Projecting chat transcript', { chatId });

  // Get roleplay template for rendering patterns
  let renderingPatterns: RenderingPattern[] | undefined;
  let dialogueDetection: DialogueDetection | null | undefined;

  if (chatMetadata.roleplayTemplateId) {
    const template = await repos.roleplayTemplates.findById(chatMetadata.roleplayTemplateId);
    if (template) {
      renderingPatterns = template.renderingPatterns;
      dialogueDetection = template.dialogueDetection;
    }
  }

  // Smart typography, Part A: whether pre-rendered HTML gets curly quotes.
  // Display only — `event.content` below is still the writer's straight-quoted
  // text, which is what goes to the model, the embeddings and every export.
  // The client renderer (MessageContent) reads the same setting for messages
  // it renders itself, so streaming and settled output agree.
  const preRenderSettings = await repos.chatSettings.findByUserId(userId);
  const displayQuotes = preRenderSettings?.smartTypographySettings?.displayQuotes ?? false;

  const chatEvents: ChatEvent[] = await repos.chats.getMessages(chatId);

  const messagesWithEmbeddedTools = new Set<string>();

  // Tool messages initiated by character get embedded in the preceding ASSISTANT message
  // Tool messages initiated by user get embedded in the following USER message
  // For simplicity, we'll skip pre-rendering for messages adjacent to TOOL messages
  const messageEvents = chatEvents.filter((event) => event.type === 'message');
  for (let i = 0; i < messageEvents.length; i++) {
    const event = messageEvents[i];
    if (event.type === 'message' && event.role === 'TOOL') {
      // Mark adjacent messages as having embedded tools
      if (i > 0) {
        const prevEvent = messageEvents[i - 1];
        if (prevEvent.type === 'message') {
          messagesWithEmbeddedTools.add(prevEvent.id);
        }
      }
      if (i < messageEvents.length - 1) {
        const nextEvent = messageEvents[i + 1];
        if (nextEvent.type === 'message') {
          messagesWithEmbeddedTools.add(nextEvent.id);
        }
      }
    }
  }

  const messages = await Promise.all(
    chatEvents
      .filter((event) => event.type === 'message')
      .map(async (event) => {
        if (event.type !== 'message') return null;

        const linkedFiles = await repos.files.findByLinkedTo(event.id);
        // Surface sha256 + linkSummary for every image attachment so the
        // Salon UI can offer "save to my gallery" affordances and show
        // a count of where the bytes are hard-linked elsewhere. Non-image
        // attachments skip the summary lookup to keep the response light.
        const attachments: Array<{
          id: string;
          filename: string;
          filepath: string;
          mimeType: string;
          sha256?: string;
          linkSummary?: PhotoLinkSummary;
        }> = await Promise.all(
          linkedFiles.map(async (file) => {
            const base = {
              id: file.id,
              filename: file.originalFilename,
              filepath: getFilePath(file),
              mimeType: file.mimeType,
            };
            if (!file.mimeType.startsWith('image/')) return base;
            return {
              ...base,
              sha256: file.sha256,
              linkSummary: await getPhotoLinkSummaryBySha256(file.sha256, repos),
            };
          })
        );

        // Mount-file attachments (Scriptorium documents pinned to a chat
        // via a Librarian announcement) live entirely in event.attachments
        // — there's no linkedTo entry for them. Resolve any ids that the
        // legacy lookup didn't cover by probing doc_mount_files.
        const eventAttachmentIds = Array.isArray(event.attachments) ? event.attachments : [];
        const alreadyResolved = new Set(attachments.map((a) => a.id));
        for (const attachmentId of eventAttachmentIds) {
          if (alreadyResolved.has(attachmentId)) continue;
          try {
            let mountLink = await repos.docMountFileLinks.findByIdWithContent(attachmentId);
            if (!mountLink) {
              const links = await repos.docMountFileLinks.findByFileId(attachmentId);
              mountLink = links[0] ?? null;
            }
            if (!mountLink) continue;
            const blob = await repos.docMountBlobs.findByFileId(mountLink.fileId);
            if (!blob) continue;
            const url = `/api/v1/mount-points/${mountLink.mountPointId}/blobs/${encodeURI(mountLink.relativePath)}`;
            const isImage = blob.storedMimeType.startsWith('image/');
            attachments.push({
              id: mountLink.id,
              filename: mountLink.originalFileName ?? mountLink.fileName,
              filepath: url,
              mimeType: blob.storedMimeType,
              ...(isImage && mountLink.sha256
                ? {
                    sha256: mountLink.sha256,
                    linkSummary: await getPhotoLinkSummaryBySha256(mountLink.sha256, repos),
                  }
                : {}),
            });
            alreadyResolved.add(mountLink.id);
          } catch (err) {
            logger.warn('[Chats v1] Failed to resolve mount-file attachment', {
              messageId: event.id,
              attachmentId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Determine if this message can be pre-rendered
        const hasAttachments = attachments.length > 0;
        const hasEmbeddedTool = messagesWithEmbeddedTools.has(event.id);
        const canPreRender = canPreRenderMessage(event.role, hasAttachments, hasEmbeddedTool);

        // Pre-render simple messages to HTML
        let renderedHtml: string | null = null;
        if (canPreRender) {
          try {
            renderedHtml = await renderMarkdownToHtml(event.content, {
              renderingPatterns,
              dialogueDetection,
              displayQuotes,
            });
          } catch (err) {
            // Log but don't fail - client can still render
            logger.warn('[Chats v1] Failed to pre-render message', {
              messageId: event.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        return {
          id: event.id,
          role: event.role,
          content: event.content,
          tokenCount: event.tokenCount || null,
          promptTokens: event.promptTokens || null,
          completionTokens: event.completionTokens || null,
          createdAt: event.createdAt,
          swipeGroupId: event.swipeGroupId || null,
          swipeIndex: event.swipeIndex || null,
          participantId: event.participantId || null,
          attachments,
          debugMemoryLogs: event.debugMemoryLogs || undefined,
          renderedHtml,
          provider: event.provider || null,
          modelName: event.modelName || null,
          // The turn's call sheet — every profile tried, in order. Null on
          // nearly every message (nothing failed), in which case the Salon
          // renders the plain provider/model badge exactly as before.
          routeTrail: event.routeTrail || null,
          targetParticipantIds: event.targetParticipantIds || null,
          isSilentMessage: event.isSilentMessage || null,
          systemSender: event.systemSender || null,
          systemKind: event.systemKind || null,
          // Host structured payload — projected so the client can reconstruct
          // turn-pass records (hostEvent.participantId) for the Skip-button guard.
          hostEvent: event.hostEvent || null,
          customAnnouncer: event.customAnnouncer || null,
          carinaMeta: event.carinaMeta || null,
          pascalMeta: event.pascalMeta || null,
          pendingExternalPrompt: event.pendingExternalPrompt || null,
          pendingExternalPromptFull: event.pendingExternalPromptFull || null,
          pendingExternalAttachments: event.pendingExternalAttachments || null,
          // Reasoning ("thinking") for DISPLAY ONLY — surfaced so the Salon can
          // render the collapsible thinking block on reload. Never re-fed to a model.
          reasoningContent: event.reasoningContent || null,
          reasoningSegments: event.reasoningSegments || null,
          // Answer-confirmation verdict — drives the badge on reload. `confirmed`
          // may be false/null (both meaningful), so preserve the tri-state
          // explicitly instead of `|| null`; undefined = no check ran.
          confirmed: event.confirmed ?? undefined,
          confirmationChecked: event.confirmationChecked ?? undefined,
          confirmationRevised: event.confirmationRevised ?? undefined,
          confirmationNotes: event.confirmationNotes ?? null,
          confirmationOriginalContent: event.confirmationOriginalContent ?? null,
        };
      })
  ).then((results) => results.filter(Boolean));

  // Resolve off-scene character cards referenced by ad-hoc announcement
  // bubbles (customAnnouncer.kind === 'character'). The Salon renderer looks
  // these up by id to render the bubble's avatar/name; the chat's
  // `participants` array doesn't include them since they aren't participants.
  const offSceneCharacterIds = new Set<string>();
  const participantCharacterIds = new Set(
    chatMetadata.participants
      .map((p) => p.characterId)
      .filter((id): id is string => typeof id === 'string'),
  );
  for (const m of messages) {
    const id = m?.customAnnouncer?.characterId;
    if (typeof id === 'string' && !participantCharacterIds.has(id)) {
      offSceneCharacterIds.add(id);
    }
    // Carina (inline LLM queries): a reference answer renders with the
    // answerer character's own avatar. When the answerer isn't a participant,
    // collect them here so the Salon can resolve their avatar/name. The Brahma
    // Console pseudocharacter (reserved sentinel id) has no character record —
    // skip it so we don't fire a guaranteed-miss lookup per Brahma message.
    const carinaAnswererId = m?.carinaMeta?.answererId;
    if (
      typeof carinaAnswererId === 'string' &&
      carinaAnswererId !== BRAHMA_CARINA_ANSWERER_ID &&
      !participantCharacterIds.has(carinaAnswererId)
    ) {
      offSceneCharacterIds.add(carinaAnswererId);
    }
  }
  const offSceneCharacters: OffSceneCharacter[] = [];
  for (const charId of offSceneCharacterIds) {
    try {
      // Use getCharacterDetail so avatarUrl resolves through avatarOverrides /
      // defaultImageId — characters whose avatar is stored as a defaultImage
      // (not a raw avatarUrl) still render correctly in announcement bubbles.
      const detail = await getCharacterDetail(charId, repos, chatId);
      if (detail) {
        offSceneCharacters.push({
          id: detail.id,
          name: detail.name,
          title: detail.title,
          avatarUrl: detail.avatarUrl,
        });
      }
    } catch {
      // Character may have been deleted; skip and let the renderer fall back.
    }
  }

  logger.debug('[Transcript] Projected chat transcript', {
    chatId,
    messages: messages.length,
    offSceneCharacters: offSceneCharacters.length,
  });

  return { messages, offSceneCharacters };
}
