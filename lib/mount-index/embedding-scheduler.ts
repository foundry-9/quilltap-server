/**
 * Mount Index Embedding Scheduler
 *
 * Enqueues EMBEDDING_GENERATE background jobs for document mount chunks
 * that don't yet have embeddings. Uses the same embedding infrastructure
 * as memories and conversation chunks.
 *
 * @module mount-index/embedding-scheduler
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueEmbeddingGenerate } from '@/lib/background-jobs/queue-service';

const logger = createServiceLogger('MountIndex:EmbeddingScheduler');

/**
 * Enqueue embedding jobs for all un-embedded chunks in a mount point.
 *
 * Finds all chunks without embeddings, determines the user's default
 * embedding profile, and enqueues an EMBEDDING_GENERATE job for each.
 *
 * @param mountPointId - The mount point whose chunks need embedding
 */
export async function enqueueEmbeddingJobsForMountPoint(mountPointId: string): Promise<number> {
  const repos = getRepositories();

  // Find chunks without embeddings for this mount point
  const allChunks = await repos.docMountChunks.findByMountPointId(mountPointId);
  const unembeddedChunks = allChunks.filter(
    chunk => !chunk.embedding || !Array.isArray(chunk.embedding) || chunk.embedding.length === 0
  );

  if (unembeddedChunks.length === 0) {
    logger.debug('No un-embedded chunks to process', { mountPointId });
    return 0;
  }

  // Get the user's default embedding profile
  const profiles = await repos.embeddingProfiles.findAll();
  const defaultProfile = profiles.find(p => p.isDefault) || profiles[0];

  if (!defaultProfile) {
    logger.warn('No embedding profile configured, skipping mount chunk embedding', {
      mountPointId,
      unembeddedCount: unembeddedChunks.length,
    });
    return 0;
  }

  // Get the user ID (single-user system — use the first user)
  const users = await repos.users.findAll();
  const userId = users[0]?.id;

  if (!userId) {
    logger.warn('No user found, skipping mount chunk embedding', { mountPointId });
    return 0;
  }

  logger.info('Enqueuing embedding jobs for mount chunks', {
    mountPointId,
    chunkCount: unembeddedChunks.length,
    profileId: defaultProfile.id,
    profileName: defaultProfile.name,
  });

  let enqueued = 0;

  for (const chunk of unembeddedChunks) {
    try {
      const result = await enqueueEmbeddingGenerate(userId, {
        entityType: 'MOUNT_CHUNK',
        entityId: chunk.id,
        profileId: defaultProfile.id,
      });

      if (result.isNew) {
        enqueued++;
      }
    } catch (error) {
      logger.warn('Failed to enqueue embedding job for mount chunk', {
        chunkId: chunk.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Embedding job enqueueing complete', {
    mountPointId,
    totalChunks: unembeddedChunks.length,
    enqueued,
  });

  return enqueued;
}
