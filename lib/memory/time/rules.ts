/**
 * The day-reference table — one rule set for both directions of memory time.
 *
 * The Commonplace Book answers one question two ways: on write, "when did this
 * happen?" (a model's `when` phrase becomes an `occurredAt`); on read, "which
 * memories fall in the period this turn asks about?" (a phrase in the
 * conversation becomes a window). Each rule here gives the local window a
 * phrase names; the write side stamps the START of that window and the read
 * side asks for the whole of it, so a memory written as "last night" always
 * lands inside "last night" asked (bug 212). Windows are on the instance
 * memory calendar (`calendar.ts`), never UTC days.
 *
 * Pure + I/O-free; safe in the forked job child.
 *
 * @module memory/time/rules
 */

import { startOfZonedDayMs, startOfZonedWeekMs, zonedTimeOnDayMs } from './calendar'

/** A resolved window: `[fromMs, endMs)` — `endMs` is exclusive. */
export interface RuleWindow {
  fromMs: number
  endMs: number
  /** False for a future reference ("tomorrow"): computed for logging, never applied. */
  pastPointing: boolean
}

export interface DayReferenceRule {
  /** Short name, for logs and tests. */
  name: string
  /**
   * The phrase, as a regular-expression source matched whole: anchored
   * (`^…$`) on the write side, word-bounded in running text on the read side.
   */
  pattern: string
  /** The window the phrase names, relative to `anchorMs` on `timeZone`'s calendar. */
  window(match: RegExpMatchArray, anchorMs: number, timeZone: string): RuleWindow | null
}

/** Number words the "N days ago" rule accepts, alongside digits. */
export const DAY_NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
}

/** Largest "N days ago" the table resolves; beyond it, write-only rules (or the LLM) answer. */
export const MAX_TABLE_DAYS_AGO = 14

const day = (anchorMs: number, tz: string, offset: number) => startOfZonedDayMs(anchorMs, tz, offset)
const week = (anchorMs: number, tz: string, offset: number) => startOfZonedWeekMs(anchorMs, tz, offset)

/**
 * The table. Order matters for the read scan: longest phrases first, so "day
 * before yesterday" is consumed whole and never re-read as "yesterday".
 */
export const DAY_REFERENCE_TABLE: ReadonlyArray<DayReferenceRule> = [
  {
    name: 'day before yesterday',
    pattern: 'day before yesterday',
    window: (_m, a, tz) => ({ fromMs: day(a, tz, -2), endMs: day(a, tz, -1), pastPointing: true }),
  },
  {
    name: 'last night',
    pattern: 'last night',
    window: (_m, a, tz) => ({
      fromMs: zonedTimeOnDayMs(a, tz, -1, 18),
      endMs: zonedTimeOnDayMs(a, tz, 0, 6),
      pastPointing: true,
    }),
  },
  {
    // Today and its parts: local midnight up to the anchor. A sub-day phrase
    // deliberately does not narrow the window — memories carry coarse event
    // times, and a too-tight window starves recall.
    name: 'today',
    pattern: 'earlier today|this morning|this afternoon|this evening|tonight|today',
    window: (_m, a, tz) => ({ fromMs: day(a, tz, 0), endMs: a + 1, pastPointing: true }),
  },
  {
    name: 'yesterday',
    pattern: 'yesterday',
    window: (_m, a, tz) => ({ fromMs: day(a, tz, -1), endMs: day(a, tz, 0), pastPointing: true }),
  },
  {
    name: 'N days ago',
    pattern: `(\\d{1,2}|${Object.keys(DAY_NUMBER_WORDS).join('|')}) days? ago`,
    window: (m, a, tz) => {
      const raw = m[1].toLowerCase()
      const n = /^\d+$/.test(raw) ? Number(raw) : DAY_NUMBER_WORDS[raw]
      if (!n || n < 1 || n > MAX_TABLE_DAYS_AGO) return null
      return { fromMs: day(a, tz, -n), endMs: day(a, tz, -n + 1), pastPointing: true }
    },
  },
  {
    name: 'this week',
    pattern: 'this week',
    window: (_m, a, tz) => ({ fromMs: week(a, tz, 0), endMs: a + 1, pastPointing: true }),
  },
  {
    name: 'last week',
    pattern: 'last week',
    window: (_m, a, tz) => ({ fromMs: week(a, tz, -1), endMs: week(a, tz, 0), pastPointing: true }),
  },
  {
    name: 'next week',
    pattern: 'next week',
    window: (_m, a, tz) => ({ fromMs: week(a, tz, 1), endMs: week(a, tz, 2), pastPointing: false }),
  },
  {
    name: 'tomorrow',
    pattern: 'tomorrow',
    window: (_m, a, tz) => ({ fromMs: day(a, tz, 1), endMs: day(a, tz, 2), pastPointing: false }),
  },
]

const anchoredRules = DAY_REFERENCE_TABLE.map(rule => ({ rule, re: new RegExp(`^(?:${rule.pattern})$`, 'i') }))

/** The table rule a whole phrase names, with its match, or null. */
export function matchDayReferenceRule(phrase: string): { rule: DayReferenceRule; match: RegExpMatchArray } | null {
  for (const { rule, re } of anchoredRules) {
    const match = phrase.match(re)
    if (match) return { rule, match }
  }
  return null
}

/**
 * The whole table as one word-bounded alternation, for scanning running text.
 * Each alternative is wrapped so a match can be resolved back to its rule.
 */
export const DAY_REFERENCE_SCAN_PATTERN = new RegExp(
  '\\b(?:' + DAY_REFERENCE_TABLE.map(rule => `(?:${rule.pattern})`).join('|') + ')\\b',
  'gi',
)
