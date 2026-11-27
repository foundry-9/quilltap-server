/**
 * Connection-profile usage counters — the one description of them.
 *
 * A profile keeps two ledgers, split by `usageCategoryOf`
 * (`lib/schemas/llm-log.types.ts`): **chat** (a conversation's own answer —
 * Salon turns and their tool round-trips, console and help-chat replies,
 * Carina answers) and **automatic** (everything Quilltap asks on its own:
 * memory, titles, summaries, the classifier, image prompts, wizards…). Each
 * ledger counts calls (provider requests, failed ones included) and tokens,
 * with prompt-cache reads and writes kept apart from uncached input.
 *
 * The counters are written by `accountLLMCall`
 * (`lib/services/usage-accounting.service.ts`) and nothing else; this module
 * names the columns, reads them back, and orders profile pickers by chat use.
 * Pure and client-safe.
 *
 * @module lib/llm/profile-usage
 */

import type { UsageCategory } from '@/lib/schemas/llm-log.types'

/** What one call, or one ledger, adds up to. */
export interface UsageTally {
  calls: number
  /** Uncached input tokens. */
  promptTokens: number
  completionTokens: number
  /** Input tokens served from a provider's prompt cache. */
  cacheReadTokens: number
  /** Input tokens written into a provider's prompt cache. */
  cacheWriteTokens: number
}

export const EMPTY_USAGE_TALLY: Readonly<UsageTally> = Object.freeze({
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

/** The `connection_profiles` column behind each ledger's figure. */
export const PROFILE_USAGE_COUNTER_FIELDS = {
  chat: {
    calls: 'chatCallCount',
    promptTokens: 'chatPromptTokens',
    completionTokens: 'chatCompletionTokens',
    cacheReadTokens: 'chatCacheReadTokens',
    cacheWriteTokens: 'chatCacheWriteTokens',
  },
  automatic: {
    calls: 'automaticCallCount',
    promptTokens: 'automaticPromptTokens',
    completionTokens: 'automaticCompletionTokens',
    cacheReadTokens: 'automaticCacheReadTokens',
    cacheWriteTokens: 'automaticCacheWriteTokens',
  },
} as const satisfies Record<UsageCategory, Record<keyof UsageTally, string>>

type CounterField =
  (typeof PROFILE_USAGE_COUNTER_FIELDS)[UsageCategory][keyof UsageTally]

/** Every counter column, for the repository's patch-only list. */
export const PROFILE_USAGE_COUNTER_FIELD_NAMES: readonly CounterField[] = (
  Object.values(PROFILE_USAGE_COUNTER_FIELDS) as Array<Record<keyof UsageTally, CounterField>>
).flatMap((fields) => Object.values(fields))

/** Every counter at zero — a brand-new profile's ledgers. */
export function zeroProfileUsageCounters(): Record<CounterField, number> {
  return Object.fromEntries(PROFILE_USAGE_COUNTER_FIELD_NAMES.map((field) => [field, 0])) as Record<CounterField, number>
}

/** A row that may carry the counters (a full profile, or an API payload). */
export type ProfileUsageCounters = Partial<Record<CounterField, number | null>>

const TALLY_KEYS = Object.keys(EMPTY_USAGE_TALLY) as Array<keyof UsageTally>

function readLedger(row: ProfileUsageCounters, category: UsageCategory): UsageTally {
  const fields = PROFILE_USAGE_COUNTER_FIELDS[category]
  const tally = { ...EMPTY_USAGE_TALLY }
  for (const key of TALLY_KEYS) {
    const value = row[fields[key]]
    tally[key] = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  }
  return tally
}

/** Both ledgers of a profile. Missing or junk values read as 0. */
export function readProfileUsage(row: ProfileUsageCounters): Record<UsageCategory, UsageTally> {
  return { chat: readLedger(row, 'chat'), automatic: readLedger(row, 'automatic') }
}

/** Every token a tally counts: uncached input, output, cache reads and writes. */
export function tallyTokens(tally: UsageTally): number {
  return tally.promptTokens + tally.completionTokens + tally.cacheReadTokens + tally.cacheWriteTokens
}

/** The `$inc` that adds one call's tally to a ledger. Zero figures are left out. */
export function counterIncrementsFor(category: UsageCategory, tally: UsageTally): Partial<Record<CounterField, number>> {
  const fields = PROFILE_USAGE_COUNTER_FIELDS[category]
  const inc: Partial<Record<CounterField, number>> = {}
  for (const key of TALLY_KEYS) {
    if (tally[key] > 0) inc[fields[key]] = tally[key]
  }
  return inc
}

/**
 * Most chat use first: chat calls, then chat tokens. Equal profiles compare
 * as 0, so a stable sort keeps the list's own order (the operator's
 * `sortIndex`) among them — including every profile never used for chat.
 */
export function compareByChatUse(a: ProfileUsageCounters, b: ProfileUsageCounters): number {
  const ua = readLedger(a, 'chat')
  const ub = readLedger(b, 'chat')
  return (ub.calls - ua.calls) || (tallyTokens(ub) - tallyTokens(ua))
}

/**
 * The order a chat's profile picker offers: most used for chat first. Returns
 * a new array; the input is the operator's order and is left alone.
 */
export function orderProfilesByChatUse<T>(profiles: readonly T[]): T[] {
  // Typed loosely so a picker's narrow row type (often just id and name, with
  // the counters riding along untyped from the API) can be passed as is.
  return [...profiles].sort((a, b) => compareByChatUse(a as ProfileUsageCounters, b as ProfileUsageCounters))
}
