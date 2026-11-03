/**
 * Scenario Builder mount pool — "what this chat could see", before the chat exists.
 *
 * The Scenario Builder runs a character-less tool loop that must read exactly
 * the stores a chat with this cast (and project) would reach: every cast
 * member's vault, the union of every cast member's group stores, the project's
 * stores, and Quilltap General. Launched from a group's page, the run also
 * names that group outright (`groupIds`), whose stores join the group tier
 * whether or not any cast member belongs to it.
 *
 * That is a cast's reach, and a cast's reach is `resolveCastPool`
 * (`lib/mount-index/reach.ts`); this module is the Builder's name for it. The
 * cast vaults sit in the `participant` tier and `characterMountPointId` is
 * always null, so consumers flatten with `includeParticipants: true`. Any tier
 * whose lookup fails drops out with a `warn`; this never throws.
 *
 * @module scenario-builder/mount-pool
 */

import { resolveCastPool, type TieredMountPool } from '@/lib/mount-index/reach'

export async function resolveScenarioBuilderMountPool(opts: {
  userId: string
  projectId?: string | null
  characterIds: string[]
  /** Groups named outright (the builder launched from a group's page). */
  groupIds?: string[]
}): Promise<TieredMountPool> {
  return resolveCastPool(opts)
}
