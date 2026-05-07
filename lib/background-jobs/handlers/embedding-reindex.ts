/**
 * Embedding Reindex All Job Handler
 *
 * Handles EMBEDDING_REINDEX_ALL background jobs — a full embedding swap.
 * Re-embeds everything in the system:
 * 1. Help docs (first priority — needed for help search)
 * 2. Character memories
 * 3. Conversation chunks (Scriptorium)
 *
 * This is triggered after:
 * - TF-IDF vocabulary refit (for BUILTIN provider)
 * - Embedding provider/model change
 * - Manual reindex from the UI
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import type { EmbeddingReindexAllPayload } from '../queue-service';
import { ensureProcessorRunning } from '../processor';
import { syncHelpDocs } from '@/lib/help/help-doc-sync';
import { getVectorStoreManager } from '@/lib/embedding/vector-store';

/** Max jobs per batch insert (SQLite variable limit is 999; stay well under). */
const BATCH_SIZE = 200;

/**
 * True if the stored embedding's length matches the active profile's target
 * dim. Treats null / undefined / empty as a mismatch so they get re-embedded.
 *
 * The repository deserializes Float32 BLOBs into number[] (or Float32Array
 * in some paths), so we use Array.length / typed-array.length without
 * touching byteLength.
 */
function embeddingMatchesDim(
  embedding: ArrayLike<number> | null | undefined,
  targetDim: number,
): boolean {
  if (!embedding) return false;
  return embedding.length === targetDim;
}

/**
 * Build a raw job record ready for batch insert.
 */
function buildJobRecord(
  userId: string,
  payload: Record<string, unknown>,
): Omit<BackgroundJob, 'id' | 'createdAt' | 'updatedAt'> {
  const now = new Date().toISOString();
  return {
    userId,
    type: 'EMBEDDING_GENERATE',
    status: 'PENDING',
    payload,
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    scheduledAt: now,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Handle an embedding reindex all job — full system-wide re-embedding
 */
export async function handleEmbeddingReindexAll(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as EmbeddingReindexAllPayload;
  const repos = getRepositories();
  const scope = payload.scope ?? 'all';

  logger.info('[EmbeddingReindexAll] Starting reindex', {
    context: 'handleEmbeddingReindexAll',
    jobId: job.id,
    profileId: payload.profileId,
    scope,
  });

  // Get the embedding profile
  const profile = await repos.embeddingProfiles.findById(payload.profileId);
  if (!profile) {
    throw new Error(`Embedding profile not found: ${payload.profileId}`);
  }

  // For partial scope, we need a target dim to compare against. Prefer the
  // Matryoshka truncation; fall back to the profile's raw dim. BUILTIN
  // profiles have neither and don't have a fixed-dim concept, so partial
  // scope is rejected for them.
  let mismatchedTargetDim: number | null = null;
  if (scope === 'mismatched-dim') {
    mismatchedTargetDim = profile.truncateToDimensions ?? profile.dimensions ?? null;
    if (!mismatchedTargetDim || mismatchedTargetDim <= 0) {
      throw new Error(
        `Cannot run mismatched-dim reindex: profile ${profile.id} has no truncateToDimensions or dimensions set. Use scope='all' instead.`,
      );
    }
  }

  // Drop the document mount chunk cache — partial scope still benefits from
  // a clean cache because some of the underlying chunk vectors may change.
  const { invalidateAll } = await import('@/lib/mount-index/mount-chunk-cache');
  invalidateAll();

  // For full scope only: cancel stale jobs, mark all statuses pending,
  // delete vector stores, and clear help-doc embeddings. None of those are
  // safe in partial scope because they would also wipe correctly-sized
  // entries that we want to keep.
  if (scope === 'all') {
    const cancelledCount = await repos.backgroundJobs.cancelByType('EMBEDDING_GENERATE');
    if (cancelledCount > 0) {
      logger.info('[EmbeddingReindexAll] Cancelled stale embedding jobs', {
        context: 'handleEmbeddingReindexAll',
        cancelledCount,
      });
    }

    const markedCount = await repos.embeddingStatus.markAllPendingByProfileId(payload.profileId);
  }

  // Collect all job records, then batch-insert them at the end.
  const jobRecords: Omit<BackgroundJob, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  let helpDocCount = 0;
  let memoryCount = 0;
  let chunkCount = 0;
  let helpDocsSkipped = 0;
  let memoriesSkipped = 0;
  let chunksSkipped = 0;

  // ============================================================================
  // Phase 1: Help docs (highest priority — embed first)
  // ============================================================================
  try {
    // Sync help docs from disk to DB first
    const syncResult = await syncHelpDocs();
    logger.info('[EmbeddingReindexAll] Help docs synced from disk', {
      context: 'handleEmbeddingReindexAll',
      created: syncResult.created,
      updated: syncResult.updated,
      unchanged: syncResult.unchanged,
      totalOnDisk: syncResult.totalOnDisk,
    });

    // Get all help docs and enqueue embeddings
    const allHelpDocs = await repos.helpDocs.findAll();

    // For full scope, clear all help-doc embeddings up front so the
    // re-embedding pass writes into a known-empty column. Partial scope
    // keeps any matching-dim rows so they don't briefly disappear from
    // help search.
    if (scope === 'all') {
      await repos.helpDocs.clearAllEmbeddings();
    }

    for (const doc of allHelpDocs) {
      if (scope === 'mismatched-dim' && embeddingMatchesDim(doc.embedding, mismatchedTargetDim!)) {
        helpDocsSkipped++;
        continue;
      }
      jobRecords.push(buildJobRecord(job.userId, {
        entityType: 'HELP_DOC',
        entityId: doc.id,
        profileId: payload.profileId,
      }));
      helpDocCount++;
    }
  } catch (error) {
    logger.error('[EmbeddingReindexAll] Failed to process help docs', {
      context: 'handleEmbeddingReindexAll',
      error: error instanceof Error ? error.message : String(error),
    });
    // Continue with memories and chunks even if help docs fail
  }

  // ============================================================================
  // Phase 2: Character memories
  // ============================================================================
  const characters = await repos.characters.findByUserId(job.userId);
  const vectorStoreManager = getVectorStoreManager();

  // Full scope: clear every character's vector index so the dimension
  // constraint resets (e.g. 1536 → 4096 model swap). Partial scope: leave
  // stores alone — the per-row update path on EMBEDDING_GENERATE will
  // overwrite the affected entries in place, and the migration's
  // realignVectorIndicesDimensions pass already nudged the meta dim.
  if (scope === 'all') {
    for (const character of characters) {
      await vectorStoreManager.deleteStore(character.id);
    }
  }

  for (const character of characters) {
    const characterMemories = await repos.memories.findByCharacterId(character.id);

    for (const memory of characterMemories) {
      if (scope === 'mismatched-dim' && embeddingMatchesDim(memory.embedding, mismatchedTargetDim!)) {
        memoriesSkipped++;
        continue;
      }
      jobRecords.push(buildJobRecord(job.userId, {
        entityType: 'MEMORY',
        entityId: memory.id,
        characterId: memory.characterId,
        profileId: payload.profileId,
      }));
      memoryCount++;
    }
  }

  // ============================================================================
  // Phase 3: Conversation chunks (Scriptorium)
  // ============================================================================
  try {
    const chats = await repos.chats.findByUserId(job.userId);

    for (const chat of chats) {
      const chunks = await repos.conversationChunks.findByChatId(chat.id);

      for (const chunk of chunks) {
        if (scope === 'mismatched-dim' && embeddingMatchesDim(chunk.embedding, mismatchedTargetDim!)) {
          chunksSkipped++;
          continue;
        }
        jobRecords.push(buildJobRecord(job.userId, {
          entityType: 'CONVERSATION_CHUNK',
          entityId: chunk.id,
          chatId: chat.id,
          profileId: payload.profileId,
        }));
        chunkCount++;
      }
    }
  } catch (error) {
    logger.error('[EmbeddingReindexAll] Failed to process conversation chunks', {
      context: 'handleEmbeddingReindexAll',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ============================================================================
  // Batch insert all jobs
  // ============================================================================
  const totalJobs = jobRecords.length;
  let inserted = 0;

  for (let i = 0; i < totalJobs; i += BATCH_SIZE) {
    const batch = jobRecords.slice(i, i + BATCH_SIZE);
    await repos.backgroundJobs.createBatch(batch);
    inserted += batch.length;

    if (inserted % 1000 === 0 || inserted === totalJobs) {
    }
  }

  // Start the processor now that all jobs are enqueued
  ensureProcessorRunning();

  logger.info('[EmbeddingReindexAll] Reindex jobs enqueued', {
    context: 'handleEmbeddingReindexAll',
    jobId: job.id,
    profileId: payload.profileId,
    scope,
    targetDim: mismatchedTargetDim,
    helpDocCount,
    memoryCount,
    chunkCount,
    helpDocsSkipped,
    memoriesSkipped,
    chunksSkipped,
    totalEnqueued: totalJobs,
  });
}
