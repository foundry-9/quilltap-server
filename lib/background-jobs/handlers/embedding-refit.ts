/**
 * Embedding Refit Job Handler
 *
 * Handles EMBEDDING_REFIT background jobs by rebuilding the TF-IDF vocabulary
 * from all memories. This is needed when:
 * - A new BUILTIN embedding profile is created
 * - Memories are added/updated/deleted (debounced)
 * - User manually triggers a refit
 *
 * After refit, triggers EMBEDDING_REINDEX_ALL to re-embed all memories.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import type { EmbeddingRefitPayload } from '../queue-service';
import { enqueueEmbeddingReindexAll } from '../queue-service';

// Import the TF-IDF vectorizer from the plugin
// We dynamically require the plugin to avoid circular dependencies
async function getTfIdfVectorizer(): Promise<any> {
  try {
    // Try to load the plugin directly
    const plugin = await import('@/plugins/dist/qtap-plugin-builtin-embeddings');
    return plugin.TfIdfVectorizer;
  } catch (error) {
    logger.error('[EmbeddingRefit] Failed to load TF-IDF vectorizer', {
      context: 'getTfIdfVectorizer',
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Built-in embedding plugin not available');
  }
}

/**
 * Handle an embedding refit job
 */
export async function handleEmbeddingRefit(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as EmbeddingRefitPayload;
  const repos = getRepositories();

  logger.info('[EmbeddingRefit] Starting vocabulary refit', {
    context: 'handleEmbeddingRefit',
    jobId: job.id,
    profileId: payload.profileId,
  });

  // Get the embedding profile
  const profile = await repos.embeddingProfiles.findById(payload.profileId);
  if (!profile) {
    throw new Error(`Embedding profile not found: ${payload.profileId}`);
  }

  // Verify this is a BUILTIN profile
  if (profile.provider !== 'BUILTIN') {
    logger.warn('[EmbeddingRefit] Profile is not BUILTIN, skipping refit', {
      context: 'handleEmbeddingRefit',
      jobId: job.id,
      profileId: payload.profileId,
      provider: profile.provider,
    });
    return;
  }

  // Get all characters for this user
  const characters = await repos.characters.findByUserId(job.userId);

  if (characters.length === 0) {
    logger.info('[EmbeddingRefit] No characters found, skipping refit', {
      context: 'handleEmbeddingRefit',
      jobId: job.id,
      profileId: payload.profileId,
    });
    return;
  }

  // Get all memories for all characters
  const allMemories: import('@/lib/schemas/types').Memory[] = [];
  for (const character of characters) {
    const characterMemories = await repos.memories.findByCharacterId(character.id);
    allMemories.push(...characterMemories);
  }

  if (allMemories.length === 0) {
    logger.info('[EmbeddingRefit] No memories found, skipping refit', {
      context: 'handleEmbeddingRefit',
      jobId: job.id,
      profileId: payload.profileId,
    });
    return;
  }

  // Prepare documents for TF-IDF fitting
  const documents = allMemories.map(m => `${m.summary}\n\n${m.content}`);

  // Include help docs in the corpus for better vocabulary coverage
  try {
    const helpDocs = await repos.helpDocs.findAll();
    for (const doc of helpDocs) {
      documents.push(`${doc.title}\n\n${doc.content}`);
    }
  } catch (error) {
    logger.warn('[EmbeddingRefit] Failed to load help docs for corpus, continuing without them', {
      context: 'handleEmbeddingRefit',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Get TF-IDF vectorizer
  const TfIdfVectorizer = await getTfIdfVectorizer();
  const vectorizer = new TfIdfVectorizer(true); // Include bigrams

  // Fit the vocabulary on the corpus
  vectorizer.fitCorpus(documents);

  // Get the state for persistence
  const state = vectorizer.getState();
  if (!state) {
    throw new Error('Failed to get TF-IDF state after fitting');
  }

  // Save the vocabulary to the database
  await repos.tfidfVocabularies.upsertByProfileId(payload.profileId, {
    profileId: payload.profileId,
    userId: job.userId,
    vocabulary: JSON.stringify(state.vocabulary),
    idf: JSON.stringify(state.idf),
    avgDocLength: state.avgDocLength,
    vocabularySize: state.vocabularySize,
    includeBigrams: state.includeBigrams,
    fittedAt: state.fittedAt,
  });

  logger.info('[EmbeddingRefit] Vocabulary fitted and saved', {
    context: 'handleEmbeddingRefit',
    jobId: job.id,
    profileId: payload.profileId,
    vocabularySize: state.vocabularySize,
    documentCount: documents.length,
    avgDocLength: state.avgDocLength.toFixed(2),
  });

  // Trigger reindex if requested
  if (payload.triggerReindex !== false) {
    await enqueueEmbeddingReindexAll(job.userId, { profileId: payload.profileId });

    logger.info('[EmbeddingRefit] Enqueued reindex job', {
      context: 'handleEmbeddingRefit',
      jobId: job.id,
      profileId: payload.profileId,
    });
  }
}
