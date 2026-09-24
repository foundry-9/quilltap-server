/**
 * Embedding Generate Job Handler
 *
 * Handles EMBEDDING_GENERATE background jobs by generating an embedding
 * for a single entity (memory) using the configured embedding profile.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { EMBEDDING_MAX_CHARS, averageEmbeddings, generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import { getVectorStoreManager } from '@/lib/embedding/vector-store';
import { getVectorIndicesRepository } from '@/lib/database/repositories/vector-indices.repository';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';
import { buildHelpDocChunks, helpChunkEmbeddingText } from '@/lib/help/help-doc-chunking';
import { logger } from '@/lib/logger';
import type { EmbeddingGeneratePayload } from '../queue-service';

type EmbeddingEntityType = 'MEMORY' | 'CONVERSATION_CHUNK' | 'HELP_DOC' | 'MOUNT_CHUNK';

/**
 * Whether an embedding failure is deterministic — i.e. retrying the exact same
 * input will fail again. Such jobs should be marked failed and dropped, not
 * retried to DEAD. (Tens of thousands of DEAD EMBEDDING_GENERATE rows had
 * accumulated from exactly this: the same over-context / NaN / dimension-
 * mismatch inputs retried three times each, forever.) Transient errors
 * ("fetch failed", timeouts, connection resets) deliberately do NOT match, so
 * they still retry.
 */
function isPermanentEmbeddingError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('nan') ||
    m.includes('non-finite') ||
    m.includes('exceeds the context length') ||
    m.includes('maximum context length') ||
    m.includes('cannot embed empty input') ||
    m.includes('dimension mismatch')
  );
}

/**
 * Guard against content that can never be embedded successfully — either
 * empty/whitespace-only (which makes some models, notably Ollama's
 * qwen3-embedding, emit NaN vectors and 500) or oversize. Returns true if the
 * entity was skipped (and the caller should bail without throwing — we don't
 * want the queue to retry something deterministically unembeddable, which is
 * how tens of thousands of DEAD jobs accumulate). Returns false if the caller
 * should proceed with embedding.
 */
async function skipIfOversize(
  text: string,
  entityType: EmbeddingEntityType,
  payload: EmbeddingGeneratePayload,
  job: BackgroundJob,
  repos: ReturnType<typeof getRepositories>,
  extraLog: Record<string, unknown> = {}
): Promise<boolean> {
  // Empty/whitespace-only input is deterministically unembeddable and is a
  // known trigger for NaN embeddings on some providers. Skip without retry.
  if (text.trim().length === 0) {
    const reason = 'Empty input — nothing to embed';
    logger.warn('[EmbeddingGenerate] Skipping empty entity', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      entityType,
      entityId: payload.entityId,
      ...extraLog,
    });
    await repos.embeddingStatus.markAsFailed(
      entityType,
      payload.entityId,
      payload.profileId,
      reason,
      job.userId
    );
    return true;
  }

  if (text.length <= EMBEDDING_MAX_CHARS) return false;

  const reason = `Oversize: ${text.length} chars exceeds ${EMBEDDING_MAX_CHARS}-char cap`;
  logger.warn('[EmbeddingGenerate] Skipping oversize entity', {
    context: 'handleEmbeddingGenerate',
    jobId: job.id,
    entityType,
    entityId: payload.entityId,
    textLength: text.length,
    maxChars: EMBEDDING_MAX_CHARS,
    ...extraLog,
  });
  await repos.embeddingStatus.markAsFailed(
    entityType,
    payload.entityId,
    payload.profileId,
    reason,
    job.userId
  );
  return true;
}

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

  if (payload.entityType === 'MOUNT_CHUNK') {
    return handleMountChunkEmbedding(job, payload, repos);
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
      'Memory not found',
      job.userId
    );
    return;
  }

  try {
    // Generate embedding using the specified profile
    const textToEmbed = `${memory.summary}\n\n${memory.content}`;
    if (await skipIfOversize(textToEmbed, 'MEMORY', payload, job, repos, {
      memoryId: memory.id,
      characterId: memory.characterId,
    })) {
      return;
    }
    const embeddingResult = await generateEmbeddingForUser(
      textToEmbed,
      job.userId,
      payload.profileId,
      { priority: 'background' }
    );

    // Update memory with embedding
    await repos.memories.updateForCharacter(
      memory.characterId,
      memory.id,
      { embedding: embeddingResult.embedding }
    );

    // Write directly to the database instead of loading the full in-memory
    // vector store. Loading the store for a character with thousands of entries
    // (e.g. 12k+ vectors × 1536 dimensions) would consume hundreds of MB of
    // heap just to insert one row.
    const vectorRepo = getVectorIndicesRepository();
    const exists = await vectorRepo.entryExists(memory.id);
    if (exists) {
      await vectorRepo.updateEntryEmbedding(memory.id, embeddingResult.embedding);
    } else {
      await vectorRepo.addEntry({
        id: memory.id,
        characterId: memory.characterId,
        embedding: embeddingResult.embedding,
      });
    }
    await vectorRepo.saveMeta(memory.characterId, embeddingResult.dimensions);

    // Invalidate the cached in-memory store for this character so the next
    // search operation reloads fresh data from the database.
    getVectorStoreManager().unloadStore(memory.characterId);

    // Mark status as embedded
    await repos.embeddingStatus.markAsEmbedded(
      'MEMORY',
      payload.entityId,
      payload.profileId,
      job.userId
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
      errorMessage,
      job.userId
    );

    if (isPermanentEmbeddingError(errorMessage)) {
      logger.warn('[EmbeddingGenerate] Permanent embedding error — marked failed, skipping retry', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        memoryId: payload.entityId,
        error: errorMessage,
      });
      return;
    }

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
    if (await skipIfOversize(chunk.content, 'CONVERSATION_CHUNK', payload, job, repos, {
      chunkId: chunk.id,
      chatId: payload.chatId,
    })) {
      return;
    }
    const embeddingResult = await generateEmbeddingForUser(
      chunk.content,
      job.userId,
      payload.profileId,
      { priority: 'background' }
    );

    // Store embedding directly on the chunk (same Float32 BLOB format as memories)
    await repos.conversationChunks.updateEmbedding(chunk.id, embeddingResult.embedding);

    await repos.embeddingStatus.markAsEmbedded(
      'CONVERSATION_CHUNK',
      payload.entityId,
      payload.profileId,
      job.userId
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
      errorMessage,
      job.userId
    );

    if (isPermanentEmbeddingError(errorMessage)) {
      logger.warn('[EmbeddingGenerate] Permanent embedding error — marked failed, skipping retry', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        chunkId: payload.entityId,
        chatId: payload.chatId,
        error: errorMessage,
      });
      return;
    }

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

/** One section of a help doc as the embedding pass sees it. */
interface HelpDocSection {
  /** Stored chunk row id; absent for a slice made on the fly (no rows yet). */
  id?: string;
  chunkIndex: number;
  heading: string | null;
  content: string;
  embedding: Float32Array | null;
}

/**
 * Give every section of a help document a vector, and return them.
 *
 * Sections are the stored `help_doc_chunks` rows. When a doc has none yet (a
 * sync whose slicing has not landed), it is sliced here in memory so the
 * document still gets a vector; those slices are not persisted — the next sync
 * or backfill writes the rows.
 *
 * A stored vector is reused, which makes a retry cheap: rows are recreated with
 * null embeddings whenever the doc's content changes and a full reindex clears
 * them, so a populated vector is current for its text. A stored vector whose
 * width differs from a freshly generated one belongs to an earlier profile and
 * is re-embedded rather than averaged in.
 *
 * A single section's failure is logged and skipped; the rest still stand for
 * the document. If every section fails, the last error is thrown so the job's
 * permanent/transient handling decides what happens next.
 *
 * Vectors are collected in memory rather than re-read: in the job child the
 * `updateEmbedding` writes are buffered, and a read would not see them.
 */
async function embedHelpDocSections(
  job: BackgroundJob,
  payload: EmbeddingGeneratePayload,
  repos: ReturnType<typeof getRepositories>,
  doc: { id: string; title: string; content: string }
): Promise<{ vectors: Float32Array[]; embedded: number; reused: number; failed: number }> {
  const stored = await repos.helpDocChunks.findByDocId(doc.id);
  const sections: HelpDocSection[] = stored.length > 0
    ? stored.map(chunk => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      heading: chunk.heading ?? null,
      content: chunk.content,
      embedding: chunk.embedding && chunk.embedding.length > 0 ? chunk.embedding : null,
    }))
    : buildHelpDocChunks(doc.content).map(draft => ({ ...draft, embedding: null }));

  logger.debug('[EmbeddingGenerate] Embedding help doc sections', {
    context: 'handleEmbeddingGenerate',
    jobId: job.id,
    docId: doc.id,
    sections: sections.length,
    storedRows: stored.length,
  });

  let embedded = 0;
  let failed = 0;
  let lastError: unknown = null;

  const embedSection = async (section: HelpDocSection): Promise<void> => {
    const text = helpChunkEmbeddingText(doc.title, section.heading, section.content);
    if (text.trim().length === 0) {
      return;
    }
    try {
      const result = await generateEmbeddingForUser(
        text,
        job.userId,
        payload.profileId,
        { priority: 'background' }
      );
      section.embedding = result.embedding;
      if (section.id) {
        await repos.helpDocChunks.updateEmbedding(section.id, result.embedding);
      }
      embedded++;
    } catch (error) {
      failed++;
      lastError = error;
      section.embedding = null;
      logger.warn('[EmbeddingGenerate] Help doc section embedding failed — skipping section', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        docId: doc.id,
        chunkId: section.id,
        chunkIndex: section.chunkIndex,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const reusedAtStart = new Set(sections.filter(s => s.embedding));
  for (const section of sections) {
    if (!section.embedding) {
      await embedSection(section);
    }
  }

  // Settle on the current profile's width: that of any fresh vector, else of
  // the first reused one. Reused vectors of another width are re-embedded.
  const fresh = sections.find(s => s.embedding && !reusedAtStart.has(s));
  const width = (fresh ?? sections.find(s => s.embedding))?.embedding?.length;
  if (width !== undefined) {
    for (const section of sections) {
      if (section.embedding && section.embedding.length !== width) {
        reusedAtStart.delete(section);
        await embedSection(section);
      }
    }
  }

  const vectors = sections
    .map(s => s.embedding)
    .filter((v): v is Float32Array => !!v && v.length === width);

  if (vectors.length === 0 && lastError) {
    throw lastError;
  }

  return {
    vectors,
    embedded,
    reused: [...reusedAtStart].filter(s => s.embedding).length,
    failed,
  };
}

/**
 * Handle embedding generation for a help document.
 *
 * The document's own vector is the normalised mean of its section vectors
 * ({@link averageEmbeddings}), never an embedding of the whole text. A help
 * page can run past any provider's input ceiling — `chat-settings.md` passed
 * OpenAI's 8,192 tokens and was left with no vector at all, and so invisible
 * to `help_search` (bug 168) — while a section never can. Both vectors are
 * stored on the parent process's connection via the same buffered writes as
 * before (Float32 BLOB, same format as memories).
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
      'Help doc not found',
      job.userId
    );
    return;
  }

  try {
    const sections = await embedHelpDocSections(job, payload, repos, doc);
    const docEmbedding = averageEmbeddings(sections.vectors);

    if (!docEmbedding) {
      // No section had any text — the same deterministic dead end as an empty
      // memory, so it is marked failed without a retry.
      logger.warn('[EmbeddingGenerate] Skipping empty entity', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        entityType: 'HELP_DOC',
        entityId: doc.id,
        title: doc.title,
      });
      await repos.embeddingStatus.markAsFailed(
        'HELP_DOC',
        payload.entityId,
        payload.profileId,
        'Empty input — nothing to embed',
        job.userId
      );
      return;
    }

    await repos.helpDocs.updateEmbedding(doc.id, docEmbedding);

    await repos.embeddingStatus.markAsEmbedded(
      'HELP_DOC',
      payload.entityId,
      payload.profileId,
      job.userId
    );

    logger.info('[EmbeddingGenerate] Help doc embedding generated', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      docId: doc.id,
      title: doc.title,
      dimensions: docEmbedding.length,
      sectionsAveraged: sections.vectors.length,
      sectionsEmbedded: sections.embedded,
      sectionsReused: sections.reused,
      sectionsFailed: sections.failed,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await repos.embeddingStatus.markAsFailed(
      'HELP_DOC',
      payload.entityId,
      payload.profileId,
      errorMessage,
      job.userId
    );

    if (isPermanentEmbeddingError(errorMessage)) {
      logger.warn('[EmbeddingGenerate] Permanent embedding error — marked failed, skipping retry', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        docId: payload.entityId,
        error: errorMessage,
      });
      return;
    }

    logger.error('[EmbeddingGenerate] Failed to generate help doc embedding', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      docId: payload.entityId,
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Handle embedding generation for a document mount chunk.
 * Uses the same embedding infrastructure as conversation chunks but stores
 * the embedding on the mount chunk row in the mount index database.
 */
async function handleMountChunkEmbedding(
  job: BackgroundJob,
  payload: EmbeddingGeneratePayload,
  repos: ReturnType<typeof getRepositories>
): Promise<void> {
  const chunk = await repos.docMountChunks.findById(payload.entityId);
  if (!chunk) {
    logger.warn('[EmbeddingGenerate] Mount chunk not found', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: payload.entityId,
    });
    await repos.embeddingStatus.markAsFailed(
      'MOUNT_CHUNK',
      payload.entityId,
      payload.profileId,
      'Mount chunk not found',
      job.userId
    );
    return;
  }

  try {
    if (await skipIfOversize(chunk.content, 'MOUNT_CHUNK', payload, job, repos, {
      chunkId: chunk.id,
      mountPointId: chunk.mountPointId,
    })) {
      return;
    }
    const embeddingResult = await generateEmbeddingForUser(
      chunk.content,
      job.userId,
      payload.profileId,
      { priority: 'background' }
    );

    await repos.docMountChunks.updateEmbedding(chunk.id, embeddingResult.embedding);

    // Invalidate the in-memory cache for this mount point so the next
    // document search reloads fresh chunks.
    invalidateMountPoint(chunk.mountPointId);

    await repos.embeddingStatus.markAsEmbedded(
      'MOUNT_CHUNK',
      payload.entityId,
      payload.profileId,
      job.userId
    );

    logger.info('[EmbeddingGenerate] Mount chunk embedding generated', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: chunk.id,
      mountPointId: chunk.mountPointId,
      dimensions: embeddingResult.dimensions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await repos.embeddingStatus.markAsFailed(
      'MOUNT_CHUNK',
      payload.entityId,
      payload.profileId,
      errorMessage,
      job.userId
    );

    if (isPermanentEmbeddingError(errorMessage)) {
      logger.warn('[EmbeddingGenerate] Permanent embedding error — marked failed, skipping retry', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        chunkId: payload.entityId,
        error: errorMessage,
      });
      return;
    }

    logger.error('[EmbeddingGenerate] Failed to generate mount chunk embedding', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: payload.entityId,
      error: errorMessage,
    });

    throw error;
  }
}
