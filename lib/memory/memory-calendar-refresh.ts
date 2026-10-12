/**
 * Reads the instance timezone for the memory calendar (bug 212).
 *
 * Kept apart from `memory-calendar.ts` so the calendar math stays I/O-free.
 * Called at the async entry points that resolve event time or day references;
 * the synchronous resolvers then read the cached value.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import {
  getMemoryTimeZone,
  isMemoryTimeZoneStale,
  isValidTimeZone,
  setCachedInstanceTimeZone,
} from './memory-calendar'

/**
 * Re-read the instance timezone (`ChatSettings.timezone`) when the cached copy
 * is stale, and return the effective memory timezone. Never throws — a failed
 * read leaves the previous value (or the env/system fallback) in force,
 * because recall must degrade, never block.
 */
export async function refreshMemoryTimeZone(nowMs: number = Date.now()): Promise<string> {
  if (!isMemoryTimeZoneStale(nowMs)) return getMemoryTimeZone()
  try {
    const all = (await getRepositories().chatSettings.findAll()) as Array<{ timezone?: string | null }>
    const configured = all.find(s => isValidTimeZone(s?.timezone))?.timezone ?? null
    setCachedInstanceTimeZone(configured, nowMs)
    logger.debug('[MemoryCalendar] Instance timezone refreshed', {
      instanceTimeZone: configured,
      effective: getMemoryTimeZone(),
    })
  } catch (error) {
    logger.debug('[MemoryCalendar] Could not read the instance timezone; using fallback', {
      effective: getMemoryTimeZone(),
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return getMemoryTimeZone()
}
