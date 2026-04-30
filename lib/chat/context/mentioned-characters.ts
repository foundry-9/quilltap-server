/**
 * Mentioned Characters
 *
 * Scans a chat's visible conversation corpus for mentions of characters
 * that exist on the system but are NOT current participants in the chat,
 * then formats them as a compact "Characters Mentioned" section to inject
 * into the system prompt.
 */

import type { Character } from '@/lib/schemas/types'

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a single case-insensitive, word-boundary regex that matches the names
 * and aliases of every candidate character. Returns null when there is nothing
 * to match (no candidates, or candidates with no usable names).
 */
function buildCandidateNameRegex(candidates: Character[]): RegExp | null {
  const tokens = new Set<string>()
  for (const character of candidates) {
    if (character.name && character.name.trim().length > 0) {
      tokens.add(character.name.trim())
    }
    for (const alias of character.aliases ?? []) {
      if (alias && alias.trim().length > 0) {
        tokens.add(alias.trim())
      }
    }
  }

  if (tokens.size === 0) return null

  // Sort longer tokens first so e.g. "John Smith" is preferred over "John"
  // when both are present.
  const sorted = Array.from(tokens).sort((a, b) => b.length - a.length)
  const alternation = sorted.map(escapeRegex).join('|')
  return new RegExp(`\\b(?:${alternation})\\b`, 'gi')
}

/**
 * Scan the corpus for mentions of any candidate character's name or alias,
 * returning the set of matched character IDs.
 *
 * Matching is case-insensitive and word-boundary anchored. A character
 * matches if any of its name/alias strings appears as a whole word in the
 * corpus. Excluded characters should be filtered out of `candidates` by the
 * caller before invoking this function.
 */
export function findMentionedCharacterIds(
  scanCorpus: string,
  candidates: Character[]
): Set<string> {
  const matched = new Set<string>()
  if (!scanCorpus || candidates.length === 0) return matched

  const regex = buildCandidateNameRegex(candidates)
  if (!regex) return matched

  // Pre-build a lowercase map from each token (name or alias) to its character IDs.
  // (Two characters could share a common alias — both should be matched.)
  const tokenToCharacterIds = new Map<string, Set<string>>()
  const addToken = (token: string, characterId: string) => {
    const key = token.trim().toLowerCase()
    if (!key) return
    let set = tokenToCharacterIds.get(key)
    if (!set) {
      set = new Set<string>()
      tokenToCharacterIds.set(key, set)
    }
    set.add(characterId)
  }
  for (const character of candidates) {
    if (character.name) addToken(character.name, character.id)
    for (const alias of character.aliases ?? []) {
      addToken(alias, character.id)
    }
  }

  let match: RegExpExecArray | null
  while ((match = regex.exec(scanCorpus)) !== null) {
    const hit = match[0].toLowerCase()
    const ids = tokenToCharacterIds.get(hit)
    if (ids) {
      for (const id of ids) matched.add(id)
    }
  }

  return matched
}

// `formatMentionedCharactersSection` was removed: off-scene characters now
// ride as Host introductions in chat history (see
// `buildOffSceneCharactersContent` in lib/services/host-notifications/writer.ts)
// rather than being spliced into the system prompt every turn.
