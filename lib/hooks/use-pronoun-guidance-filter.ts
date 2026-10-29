'use client'

/**
 * The Wardrobe UI's pronoun-aware filter for one character: their pronouns
 * (read through the character detail query), an on/off switch that starts
 * on, and the predicate the lists and pickers apply. The rule itself is
 * `fitsPronounGuidance` (`lib/wardrobe/pronoun-guidance.ts`), the same one the
 * `wardrobe_list` tool and the "Let character choose" pass use.
 *
 * `applies` is false with no character, or one whose pronouns are unset or
 * custom: nothing would be hidden, so callers need not show the switch.
 *
 * @module lib/hooks/use-pronoun-guidance-filter
 */

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import type { Pronouns } from '@/lib/schemas/character.types'
import { standardPronounSubjectOf } from '@/lib/characters/pronoun-presets'
import { fitsPronounGuidance } from '@/lib/wardrobe/pronoun-guidance'

/** The character GET's envelope — only the field this hook reads. */
interface CharacterPronounsResponse {
  character?: { pronouns?: Pronouns | null }
}

type GuidedItem = { pronounGuidance?: readonly string[] | null }

export interface PronounGuidanceFilter {
  /** The character has standard pronouns, so guidance can hide something. */
  applies: boolean
  /** The switch: on (the default) honours guidance. */
  aware: boolean
  setAware: (next: boolean) => void
  /** Is the item shown under the current switch? */
  shows: (item: GuidedItem) => boolean
  /** The items shown under the current switch. */
  offer: <T extends GuidedItem>(items: readonly T[]) => T[]
  /** How many of `items` guidance would hide (whatever the switch says). */
  countHeldBack: (items: readonly GuidedItem[]) => number
}

export function usePronounGuidanceFilter(characterId: string | null): PronounGuidanceFilter {
  const query = useQuery({
    queryKey: queryKeys.characters.detail(characterId ?? 'none'),
    queryFn: ({ signal }) =>
      apiFetch<CharacterPronounsResponse>(`/api/v1/characters/${characterId}`, { signal }),
    enabled: Boolean(characterId),
  })
  const pronouns = characterId ? (query.data?.character?.pronouns ?? null) : null
  const applies = standardPronounSubjectOf(pronouns) !== null
  const [aware, setAware] = useState(true)

  const shows = useCallback(
    (item: GuidedItem) => !aware || fitsPronounGuidance(item, pronouns),
    [aware, pronouns],
  )
  const offer = useCallback(
    <T extends GuidedItem>(items: readonly T[]): T[] => items.filter(shows),
    [shows],
  )
  const countHeldBack = useCallback(
    (items: readonly GuidedItem[]) => items.filter((i) => !fitsPronounGuidance(i, pronouns)).length,
    [pronouns],
  )

  return useMemo(
    () => ({ applies, aware, setAware, shows, offer, countHeldBack }),
    [applies, aware, shows, offer, countHeldBack],
  )
}
