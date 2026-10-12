/**
 * Memory time: one clock for event time on write and day references on read.
 *
 *  - `calendar.ts` — the instance memory calendar (zone resolution, zoned day math).
 *  - `rules.ts` — `DAY_REFERENCE_TABLE`, the one rule set both directions read.
 *  - `clock.ts` — `MemoryClock`, `clockFor`, `resolveEventTime` (write),
 *    `resolveReferenceWindow` (read), `normaliseTimeRange` (the classifier's ranges).
 *  - `age-label.ts` — the age a memory carries into a prompt.
 *
 * `calendar-refresh.ts` (the async read of the instance zone) is not
 * re-exported here, so this barrel stays I/O-free.
 *
 * @module memory/time
 */

export {
  clockFor,
  memoryClockFor,
  resolveEventTime,
  resolveWhenPhrase,
  resolveReferenceWindow,
  resolveDayReference,
  normaliseTimeRange,
  type MemoryClock,
  type TimeWindow,
  type DayReferenceResolution,
} from './clock'
export {
  DAY_REFERENCE_TABLE,
  DAY_NUMBER_WORDS,
  MAX_TABLE_DAYS_AGO,
  matchDayReferenceRule,
  type DayReferenceRule,
  type RuleWindow,
} from './rules'
export {
  getMemoryTimeZone,
  isValidTimeZone,
  zonedParts,
  zonedDateStamp,
  zonedDayBoundsIso,
  startOfZonedDayMs,
  startOfZonedWeekMs,
  zonedTimeOnDayMs,
  zonedTimeToUtcMs,
} from './calendar'
export { formatMemoryAge } from './age-label'
