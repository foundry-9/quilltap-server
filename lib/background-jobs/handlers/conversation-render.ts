/**
 * Conversation Render Job Handler (Scriptorium)
 *
 * Handles CONVERSATION_RENDER background jobs by deterministically rendering
 * a chat conversation to Markdown and storing its interchange chunks for
 * embedding. The Markdown itself is not persisted; see render-chat.ts.
 * No LLM involvement - pure template-based rendering.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { renderChatConversation } from '@/lib/scriptorium/render-chat';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { enqueueEmbeddingGenerate } from '../queue-service';
import type { ConversationRenderPayload } from '../queue-service';

const logger = createServiceLogger('ConversationRenderHandler');

export async function handleConversationRender(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as ConversationRenderPayload;
  const repos = getRepositories();
  const startTime = Date.now();

  // 1. Load chat
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    logger.warn('[ConversationRender] Chat not found, skipping', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  // 2. Render from the stored messages. The Markdown itself is not kept — it
  //    is re-rendered on demand (lib/scriptorium/render-chat.ts); only the
  //    interchange chunks are stored, for embedding and search.
  const result = await renderChatConversation(chat);
  if (!result) {
    logger.debug('[ConversationRender] Chat has no events, nothing to render', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  // 3. Upsert interchange chunks, deciding which need an embedding from what
  //    each chunk was BEFORE the write. This handler runs in the job child,
  //    where writes are buffered until the job ends: a read after the upsert
  //    still sees the committed row — the old vector the upsert is about to
  //    clear, and no row at all for a new chunk — so a changed or new chunk
  //    was never queued and waited for the chat's next render or a reboot
  //    (bug 248). The id comes from the existing row, or for a new chunk from
  //    the upsert's result, which the repository keeps as the row's id.
  const toEmbed: string[] = [];
  for (const interchange of result.interchanges) {
    const existing = await repos.conversationChunks.findByInterchangeIndex(
      payload.chatId,
      interchange.index
    );
    const upserted = await repos.conversationChunks.upsert({
      chatId: payload.chatId,
      interchangeIndex: interchange.index,
      content: interchange.content,
      participantNames: interchange.participantNames,
      messageIds: interchange.messageIds,
    });

    const needsEmbedding =
      payload.fullReembed ||
      !existing ||
      !existing.embedding ||
      existing.content !== interchange.content;
    const chunkId = existing?.id ?? upserted?.id;
    if (needsEmbedding && chunkId) {
      toEmbed.push(chunkId);
    }
  }

  logger.debug('[ConversationRender] Chunks upserted', {
    jobId: job.id,
    chatId: payload.chatId,
    interchangeCount: result.interchanges.length,
    needingEmbedding: toEmbed.length,
    fullReembed: !!payload.fullReembed,
  });

  // 4. Enqueue embedding for the chunks that need one (if an embedding
  //    profile is configured). When fullReembed is true, that is all of them.
  if (toEmbed.length > 0) {
    try {
      // Default profile only — every vector in the instance must come from
      // the same profile. With no default marked, chunks wait for the
      // startup reconcile rather than embedding under an arbitrary one.
      const embeddingProfiles = await repos.embeddingProfiles.findAll();
      const defaultProfile = embeddingProfiles.find(p => p.isDefault);

      if (defaultProfile) {
        for (const chunkId of toEmbed) {
          await enqueueEmbeddingGenerate(job.userId, {
            entityType: 'CONVERSATION_CHUNK',
            entityId: chunkId,
            chatId: payload.chatId,
            profileId: defaultProfile.id,
          });
        }
      } else {
        logger.debug('[ConversationRender] No default embedding profile; chunks left for the startup reconcile', {
          jobId: job.id,
          chatId: payload.chatId,
          pending: toEmbed.length,
        });
      }
    } catch (error) {
      // Don't fail the render job if embedding enqueue fails
      logger.warn('[ConversationRender] Failed to enqueue embedding, continuing', {
        jobId: job.id,
        chatId: payload.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info('[ConversationRender] Conversation rendered successfully', {
    jobId: job.id,
    chatId: payload.chatId,
    interchangeCount: result.interchanges.length,
    markdownLength: result.markdown.length,
    durationMs,
  });
}
