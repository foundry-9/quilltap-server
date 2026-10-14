/**
 * The memory calendar — one timezone per instance for event time (bug 212).
 *
 * The Commonplace Book answers one question in two directions: on write, "when
 * did this happen?" (`resolveWhenPhrase` turns "last night" into an
 * `occurredAt`); on read, "which memories fall in the period this turn asks
 * about?" (`resolveDayReference` turns "last night" into a window, and the
 * keyword distillation's date-only `timeRange` is widened to whole days). Each
 * direction used to keep its own calendar — UTC midnights on write, the
 * server-local clock on read, UTC days for the classifier — so a memory
 * written as "last night" missed the window for "last night".
 *
 * Locked decision 10 of the memory system refactor: one calendar per instance,
 * resolved as the instance timezone (the Salon-level `ChatSettings.timezone`)
 * → `QUILLTAP_TIMEZONE` → the system zone. The per-chat timestamp timezone
 * stays display-only and is never consulted here.
 *
 * This module is pure (`Intl` only, no I/O) and safe in the forked job child.
 * The instance timezone lives in the database, so it is read asynchronously by
 * `refreshMemoryTimeZone` (`memory-calendar-refresh.ts`) at the async entry
 * points (extraction, the episode pass, the per-turn distillation) and cached
 * here for the synchronous resolvers; until a read succeeds the env/system
 * fallback applies.
 */

/** How long a read of the instance timezone is trusted before re-reading. */
const INSTANCE_TIMEZONE_TTL_MS = 5 * 60 * 1000

let cachedInstanceTimeZone: string | null = null
let cachedAtMs = 0

/** True when `tz` is an IANA zone this runtime's `Intl` accepts. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function systemTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (isValidTimeZone(tz)) return tz
  } catch {
    // fall through
  }
  return 'UTC'
}

/**
 * The instance's memory timezone: instance setting → `QUILLTAP_TIMEZONE` →
 * system. An explicit `instanceTimeZone` argument stands in for the cached
 * instance setting (tests, callers that already hold the settings row).
 */
export function getMemoryTimeZone(instanceTimeZone?: string | null): string {
  if (isValidTimeZone(instanceTimeZone)) return instanceTimeZone
  if (isValidTimeZone(cachedInstanceTimeZone)) return cachedInstanceTimeZone
  const env = process.env.QUILLTAP_TIMEZONE
  if (isValidTimeZone(env)) return env
  return systemTimeZone()
}

/** Whether the cached instance timezone is older than its TTL (or never read). */
export function isMemoryTimeZoneStale(nowMs: number = Date.now()): boolean {
  return cachedAtMs === 0 || nowMs - cachedAtMs >= INSTANCE_TIMEZONE_TTL_MS
}

/** Record the instance timezone just read from settings (null when unset). */
export function setCachedInstanceTimeZone(tz: string | null, nowMs: number = Date.now()): void {
  cachedInstanceTimeZone = isValidTimeZone(tz) ? tz : null
  cachedAtMs = nowMs
}

/** Test-only: forget the cached instance timezone. */
export function resetMemoryTimeZoneCacheForTests(): void {
  cachedInstanceTimeZone = null
  cachedAtMs = 0
}

export interface ZonedParts {
  year: number
  /** 0-based, like `Date#getMonth`. */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Sunday … 6 = Saturday, like `Date#getDay`. */
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

/** Wall-clock fields of the instant `ms` in `timeZone`. */
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {}
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) parts[p.type] = p.value
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  }
}

/** Offset of `timeZone` from UTC at the instant `ms`, in ms (UTC−5 → −5h). */
function offsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone)
  const asUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/**
 * The UTC instant of a wall-clock time in `timeZone`. Day/month overflow is
 * normalised the way `Date.UTC` does it (`day: 0` is the previous month's last
 * day), so callers can do calendar arithmetic in the arguments.
 */
export function zonedTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month, day, hour, 0, 0, 0)
  const first = offsetMs(guess, timeZone)
  const candidate = guess - first
  const second = offsetMs(candidate, timeZone)
  return second === first ? candidate : guess - second
}

/** Local midnight of the day `offsetDays` from the local day containing `ms`. */
export function startOfZonedDayMs(ms: number, timeZone: string, offsetDays = 0): number {
  const p = zonedParts(ms, timeZone)
  return zonedTimeToUtcMs(p.year, p.month, p.day + offsetDays, 0, timeZone)
}

/** Local wall-clock `hour` on the day `offsetDays` from the local day containing `ms`. */
export function zonedTimeOnDayMs(ms: number, timeZone: string, offsetDays: number, hour: number): number {
  const p = zonedParts(ms, timeZone)
  return zonedTimeToUtcMs(p.year, p.month, p.day + offsetDays, hour, timeZone)
}

/** Local midnight of the Monday starting the week `weekOffset` weeks from the one containing `ms`. */
export function startOfZonedWeekMs(ms: number, timeZone: string, weekOffset = 0): number {
  const p = zonedParts(ms, timeZone)
  const daysSinceMonday = (p.weekday + 6) % 7
  return zonedTimeToUtcMs(p.year, p.month, p.day - daysSinceMonday + weekOffset * 7, 0, timeZone)
}

/** `YYYY-MM-DD` of the local day containing `ms`. */
export function zonedDateStamp(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`
}

/**
 * Widen a date-only `YYYY-MM-DD` bound to the local day it names: `from` →
 * local midnight, `to` → the last millisecond before the next local midnight.
 * Null for anything that is not a valid calendar date.
 */
export function zonedDayBoundsIso(
  date: string,
  timeZone: string,
): { from: string; to: string } | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  const check = new Date(Date.UTC(year, month, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) {
    return null
  }
  const from = zonedTimeToUtcMs(year, month, day, 0, timeZone)
  const next = zonedTimeToUtcMs(year, month, day + 1, 0, timeZone)
  return { from: new Date(from).toISOString(), to: new Date(next - 1).toISOString() }
}
