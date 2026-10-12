/**
 * Which memories a bulk policy path may remove (bug 201).
 *
 * A chat wipe (`DELETE /memories?chatId=`, `MEMORY_REGENERATE_CHAT`) and the
 * near-duplicate folding tool act on what extraction wrote, and only on that.
 * Three kinds of row are out of their reach:
 *  - MANUAL rows — written by hand; extraction will never write them back.
 *  - digests (`source: 'CONSOLIDATED'`) — their members point at them through
 *    `supersededById`; removing one leaves every member dangling.
 *  - cold rows — superseded members belong to their digest, and demoted rows
 *    are kept on purpose; both still block re-insertion at the gate.
 *
 * The per-row delete (`DELETE /memories/[id]`) is the true purge and does not
 * consult this. Pure and client-safe.
 */

import type { Memory } from '@/lib/schemas/types'

export type PolicyProtection = 'manual' | 'digest' | 'cold'

/** Why a bulk policy path must leave this row alone, or null when it may act. */
export function policyProtectionOf(memory: Pick<Memory, 'source' | 'tier'>): PolicyProtection | null {
  if (memory.source === 'MANUAL') return 'manual'
  if (memory.source === 'CONSOLIDATED') return 'digest'
  if (memory.tier === 'cold') return 'cold'
  return null
}

/** Split rows into those a bulk policy path may act on and those it must spare. */
export function partitionByPolicyProtection<T extends Pick<Memory, 'source' | 'tier'>>(
  memories: readonly T[],
): { actionable: T[]; spared: T[]; sparedBy: Record<PolicyProtection, number> } {
  const actionable: T[] = []
  const spared: T[] = []
  const sparedBy: Record<PolicyProtection, number> = { manual: 0, digest: 0, cold: 0 }
  for (const memory of memories) {
    const protection = policyProtectionOf(memory)
    if (protection) {
      spared.push(memory)
      sparedBy[protection]++
    } else {
      actionable.push(memory)
    }
  }
  return { actionable, spared, sparedBy }
}
