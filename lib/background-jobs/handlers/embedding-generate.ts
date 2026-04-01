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

  // Currently only MEMORY is supported
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
        content: memory.summary,
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
