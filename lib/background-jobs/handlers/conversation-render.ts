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

  // 3. Upsert interchange chunks
  const now = new Date().toISOString();
  for (const interchange of result.interchanges) {
    await repos.conversationChunks.upsert({
      chatId: payload.chatId,
      interchangeIndex: interchange.index,
      content: interchange.content,
      participantNames: interchange.participantNames,
      messageIds: interchange.messageIds,
    });
  }

  // 4. Enqueue embedding for interchanges (if embedding profile configured)
  // When fullReembed is true, embed ALL chunks; otherwise only the newest
  if (result.interchanges.length > 0) {
    try {
      // Default profile only — every vector in the instance must come from
      // the same profile. With no default marked, chunks wait for the
      // startup reconcile rather than embedding under an arbitrary one.
      const embeddingProfiles = await repos.embeddingProfiles.findAll();
      const defaultProfile = embeddingProfiles.find(p => p.isDefault);

      if (defaultProfile) {
        // Embed all chunks that don't already have embeddings,
        // or all chunks if fullReembed is requested
        let embeddedCount = 0;
        for (const interchange of result.interchanges) {
          const chunk = await repos.conversationChunks.findByInterchangeIndex(
            payload.chatId,
            interchange.index
          );

          if (chunk && (payload.fullReembed || !chunk.embedding)) {
            await enqueueEmbeddingGenerate(job.userId, {
              entityType: 'CONVERSATION_CHUNK',
              entityId: chunk.id,
              chatId: payload.chatId,
              profileId: defaultProfile.id,
            });
            embeddedCount++;
          }
        }
      } else {
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
