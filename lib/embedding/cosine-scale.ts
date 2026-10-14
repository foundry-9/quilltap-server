/**
 * Which cosine scale an embedding provider's vectors live on.
 *
 * Neural embedders put unrelated text near ~0.25 and a restated fact at
 * 0.85+; a lexical (bag-of-words) embedder such as the Built-in TF-IDF profile
 * puts unrelated text near 0 and a restatement at ~0.4–0.6. Every memory
 * cut-off that depends on the scale — the recall floor, the R1 boost gate,
 * admission's bands, the consolidation cluster threshold — asks this one
 * question, so a new lexical provider is wired in one place
 * (builtin-tfidf-memory-tuning §1).
 *
 * Pure and client-safe.
 *
 * @module embedding/cosine-scale
 */

/** Providers whose vectors are lexical (term-weight) rather than neural. */
const LEXICAL_EMBEDDING_PROVIDERS: ReadonlySet<string> = new Set(['BUILTIN'])

/** True when `provider`'s vectors are on the lexical (TF-IDF) cosine scale. */
export function isLexicalEmbeddingProvider(provider: string | null | undefined): boolean {
  return !!provider && LEXICAL_EMBEDDING_PROVIDERS.has(provider)
}
