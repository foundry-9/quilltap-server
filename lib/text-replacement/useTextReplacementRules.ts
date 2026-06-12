'use client'

/**
 * useTextReplacementRules
 *
 * Renderer-side hook that fetches the global text-replacement rule list and
 * compiles it into two O(1) lookup maps used by the Lexical
 * `TextReplacementPlugin`:
 *
 * - `caseSensitive` — keyed by exact `fromText`
 * - `caseInsensitive` — keyed by `fromText.toLowerCase()`
 *
 * The plugin checks case-sensitive first, then falls back to case-insensitive.
 * Empty/loading states resolve to `compiled.empty === true` so the plugin can
 * short-circuit without doing any work.
 *
 * @module lib/text-replacement/useTextReplacementRules
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

import type { TextReplacementRule } from '@/lib/schemas/text-replacement.types'

export interface CompiledRules {
  caseSensitive: Map<string, string>
  caseInsensitive: Map<string, string>
  empty: boolean
}

interface ListResponse {
  rules?: TextReplacementRule[]
  count?: number
}

const EMPTY_COMPILED: CompiledRules = {
  caseSensitive: new Map(),
  caseInsensitive: new Map(),
  empty: true,
}

/**
 * Pure helper exposed for tests. Compiles a list of rules into two lookup
 * maps. Disabled rules are skipped at compile time. Within each map the last
 * entry wins — the plugin reports collisions at the API layer, so this only
 * affects pathological/test inputs.
 */
export function compileRules(rules: TextReplacementRule[]): CompiledRules {
  if (rules.length === 0) return EMPTY_COMPILED

  const caseSensitive = new Map<string, string>()
  const caseInsensitive = new Map<string, string>()

  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.caseSensitive) {
      caseSensitive.set(rule.fromText, rule.toText)
    } else {
      caseInsensitive.set(rule.fromText.toLowerCase(), rule.toText)
    }
  }

  const empty = caseSensitive.size === 0 && caseInsensitive.size === 0
  return { caseSensitive, caseInsensitive, empty }
}

/**
 * Looks a candidate word up in compiled rules. Case-sensitive matches win
 * over case-insensitive matches with the same trigger. Returns the
 * replacement string, or `undefined` when no rule matches.
 *
 * Pure helper exposed for tests; the plugin uses the same precedence inline.
 */
export function findReplacement(
  word: string,
  compiled: CompiledRules,
): string | undefined {
  const cs = compiled.caseSensitive.get(word)
  if (cs !== undefined) return cs
  return compiled.caseInsensitive.get(word.toLowerCase())
}

export function useTextReplacementRules(): {
  rules: TextReplacementRule[] | undefined
  compiled: CompiledRules
  isLoading: boolean
  error: unknown
  mutate: () => Promise<unknown>
} {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.settings.textReplacements,
    queryFn: ({ signal }) => apiFetch<ListResponse>('/api/v1/settings/text-replacements', { signal }),
  })

  const rules = data?.rules

  const compiled = useMemo<CompiledRules>(
    () => (rules ? compileRules(rules) : EMPTY_COMPILED),
    [rules],
  )

  // `mutate` is preserved as the public revalidation handle; it now refetches
  // the query (consumers call it after editing rules to pick up the new list).
  return { rules, compiled, isLoading, error, mutate: refetch }
}
