/**
 * The age label a memory carries into a prompt ("3 days ago", "last week").
 *
 * It reads off the EVENT clock — `occurredAt` when present, else the
 * write/reinforce clock — so "last week" means when it happened, not when it
 * was written down. Decay (`lib/memory/scoring`) deliberately stays on the
 * write clock; only the human-facing label follows the event.
 *
 * @module memory/time/age-label
 */

import type { Memory } from '@/lib/schemas/types'
import { formatRelativeDays } from '@/lib/format-time'
import { eventReferenceTimeMs } from '../episodic'
import { referenceTimeMs } from '../scoring'

/** Human-readable age of a memory, on the event clock. */
export function formatMemoryAge(
  memory: Pick<Memory, 'createdAt'> & Partial<Pick<Memory, 'lastReinforcedAt' | 'occurredAt'>>,
  now: Date = new Date(),
): string {
  const referenceTime = eventReferenceTimeMs(memory.occurredAt, referenceTimeMs(memory))
  return formatRelativeDays(referenceTime, now.getTime())
}
