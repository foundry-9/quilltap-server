'use client'

/**
 * useDictionaryFeed
 *
 * Renderer-side hook that feeds Aurora character names into the Electron
 * shell's custom spellchecker dictionary. Outside Electron (regular browser)
 * the hook is a silent no-op — it feature-detects `window.quilltap.setDictionaryWords`
 * before doing anything.
 *
 * Mount once at a long-lived layout level. Character data is global, so this
 * does not belong inside a per-chat component.
 *
 * @module lib/spellcheck/useDictionaryFeed
 */

import { useEffect } from 'react'
import useSWR from 'swr'

const MAX_DICTIONARY_WORDS = 5000

/**
 * Split character names into individual dictionary tokens.
 *
 * - Splits on whitespace and Unicode punctuation
 * - Drops tokens shorter than 2 characters
 * - Drops pure-digit tokens
 * - Dedupes across all names
 * - Caps the total at MAX_DICTIONARY_WORDS (logs a warning if exceeded)
 */
export function tokenizeNames(names: string[]): string[] {
  const set = new Set<string>()
  for (const name of names) {
    if (!name) continue
    for (const token of name.split(/[\s\p{P}]+/u)) {
      if (token.length < 2) continue
      if (/^\d+$/.test(token)) continue
      set.add(token)
    }
  }
  const arr = Array.from(set)
  if (arr.length > MAX_DICTIONARY_WORDS) {
    console.warn(
      `[spellcheck-feed] dictionary set capped: ${arr.length} > ${MAX_DICTIONARY_WORDS}`,
    )
    return arr.slice(0, MAX_DICTIONARY_WORDS)
  }
  return arr
}

interface CharactersResponse {
  characters?: Array<{ name?: string | null }>
}

/**
 * Pushes Aurora character names to the shell dictionary whenever the
 * `/api/v1/characters` payload changes. Silent no-op outside Electron.
 */
export function useDictionaryFeed(): void {
  const { data } = useSWR<CharactersResponse>('/api/v1/characters')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const shell = window.quilltap
    if (typeof shell?.setDictionaryWords !== 'function') return
    if (!data?.characters) return

    const names = data.characters
      .map((c) => c?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
    const words = tokenizeNames(names)

    shell
      .setDictionaryWords(words)
      .then(() => {
        console.debug('[spellcheck-feed] pushed dictionary', { count: words.length })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[spellcheck-feed] push failed', { error: message })
      })
  }, [data?.characters])
}
