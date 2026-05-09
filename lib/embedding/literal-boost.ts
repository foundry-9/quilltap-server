/**
 * Literal-phrase boost helpers for hybrid (literal + embedding) search.
 *
 * Used by the unified `search` tool's underlying search functions
 * (`searchDocumentChunks`, `searchConversationChunks`, `searchMemoriesSemantic`,
 * `HelpSearch.search`) to lift items that contain the trimmed query as a
 * verbatim case-insensitive substring, so a literal-text match isn't
 * outranked by a slightly-stronger pure-vector neighbour. Per-turn
 * injectors leave the boost disabled.
 */

/**
 * Minimum length (in characters, after trim+lowercase) for a query to
 * qualify for literal-substring matching. Below this we skip the literal
 * pass entirely — short tokens hit far too many false positives.
 */
export const LITERAL_BOOST_MIN_PHRASE_LENGTH = 8

/**
 * Returns the trimmed lowercase phrase if the query qualifies for the
 * literal-boost pass, or `null` otherwise. Centralizes the trim/lower/length
 * gate so every call site behaves identically.
 */
export function getLiteralPhrase(query: string | undefined | null): string | null {
  if (!query) return null
  const phrase = query.trim().toLowerCase()
  return phrase.length >= LITERAL_BOOST_MIN_PHRASE_LENGTH ? phrase : null
}

/**
 * Case-insensitive substring match against a candidate text field.
 * `lowerPhrase` MUST already be lowercased — `getLiteralPhrase` does that.
 */
export function containsLiteralPhrase(
  text: string | null | undefined,
  lowerPhrase: string,
): boolean {
  if (!text) return false
  return text.toLowerCase().includes(lowerPhrase)
}

/**
 * Half-the-distance-to-1 boost: 0.0 → 0.5, 0.5 → 0.75, 0.8 → 0.9.
 *
 * Applied to the cosine similarity of items that ALSO scored a literal
 * phrase hit. The intent is to ensure a buried verbatim match cannot be
 * silently outranked or sliced off, while still leaving stronger pure-vector
 * neighbours room to win when their semantic relevance is compelling.
 */
export function applyLiteralBoost(score: number): number {
  return score + (1 - score) / 2
}
