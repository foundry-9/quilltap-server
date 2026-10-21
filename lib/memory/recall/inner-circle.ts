/**
 * The inner circle — who a character holds closest, read from their groups.
 *
 * A holder's inner circle is every character who shares at least one group
 * with them, less the holder, archived characters (tombstones) and whoever the
 * caller excludes (the frozen archive excludes everyone present, whom its
 * first step already covers). Each member takes the **tier** of the smallest
 * group they share with the holder: the holder's distinct group sizes,
 * ascending, are tiers 0, 1, 2, … — ranks, not raw sizes, so a family of four
 * is tier 0 whether the next group up has six members or sixty.
 *
 * The order is deterministic — tier, then group name, then member name, then
 * id — because the frozen archive renders the circle in this order and must
 * stay byte-stable. {@link innerCircleSignature} turns it into the archive
 * cache's freshness check, so a membership change, a rename that reorders the
 * circle, or an archived member reaches the next turn without an explicit
 * invalidation.
 *
 * Membership lives in the mount-index DB; group and character names are plain
 * columns read without the vault overlay, so a broken vault costs a member,
 * never the turn. Design of record: docs/developer/features/complete/inner-circle-recall.md
 * (Part B).
 *
 * @module memory/recall/inner-circle
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

export interface InnerCircleMember {
  characterId: string
  name: string
  /** Rank of the tightest shared group: 0 = the holder's smallest group. */
  tier: number
  /** Size of that group, for the trace. */
  groupSize: number
  groupName: string
}

interface SharedGroup {
  groupId: string
  groupName: string
  size: number
}

/**
 * Resolve a holder's inner circle, in circle order. Empty when the holder
 * belongs to no group (or the mount index is unavailable — its repository
 * degrades to empty reads).
 */
export async function resolveInnerCircle(
  holderId: string,
  options: { excludeIds: ReadonlySet<string> },
): Promise<InnerCircleMember[]> {
  const repos = getRepositories()
  const memberships = await repos.groupCharacterMembers.findByCharacterId(holderId)
  if (memberships.length === 0) return []

  // Every group the holder is in, with its roster and its name.
  const groupIds = [...new Set(memberships.map(m => m.groupId))]
  const groups: Array<SharedGroup & { roster: string[] }> = []
  for (const groupId of groupIds) {
    const group = await repos.groups.findByIdRaw(groupId)
    if (!group) continue // a membership row left behind by a deleted group
    const roster = [...new Set((await repos.groupCharacterMembers.findByGroupId(groupId)).map(m => m.characterId))]
    groups.push({ groupId, groupName: (group.name ?? '').trim(), size: roster.length, roster })
  }
  const sizes = [...new Set(groups.map(g => g.size))].sort((a, b) => a - b)
  const tierOf = (size: number) => sizes.indexOf(size)

  // Each candidate's tightest shared group.
  const tightest = new Map<string, SharedGroup>()
  for (const group of groups) {
    for (const characterId of group.roster) {
      if (characterId === holderId || options.excludeIds.has(characterId)) continue
      const current = tightest.get(characterId)
      if (!current || compareGroups(group, current) < 0) tightest.set(characterId, group)
    }
  }
  if (tightest.size === 0) return []

  // Names, with archived characters (and rows that no longer exist) left out.
  const names = await repos.characters.findNamesByIds([...tightest.keys()], { excludeArchived: true })
  const circle: InnerCircleMember[] = []
  for (const [characterId, group] of tightest) {
    const name = names.get(characterId)
    if (!name) continue
    circle.push({ characterId, name, tier: tierOf(group.size), groupSize: group.size, groupName: group.groupName })
  }
  circle.sort((a, b) =>
    a.tier - b.tier ||
    a.groupName.localeCompare(b.groupName) ||
    a.name.localeCompare(b.name) ||
    a.characterId.localeCompare(b.characterId),
  )

  logger.debug('[InnerCircle] Resolved inner circle', {
    holderId,
    groups: groups.length,
    tiers: sizes.length,
    excluded: options.excludeIds.size,
    members: circle.length,
  })
  return circle
}

/** Smaller group first; equal sizes by name, then id. */
function compareGroups(a: SharedGroup, b: SharedGroup): number {
  return a.size - b.size || a.groupName.localeCompare(b.groupName) || a.groupId.localeCompare(b.groupId)
}

/**
 * The circle as the archive cache compares it: members and tiers in circle
 * order. Order is kept (not sorted) because the archive renders in it.
 */
export function innerCircleSignature(circle: readonly InnerCircleMember[]): string {
  return circle.map(m => `${m.characterId}:${m.tier}`).join(',')
}

/** A tier's per-member digest allowance; the table's last entry covers every looser tier. */
export function innerCircleAllowanceFor(tier: number, allowance: readonly number[]): number {
  if (allowance.length === 0) return 0
  return Math.max(0, allowance[Math.min(tier, allowance.length - 1)] ?? 0)
}
