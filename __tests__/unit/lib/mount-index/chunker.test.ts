/**
 * Unit tests for lib/mount-index/chunker.ts
 *
 * Tests for chunkDocument, estimateTokens, heading context tracking,
 * overlap, and oversized-block splitting.
 */

import { describe, it, expect } from '@jest/globals'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

import { chunkDocument, estimateTokens } from '@/lib/mount-index/chunker'

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('returns ceil(length / 4)', () => {
    // 12 chars → ceil(12 / 4) = 3
    expect(estimateTokens('hello world!')).toBe(3)
    // 13 chars → ceil(13 / 4) = 4
    expect(estimateTokens('hello world!!')).toBe(4)
  })

  it('handles a single character', () => {
    expect(estimateTokens('x')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// chunkDocument — edge cases
// ---------------------------------------------------------------------------

describe('chunkDocument', () => {
  it('returns empty array for empty string', () => {
    expect(chunkDocument('')).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(chunkDocument('   \n  \t  ')).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Single-chunk documents (fits within targetMaxTokens)
  // ---------------------------------------------------------------------------

  it('returns a single chunk when document is small', () => {
    const text = 'This is a short document.'
    const chunks = chunkDocument(text, { targetMaxTokens: 1200 })

    expect(chunks).toHaveLength(1)
    expect(chunks[0].chunkIndex).toBe(0)
    expect(chunks[0].content).toBe(text.trim())
    expect(chunks[0].tokenCount).toBe(estimateTokens(text.trim()))
  })

  it('single-chunk result has null headingContext when there is no heading', () => {
    const text = 'No headings here at all.'
    const [chunk] = chunkDocument(text, { targetMaxTokens: 1200 })
    expect(chunk.headingContext).toBeNull()
  })

  it('single-chunk result captures the heading when document has one', () => {
    const text = '# My Title\n\nSome body text.'
    const [chunk] = chunkDocument(text, { targetMaxTokens: 1200 })
    expect(chunk.headingContext).toBe('My Title')
  })

  it('single-chunk result captures the last heading when there are multiple', () => {
    const text = '# First\n\nParagraph one.\n\n## Second\n\nParagraph two.'
    const [chunk] = chunkDocument(text, { targetMaxTokens: 1200 })
    expect(chunk.headingContext).toBe('Second')
  })

  // ---------------------------------------------------------------------------
  // Multi-chunk documents
  // ---------------------------------------------------------------------------

  /**
   * Build a document that definitely exceeds targetMaxTokens so we exercise
   * the greedy accumulation loop.
   *
   * Each paragraph is ~100 characters (25 tokens).  With targetMaxTokens=60,
   * we should get more than one chunk.
   */
  function makeLargeDoc(paragraphCount: number, charsPerParagraph = 100): string {
    const para = 'x'.repeat(charsPerParagraph)
    return Array.from({ length: paragraphCount }, () => para).join('\n\n')
  }

  it('produces multiple chunks for a large document', () => {
    const text = makeLargeDoc(20) // 20 × 100 chars = 2000 chars ~ 500 tokens
    const chunks = chunkDocument(text, {
      targetMinTokens: 50,
      targetMaxTokens: 80,
      overlapTokens: 0,
    })
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('assigns monotonically increasing chunkIndex values', () => {
    const text = makeLargeDoc(20)
    const chunks = chunkDocument(text, {
      targetMinTokens: 50,
      targetMaxTokens: 80,
      overlapTokens: 0,
    })
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i)
    }
  })

  it('each chunk tokenCount matches estimateTokens of its content', () => {
    const text = makeLargeDoc(20)
    const chunks = chunkDocument(text, {
      targetMinTokens: 50,
      targetMaxTokens: 80,
      overlapTokens: 0,
    })
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBe(estimateTokens(chunk.content))
    }
  })

  // ---------------------------------------------------------------------------
  // Heading context in multi-chunk mode
  // ---------------------------------------------------------------------------

  it('carries heading context into chunks following a heading paragraph', () => {
    // Build: heading + many filler paragraphs (force multiple chunks)
    const filler = 'y'.repeat(100)
    const fillerParagraphs = Array.from({ length: 20 }, () => filler).join('\n\n')
    const text = `# Chapter One\n\n${fillerParagraphs}`

    const chunks = chunkDocument(text, {
      targetMinTokens: 50,
      targetMaxTokens: 80,
      overlapTokens: 0,
    })

    // At least the first chunk should carry the heading
    expect(chunks[0].headingContext).toBe('Chapter One')
  })

  it('updates heading context when a new heading appears mid-document', () => {
    // Two sections each with enough content to force ≥2 chunks
    const para = 'z'.repeat(100)
    const section1 = Array.from({ length: 10 }, () => para).join('\n\n')
    const section2 = Array.from({ length: 10 }, () => para).join('\n\n')
    const text = `# Section One\n\n${section1}\n\n# Section Two\n\n${section2}`

    const chunks = chunkDocument(text, {
      targetMinTokens: 50,
      targetMaxTokens: 80,
      overlapTokens: 0,
    })

    // There should be chunks for both sections
    const headings = chunks.map(c => c.headingContext)
    expect(headings).toContain('Section One')
    expect(headings).toContain('Section Two')
  })

  // ---------------------------------------------------------------------------
  // Overlap
  // ---------------------------------------------------------------------------

  it('includes overlap text from the previous chunk in the next chunk', () => {
    // Build a document with clearly distinct paragraphs so we can detect
    // whether the second chunk contains a tail of the first chunk.
    // Each paragraph is 200 chars (~50 tokens); targetMaxTokens=80 (320 chars)
    // so two paragraphs fill one chunk and the third starts a new one.
    const para = (n: number) => String(n).repeat(200) // paragraph made of repeated digit
    const paragraphs = Array.from({ length: 10 }, (_, i) => para(i))
    const text = paragraphs.join('\n\n')

    const chunksNoOverlap = chunkDocument(text, {
      targetMinTokens: 40,
      targetMaxTokens: 80,
      overlapTokens: 0,
    })
    const chunksWithOverlap = chunkDocument(text, {
      targetMinTokens: 40,
      targetMaxTokens: 80,
      overlapTokens: 20,
    })

    // With overlap enabled, every chunk after the first should start with
    // some content that also appears in the tail of the preceding chunk.
    expect(chunksWithOverlap.length).toBeGreaterThan(1)
    for (let i = 1; i < chunksWithOverlap.length; i++) {
      const prevChunk = chunksWithOverlap[i - 1]
      const currChunk = chunksWithOverlap[i]
      // Take last 10 chars of prev chunk (safely below overlapTokens)
      const prevTail = prevChunk.content.slice(-10)
      expect(currChunk.content).toContain(prevTail)
    }

    // Without overlap, second chunk should NOT start with the first chunk's tail
    if (chunksNoOverlap.length > 1) {
      const firstTail = chunksNoOverlap[0].content.slice(-10)
      expect(chunksNoOverlap[1].content.startsWith(firstTail)).toBe(false)
    }
  })

  // ---------------------------------------------------------------------------
  // Oversized single paragraph
  // ---------------------------------------------------------------------------

  it('handles an oversized single paragraph without crashing', () => {
    // One enormous paragraph — no double newlines — forces hard splitting
    const text = 'word '.repeat(1000).trim()
    const chunks = chunkDocument(text, {
      targetMinTokens: 50,
      targetMaxTokens: 80,
      overlapTokens: 0,
    })
    expect(chunks.length).toBeGreaterThan(0)
    // All content should be recoverable
    const combined = chunks.map(c => c.content).join(' ')
    // Every word from the original text should appear somewhere
    expect(combined).toContain('word')
  })

  it('handles a paragraph that is exactly targetMaxTokens long', () => {
    // 80 tokens * 4 chars = 320 characters → exactly at the boundary
    const text = 'x'.repeat(320)
    const chunks = chunkDocument(text, {
      targetMinTokens: 50,
      targetMaxTokens: 80,
      overlapTokens: 0,
    })
    // Should produce at least one chunk without error
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })

  // ---------------------------------------------------------------------------
  // Heading level variants (# through ######)
  // ---------------------------------------------------------------------------

  it.each(['#', '##', '###', '####', '#####', '######'])(
    'recognises %s heading syntax',
    (marker) => {
      const text = `${marker} My Heading\n\nSome content here.`
      const [chunk] = chunkDocument(text, { targetMaxTokens: 1200 })
      expect(chunk.headingContext).toBe('My Heading')
    }
  )

  // ---------------------------------------------------------------------------
  // Custom option defaults
  // ---------------------------------------------------------------------------

  it('uses sensible defaults when no options are provided', () => {
    const text = 'Short doc with no options passed.'
    const chunks = chunkDocument(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].chunkIndex).toBe(0)
  })
})
