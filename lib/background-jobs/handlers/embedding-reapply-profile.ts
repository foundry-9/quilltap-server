/**
 * Embedding Re-apply Profile Job Handler
 *
 * Walks every embedding-bearing table in the system and rewrites stored
 * Float32 BLOBs to match the active profile's `truncateToDimensions` and
 * `normalizeL2` settings. Pure local rewrite — never calls a provider.
 *
 * Use case: the user shrunk a Matryoshka profile from 4096d → 1024d and
 * wants the existing corpus brought into compliance without re-embedding.
 *
 * @module background-jobs/handlers/embedding-reapply-profile
 */

import { BackgroundJob } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { reapplyEmbeddingProfile } from '@/lib/embedding/reapply-profile'
import type { EmbeddingReapplyProfilePayload } from '../queue-service'

export async function handleEmbeddingReapplyProfile(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as EmbeddingReapplyProfilePayload
  const repos = getRepositories()

  logger.info('[EmbeddingReapplyProfile] Starting', {
    jobId: job.id,
    profileId: payload.profileId,
  })

  const profile = await repos.embeddingProfiles.findById(payload.profileId)
  if (!profile) {
    throw new Error(`Embedding profile not found: ${payload.profileId}`)
  }

  if (!profile.truncateToDimensions) {
    logger.info('[EmbeddingReapplyProfile] Profile has no truncateToDimensions; nothing to do', {
      profileId: profile.id,
    })
    return
  }

  const result = await reapplyEmbeddingProfile(profile)

  logger.info('[EmbeddingReapplyProfile] Completed', {
    jobId: job.id,
    profileId: profile.id,
    targetDimensions: result.targetDimensions,
    totalTruncated: result.totalTruncated,
    durationMs: result.durationMs,
    backupPath: result.backupPath,
    mountBackupPath: result.mountBackupPath,
    perTable: result.perTable,
  })
}
