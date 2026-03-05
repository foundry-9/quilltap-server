/**
 * Help Search Types
 *
 * TypeScript interfaces for the help documentation search system.
 * Used by both the build script and runtime loader.
 */

/**
 * A single help document with its embedding
 */
export interface HelpDocument {
  /** Unique document ID (derived from filename) */
  id: string
  /** Document title (from first H1 or filename) */
  title: string
  /** Relative path to the Markdown file */
  path: string
  /** URL route this help document is associated with */
  url: string
  /** Full document content */
  content: string
  /** Embedding vector */
  embedding: number[]
}

/**
 * The complete help bundle structure
 */
export interface HelpBundle {
  /** Bundle format version */
  version: string
  /** ISO timestamp when bundle was generated */
  generated: string
  /** OpenAI embedding model used */
  embeddingModel: string
  /** Number of dimensions in each embedding vector */
  embeddingDimensions: number
  /** All help documents with their embeddings */
  documents: HelpDocument[]
}

/**
 * Search result returned by semantic search
 */
export interface HelpSearchResult {
  /** The matching document */
  document: HelpDocument
  /** Cosine similarity score (0-1, higher is more similar) */
  score: number
}
