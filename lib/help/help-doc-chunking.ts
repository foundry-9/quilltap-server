/**
 * Help Document Chunking
 *
 * Slices a help document into section-sized pieces for embedding.
 *
 * Help docs are long and topically broad — a settings page can cover a dozen
 * unrelated subsystems — so a single whole-document embedding is a smear that
 * matches any specific question only weakly. Chunking gives each section its
 * own vector, which is what lets "how do I describe an image for a model that
 * can't see?" land on the paragraph that answers it.
 *
 * Sections are also the only help text sent to an embedding provider: a doc's
 * own vector is the average of its sections' (see the HELP_DOC branch of
 * `lib/background-jobs/handlers/embedding-generate.ts`), because a whole page
 * can outrun a provider's input ceiling and a section cannot (bug 168).
 *
 * The chunker itself is the Scriptorium's (`lib/mount-index/chunker.ts`) —
 * same Markdown-aware paragraph accumulation, same heading tracking, same
 * overlap. Only the size targets differ.
 *
 * @module lib/help/help-doc-chunking
 */

import { chunkDocument } from '@/lib/mount-index/chunker'

/**
 * Size targets for help chunks, deliberately smaller than the Scriptorium's
 * 800–1200 defaults.
 *
 * Help sections are short — a settings subsection runs a few hundred words —
 * and the whole point here is precision, so a chunk that swallows four
 * unrelated settings sections defeats the exercise. The overlap keeps a
 * paragraph that straddles a boundary reachable from both sides.
 */
export const HELP_CHUNK_OPTIONS = {
  targetMinTokens: 400,
  targetMaxTokens: 700,
  overlapTokens: 100,
} as const

/**
 * The most tokens (OpenAI `cl100k_base`) the embedding text of any one help
 * section may run to — title path included, as {@link helpChunkEmbeddingText}
 * builds it.
 *
 * Sections are the only help text ever sent to an embedding provider (a doc's
 * own vector is the average of its sections'), so this is the one size limit
 * the help set has to respect. The chunker aims for at most
 * `targetMaxTokens` by its own estimate; this ceiling leaves headroom over that
 * while staying far below the 8,192-token input of OpenAI's embedding models.
 * `__tests__/unit/lib/help/help-doc-size.test.ts` holds every file in `help/`
 * to it.
 */
export const HELP_SECTION_EMBEDDING_MAX_TOKENS = 1000

/** One slice of a help document, ready to be persisted. */
export interface HelpDocChunkDraft {
  chunkIndex: number
  heading: string | null
  content: string
}

/**
 * Split a help document into chunk drafts.
 *
 * The title is not prepended here — it is added at embedding time, so the
 * stored chunk text stays a faithful excerpt of the document (which is what
 * gets shown back to a reader).
 *
 * @param content The document body, frontmatter already stripped
 * @returns Chunk drafts in document order; empty for empty input
 */
export function buildHelpDocChunks(content: string): HelpDocChunkDraft[] {
  return chunkDocument(content, HELP_CHUNK_OPTIONS).map(chunk => ({
    chunkIndex: chunk.chunkIndex,
    heading: chunk.headingContext,
    content: chunk.content,
  }))
}

/**
 * The text actually handed to the embedding provider for a chunk.
 *
 * Title and heading are prefixed so a chunk carries the context a reader would
 * have from the page around it — "Uncensored fallback profile" means little on
 * its own, but a great deal under "Chat Settings › Image Description Settings".
 */
export function helpChunkEmbeddingText(
  docTitle: string,
  heading: string | null | undefined,
  content: string
): string {
  const path = heading ? `${docTitle} › ${heading}` : docTitle
  return `${path}\n\n${content}`
}
