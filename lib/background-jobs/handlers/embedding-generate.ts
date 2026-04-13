/**
 * Embedding Generate Job Handler
 *
 * Handles EMBEDDING_GENERATE background jobs by generating an embedding
 * for a single entity (memory) using the configured embedding profile.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import { getCharacterVectorStore } from '@/lib/embedding/vector-store';
import { logger } from '@/lib/logger';
import type { EmbeddingGeneratePayload } from '../queue-service';

/**
 * Handle an embedding generate job
 */
export async function handleEmbeddingGenerate(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as EmbeddingGeneratePayload;
  const repos = getRepositories();

  // Route to entity-specific handler
  if (payload.entityType === 'HELP_DOC') {
    return handleHelpDocEmbedding(job, payload, repos);
  }

  if (payload.entityType === 'CONVERSATION_CHUNK') {
    return handleConversationChunkEmbedding(job, payload, repos);
  }

  if (payload.entityType !== 'MEMORY') {
    throw new Error(`Unsupported entity type: ${payload.entityType}`);
  }

  // Get the memory
  const memory = await repos.memories.findById(payload.entityId);
  if (!memory) {
    logger.warn('[EmbeddingGenerate] Memory not found', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      memoryId: payload.entityId,
    });
    // Mark status as failed
    await repos.embeddingStatus.markAsFailed(
      'MEMORY',
      payload.entityId,
      payload.profileId,
      'Memory not found'
    );
    return;
  }

  try {
    // Generate embedding using the specified profile
    const textToEmbed = `${memory.summary}\n\n${memory.content}`;
    const embeddingResult = await generateEmbeddingForUser(
      textToEmbed,
      job.userId,
      payload.profileId
    );

    // Update memory with embedding
    await repos.memories.updateForCharacter(
      memory.characterId,
      memory.id,
      { embedding: embeddingResult.embedding }
    );

    // Add to vector store
    const vectorStore = await getCharacterVectorStore(memory.characterId);
    if (vectorStore.hasVector(memory.id)) {
      await vectorStore.updateVector(memory.id, embeddingResult.embedding);
    } else {
      await vectorStore.addVector(memory.id, embeddingResult.embedding, {
        memoryId: memory.id,
        characterId: memory.characterId,
      });
    }
    await vectorStore.save();

    // Mark status as embedded
    await repos.embeddingStatus.markAsEmbedded(
      'MEMORY',
      payload.entityId,
      payload.profileId
    );

    logger.info('[EmbeddingGenerate] Embedding generated successfully', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      memoryId: memory.id,
      characterId: memory.characterId,
      dimensions: embeddingResult.dimensions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Mark status as failed
    await repos.embeddingStatus.markAsFailed(
      'MEMORY',
      payload.entityId,
      payload.profileId,
      errorMessage
    );

    logger.error('[EmbeddingGenerate] Failed to generate embedding', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      memoryId: payload.entityId,
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Handle embedding generation for a conversation chunk (Scriptorium)
 * Uses the same embedding infrastructure as memories but stores
 * the embedding directly on the chunk row (Float32 BLOB, same format).
 */
async function handleConversationChunkEmbedding(
  job: BackgroundJob,
  payload: EmbeddingGeneratePayload,
  repos: ReturnType<typeof getRepositories>
): Promise<void> {
  const chunk = await repos.conversationChunks.findById(payload.entityId);
  if (!chunk) {
    logger.warn('[EmbeddingGenerate] Conversation chunk not found', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: payload.entityId,
      chatId: payload.chatId,
    });
    return;
  }

  try {
    const embeddingResult = await generateEmbeddingForUser(
      chunk.content,
      job.userId,
      payload.profileId
    );

    // Store embedding directly on the chunk (same Float32 BLOB format as memories)
    await repos.conversationChunks.updateEmbedding(chunk.id, embeddingResult.embedding);

    await repos.embeddingStatus.markAsEmbedded(
      'CONVERSATION_CHUNK',
      payload.entityId,
      payload.profileId
    );

    logger.info('[EmbeddingGenerate] Conversation chunk embedding generated', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: chunk.id,
      chatId: payload.chatId,
      interchangeIndex: chunk.interchangeIndex,
      dimensions: embeddingResult.dimensions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await repos.embeddingStatus.markAsFailed(
      'CONVERSATION_CHUNK',
      payload.entityId,
      payload.profileId,
      errorMessage
    );

    logger.error('[EmbeddingGenerate] Failed to generate conversation chunk embedding', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: payload.entityId,
      chatId: payload.chatId,
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Handle embedding generation for a help document.
 * Uses the same embedding infrastructure as memories but stores
 * the embedding directly on the help doc row (Float32 BLOB, same format).
 */
async function handleHelpDocEmbedding(
  job: BackgroundJob,
  payload: EmbeddingGeneratePayload,
  repos: ReturnType<typeof getRepositories>
): Promise<void> {
  const doc = await repos.helpDocs.findById(payload.entityId);
  if (!doc) {
    logger.warn('[EmbeddingGenerate] Help doc not found', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      docId: payload.entityId,
    });
    await repos.embeddingStatus.markAsFailed(
      'HELP_DOC',
      payload.entityId,
      payload.profileId,
      'Help doc not found'
    );
    return;
  }

  try {
    const textToEmbed = `${doc.title}\n\n${doc.content}`;
    const embeddingResult = await generateEmbeddingForUser(
      textToEmbed,
      job.userId,
      payload.profileId
    );

    await repos.helpDocs.updateEmbedding(doc.id, embeddingResult.embedding);

    await repos.embeddingStatus.markAsEmbedded(
      'HELP_DOC',
      payload.entityId,
      payload.profileId
    );

    logger.info('[EmbeddingGenerate] Help doc embedding generated', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      docId: doc.id,
      title: doc.title,
      dimensions: embeddingResult.dimensions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await repos.embeddingStatus.markAsFailed(
      'HELP_DOC',
      payload.entityId,
      payload.profileId,
      errorMessage
    );

    logger.error('[EmbeddingGenerate] Failed to generate help doc embedding', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      docId: payload.entityId,
      error: errorMessage,
    });

    throw error;
  }
}
