/**
 * The one text a memory is embedded as.
 *
 * `summary\n\ncontent`, plus the episodic anchor line
 * (`(when: 2026-07-14 · place: Lighthouse Point)`) when the memory carries
 * any anchor. Admission, the create paths, re-embeds, reinforcement,
 * `EMBEDDING_GENERATE`, the TF-IDF refit and the anchor probe all call this:
 * a writer that embeds a different shape gives the gate vectors it never
 * compares like with like (bug 204).
 *
 * The Built-in (TF-IDF) profile embeds the same text without its anchor line:
 * see {@link lexicalEmbeddingText}.
 *
 * Pure and I/O-free, so it is safe in the job child.
 *
 * @module memory/index-store/embedding-text
 */

import { buildMemoryAnchorLine, isMemoryAnchorLine, type EpisodicAnchorView } from '../episodic'

/** The fields a memory's embedded text is built from. Anchors are optional. */
export interface EmbeddingTextSource extends EpisodicAnchorView {
  summary: string
  content: string
}

/**
 * Build the canonical embedded text for a memory.
 *
 * `timeZone` is the memory-calendar zone the anchor date renders in. Every
 * caller resolves it with `refreshMemoryTimeZone()` first, so a cold job
 * child embeds the same date the parent would; absent, the cached zone (or its
 * env/system fallback) applies.
 *
 * Legacy rows embedded before anchors existed keep their anchorless vectors
 * until they are next re-embedded; mixed rows are an accepted state.
 */
export function embeddingTextFor(memory: EmbeddingTextSource, timeZone?: string): string {
  const base = `${memory.summary}\n\n${memory.content}`
  const anchorLine = buildMemoryAnchorLine(
    {
      occurredAt: memory.occurredAt ?? null,
      narrativeTime: memory.narrativeTime ?? null,
      entities: memory.entities ?? null,
    },
    timeZone,
  )
  return anchorLine ? `${base}\n${anchorLine}` : base
}

/**
 * The text a lexical (TF-IDF) embedder sees: `text` without a trailing
 * memory anchor line, any other text unchanged.
 *
 * In a bag-of-words vector the anchor line's rare tokens — dates, place
 * names, and the bigrams joining them to the content — carry a large share of
 * a short memory's weight, so two tellings of one fact on different days
 * score far apart and unrelated facts sharing a place score close. A neural
 * embedder reads the line as context; a lexical one cannot. Admission's date
 * guard reads `occurredAt` directly and recall finds entity names by text, so
 * nothing lexical needs the line. Applied by the BUILTIN embed path and the
 * vocabulary refit, never to a neural profile's text.
 */
export function lexicalEmbeddingText(text: string): string {
  const cut = text.lastIndexOf('\n')
  if (cut < 0) return text
  return isMemoryAnchorLine(text.slice(cut + 1)) ? text.slice(0, cut) : text
}
