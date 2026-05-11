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
 * Fraction-of-distance-to-1 boost.
 *
 * With the default fraction of 0.5 ("halfway to 1"): 0.0 → 0.5, 0.5 → 0.75,
 * 0.8 → 0.9 — the legacy half-the-distance behaviour, used by every search
 * source that doesn't tier its hits.
 *
 * The knowledge sources scale the fraction by how "close" the knowledge is
 * to the responding character — `LITERAL_BOOST_CHARACTER` for the
 * character's own vault, `LITERAL_BOOST_PROJECT` for the project's linked
 * mounts, `LITERAL_BOOST_GLOBAL` for the Quilltap General mount — so a
 * verbatim hit in a personal vault outranks the same hit in a shared pool.
 *
 * Applied to the cosine similarity of items that ALSO scored a literal
 * phrase hit. The intent is to ensure a buried verbatim match cannot be
 * silently outranked or sliced off, while still leaving stronger pure-vector
 * neighbours room to win when their semantic relevance is compelling.
 */
export function applyLiteralBoost(score: number, fraction: number = 0.5): number {
  return score + (1 - score) * fraction
}

/** Literal-hit boost fraction for the responding character's vault Knowledge/ folder. */
export const LITERAL_BOOST_CHARACTER = 0.5

/** Literal-hit boost fraction for a chat-project-linked mount's Knowledge/ folder. */
export const LITERAL_BOOST_PROJECT = 0.4

/** Literal-hit boost fraction for the Quilltap General mount's Knowledge/ folder. */
export const LITERAL_BOOST_GLOBAL = 0.25
