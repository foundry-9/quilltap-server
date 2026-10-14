/**
 * Scenario Builder mount pool — "what this chat could see", before the chat exists.
 *
 * The Scenario Builder runs a character-less tool loop that must read exactly
 * the stores a chat with this cast (and project) would reach: every cast
 * member's vault, the union of every cast member's group stores, the project's
 * stores, and Quilltap General. Launched from a group's page, the run also
 * names that group outright (`groupIds`), whose stores join the group tier
 * whether or not any cast member belongs to it. `resolveTieredMountPool` cannot express that —
 * its group tier is keyed on a single responding character — so the pool is
 * assembled here by hand from the same per-tier helpers, in precedence order,
 * and deduped with the same rule (`dedupeTierTriple`).
 *
 * The cast vaults sit in the `participant` tier; there is no acting character,
 * so `characterMountPointId` is always null. Consumers flatten with
 * `includeParticipants: true`.
 *
 * Any tier whose lookup fails drops out with a `warn`; this never throws.
 *
 * @module scenario-builder/mount-pool
 */

import { getGeneralMountPointId } from '@/lib/instance-settings'
import { getRepositories } from '@/lib/repositories/factory'
import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  dedupeTierTriple,
  resolveGroupMountPointIdsForCharacter,
  resolveMountPointIdsForGroup,
  resolveProjectMountPointIds,
  type TieredMountPool,
} from '@/lib/mount-index/tiered-mount-pool'

const logger = createServiceLogger('ScenarioBuilderMountPool')

const errMsg = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function resolveScenarioBuilderMountPool(opts: {
  userId: string
  projectId?: string | null
  characterIds: string[]
  /** Groups named outright (the builder launched from a group's page). */
  groupIds?: string[]
}): Promise<TieredMountPool> {
  const { userId, projectId, characterIds } = opts
  const namedGroupIds = [...new Set((opts.groupIds ?? []).filter(Boolean))]
  const repos = getRepositories()
  const castIds = [...new Set(characterIds.filter(Boolean))]

  // 1. Cast vaults. Raw reads: we need only the vault pointer and the archive
  //    flag, and a broken vault overlay must cost a tier, not the run. An
  //    archived character is a tombstone and contributes nothing — never
  //    `ensureCharacterVault` one here.
  const liveCastIds: string[] = []
  const vaultIds: string[] = []
  for (const characterId of castIds) {
    try {
      // Raw read: the overlay is not wanted — only the vault pointer, owner and archive flag.
      const character = await repos.characters.findByIdRaw(characterId)
      if (!character) continue
      if (character.userId && character.userId !== userId) continue
      if (character.archivedAt) {
        logger.debug('Archived cast member contributes nothing to the pool', { characterId })
        continue
      }
      liveCastIds.push(characterId)
      if (character.characterDocumentMountPointId) {
        vaultIds.push(character.characterDocumentMountPointId)
      }
    } catch (error) {
      logger.warn('Cast vault lookup failed; tier dropped for this character', {
        characterId,
        error: errMsg(error),
      })
    }
  }

  // 2. Group stores — the named groups, then the union over the whole cast
  //    (both helpers fail soft).
  const groupIds: string[] = []
  for (const groupId of namedGroupIds) {
    groupIds.push(...(await resolveMountPointIdsForGroup(groupId)))
  }
  for (const characterId of liveCastIds) {
    groupIds.push(...(await resolveGroupMountPointIdsForCharacter(characterId)))
  }

  // 3. Project stores (fails soft to []).
  const projectIds = await resolveProjectMountPointIds(projectId ?? null)

  // 4. Quilltap General (null during the pre-provisioning window).
  let globalMountPointId: string | null = null
  try {
    globalMountPointId = await getGeneralMountPointId()
  } catch (error) {
    logger.warn('Quilltap General lookup failed; global tier dropped', { error: errMsg(error) })
  }

  // 5. Scoped-tier dedup, then participants excluded from every scoped tier so
  //    each mount classifies into exactly one bucket.
  const deduped = dedupeTierTriple({
    characterMountPointId: null,
    groupMountPointIds: groupIds,
    projectMountPointIds: projectIds,
    globalMountPointId,
  })
  const excluded = new Set<string>([
    ...deduped.groupMountPointIds,
    ...deduped.projectMountPointIds,
    ...(deduped.globalMountPointId ? [deduped.globalMountPointId] : []),
  ])
  const participantMountPointIds = [...new Set(vaultIds)].filter((id) => !excluded.has(id))

  const pool: TieredMountPool = { ...deduped, participantMountPointIds }
  logger.debug('Resolved Scenario Builder mount pool', {
    castCount: castIds.length,
    liveCastCount: liveCastIds.length,
    namedGroupCount: namedGroupIds.length,
    participants: pool.participantMountPointIds.length,
    groups: pool.groupMountPointIds.length,
    projects: pool.projectMountPointIds.length,
    hasGlobal: !!pool.globalMountPointId,
  })
  return pool
}
