import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:Chunker');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChunkResult {
  /** The text content of this chunk (may include overlap from previous chunk). */
  content: string;
  /** Estimated token count for this chunk. */
  tokenCount: number;
  /** Zero-based index of this chunk within the document. */
  chunkIndex: number;
  /** The most recent markdown heading above this chunk, or null if none. */
  headingContext: string | null;
}

export interface ChunkOptions {
  /** Minimum target tokens per chunk (default 800). */
  targetMinTokens?: number;
  /** Maximum target tokens per chunk (default 1200). */
  targetMaxTokens?: number;
  /** Tokens of overlap carried from one chunk to the next (default 200). */
  overlapTokens?: number;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;

/** Rough token estimate: 1 token ~ 4 characters. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Detect markdown-style headings (lines starting with one or more `#`). */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Split text at sentence boundaries (`.` `?` `!`) followed by whitespace.
 * Keeps each sentence as a separate element.
 */
function splitAtSentences(text: string): string[] {
  // Split after sentence-ending punctuation followed by space or end-of-string
  const parts = text.split(/(?<=[.?!])\s+/);
  return parts.filter((p) => p.length > 0);
}

/**
 * Split text at word boundaries when sentence splitting is still too coarse.
 */
function splitAtWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Break a single oversized paragraph into pieces that each fit within
 * `maxChars` characters.  Tries sentence boundaries first, then word
 * boundaries, and as a last resort hard-splits by character count.
 */
function breakOversizedBlock(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  // Try sentence-level splitting first
  const sentences = splitAtSentences(text);
  if (sentences.length > 1) {
    return assemblePieces(sentences, maxChars);
  }

  // Fall back to word-level splitting
  const words = splitAtWords(text);
  if (words.length > 1) {
    return assemblePieces(words, maxChars);
  }

  // Absolute fallback: hard split by character count
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    pieces.push(text.slice(i, i + maxChars));
  }
  return pieces;
}

/**
 * Greedily assemble an array of small pieces into blocks that stay under
 * `maxChars`.
 */
function assemblePieces(pieces: string[], maxChars: number): string[] {
  const blocks: string[] = [];
  let current = '';

  for (const piece of pieces) {
    const candidate = current.length === 0 ? piece : current + ' ' + piece;
    if (candidate.length > maxChars && current.length > 0) {
      blocks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    blocks.push(current);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Main chunking function
// ---------------------------------------------------------------------------

/**
 * Split a plain-text document into overlapping chunks suitable for embedding.
 *
 * The algorithm:
 * 1. Split input into paragraphs (double-newline boundaries).
 * 2. Track the most recent markdown-style heading (`# …`).
 * 3. Greedily accumulate paragraphs until `targetMaxTokens` is approached.
 * 4. Oversized single paragraphs are broken at sentence then word boundaries.
 * 5. Each successive chunk is prefixed with the last `overlapTokens` worth of
 *    text from the previous chunk for context continuity.
 */
export function chunkDocument(text: string, options?: ChunkOptions): ChunkResult[] {
  const targetMinTokens = options?.targetMinTokens ?? 800;
  const targetMaxTokens = options?.targetMaxTokens ?? 1200;
  const overlapTokens = options?.overlapTokens ?? 200;

  const maxChars = targetMaxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  // Handle empty / whitespace-only input
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Split into paragraphs
  const paragraphs = text.split(/\n{2,}/);

  // Small document that fits in a single chunk
  if (estimateTokens(text) <= targetMaxTokens) {
    // Determine heading from paragraphs
    let heading: string | null = null;
    for (const para of paragraphs) {
      const lines = para.split('\n');
      for (const line of lines) {
        const match = line.match(HEADING_RE);
        if (match) {
          heading = match[2].trim();
        }
      }
    }

    const trimmed = text.trim();
    return [
      {
        content: trimmed,
        tokenCount: estimateTokens(trimmed),
        chunkIndex: 0,
        headingContext: heading,
      },
    ];
  }

  // Greedy accumulation
  const chunks: ChunkResult[] = [];
  let currentContent = '';
  let currentHeading: string | null = null;
  let chunkHeading: string | null = null; // heading assigned to the chunk being built

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (trimmedPara.length === 0) {
      continue;
    }

    // Detect heading within this paragraph (a paragraph can contain
    // multiple lines, e.g. a heading followed by body text that wasn't
    // separated by a blank line).
    const lines = trimmedPara.split('\n');
    for (const line of lines) {
      const match = line.match(HEADING_RE);
      if (match) {
        currentHeading = match[2].trim();
      }
    }

    // If this single paragraph is oversized, break it up
    const blocks =
      trimmedPara.length > maxChars
        ? breakOversizedBlock(trimmedPara, maxChars)
        : [trimmedPara];

    for (const block of blocks) {
      const candidate =
        currentContent.length === 0 ? block : currentContent + '\n\n' + block;

      if (candidate.length > maxChars && currentContent.length > 0) {
        // Flush current chunk
        flushChunk(currentContent, chunkHeading);
        // Start new chunk with overlap prefix
        const overlap = extractOverlap(currentContent, overlapChars);
        currentContent = overlap.length > 0 ? overlap + '\n\n' + block : block;
        chunkHeading = currentHeading;
      } else {
        currentContent = candidate;
        if (chunkHeading === null) {
          chunkHeading = currentHeading;
        }
      }
    }
  }

  // Flush remaining content
  if (currentContent.trim().length > 0) {
    flushChunk(currentContent, chunkHeading);
  }

  return chunks;

  // -----------------------------------------------------------------------
  // Inner helpers that close over `chunks`
  // -----------------------------------------------------------------------

  function flushChunk(content: string, heading: string | null) {
    const trimmed = content.trim();
    if (trimmed.length === 0) return;
    chunks.push({
      content: trimmed,
      tokenCount: estimateTokens(trimmed),
      chunkIndex: chunks.length,
      headingContext: heading,
    });
  }

  function extractOverlap(content: string, chars: number): string {
    if (chars <= 0 || content.length === 0) return '';
    if (content.length <= chars) return content;
    // Take the last `chars` characters, then trim to a word boundary
    const tail = content.slice(-chars);
    const firstSpace = tail.indexOf(' ');
    if (firstSpace > 0 && firstSpace < tail.length - 1) {
      return tail.slice(firstSpace + 1);
    }
    return tail;
  }
}
