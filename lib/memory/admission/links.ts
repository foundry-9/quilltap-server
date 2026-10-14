/**
 * Links between memories, written as deltas.
 *
 * Dependency-light (repositories and the logger only), so the episode pass and
 * tests can use it without loading the rest of admission.
 *
 * @module memory/admission/links
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

/**
 * Link one memory and others both ways, as deltas against the rows at write
 * time (bug 231). Admission's insert-linked and the episode pass's fragment
 * links use it. Returns the memory's link list as written.
 */
export async function linkBothWays(characterId: string, memoryId: string, linkTo: readonly string[]): Promise<string[]> {
  const repos = getRepositories()
  const targets = linkTo.filter((id) => id !== memoryId)
  for (const id of targets) {
    await repos.memories.addRelatedMemoryIds(characterId, id, [memoryId])
  }
  const written = targets.length > 0 ? await repos.memories.addRelatedMemoryIds(characterId, memoryId, targets) : []
  logger.debug('[Admission] Linked memory to neighbours both ways', { characterId, memoryId, linked: targets.length })
  return written ?? targets
}
