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
 * Pure and I/O-free, so it is safe in the job child.
 *
 * @module memory/index-store/embedding-text
 */

import { buildMemoryAnchorLine, type EpisodicAnchorView } from '../episodic'

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
