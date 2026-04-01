/**
 * Help Search Unit Tests
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { gzipSync } from 'node:zlib'
import { encode } from '@msgpack/msgpack'
import { HelpSearch, getHelpSearch, resetHelpSearch } from '@/lib/help-search'
import type { HelpBundle } from '@/lib/help-search.types'

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

/**
 * Create a test bundle with sample documents
 */
function createTestBundle(documentCount: number = 3, dimensions: number = 4): HelpBundle {
  const documents = []
  for (let i = 0; i < documentCount; i++) {
    // Create embeddings that will produce predictable similarity scores
    const embedding = new Array(dimensions).fill(0)
    embedding[i % dimensions] = 1 // One-hot encoding for easy testing

    documents.push({
      id: `doc-${i}`,
      title: `Document ${i}`,
      path: `help/doc-${i}.md`,
      content: `This is the content of document ${i}. It contains helpful information about topic ${i}.`,
      embedding,
    })
  }

  return {
    version: '2.0.0',
    generated: new Date().toISOString(),
    embeddingModel: 'test-model',
    embeddingDimensions: dimensions,
    documents,
  }
}

/**
 * Compress a bundle to the expected format
 */
function compressBundle(bundle: HelpBundle): Buffer {
  const encoded = encode(bundle)
  return gzipSync(Buffer.from(encoded))
}

describe('HelpSearch', () => {
  let helpSearch: HelpSearch

  beforeEach(() => {
    helpSearch = new HelpSearch()
  })

  afterEach(() => {
    resetHelpSearch()
  })

  describe('loadFromBuffer', () => {
    it('should load a valid bundle', async () => {
      const bundle = createTestBundle()
      const compressed = compressBundle(bundle)

      await helpSearch.loadFromBuffer(compressed)

      expect(helpSearch.isLoaded()).toBe(true)
    })

    it('should store bundle metadata correctly', async () => {
      const bundle = createTestBundle(5, 8)
      const compressed = compressBundle(bundle)

      await helpSearch.loadFromBuffer(compressed)

      const metadata = helpSearch.getMetadata()
      expect(metadata).not.toBeNull()
      expect(metadata?.version).toBe('2.0.0')
      expect(metadata?.embeddingModel).toBe('test-model')
      expect(metadata?.embeddingDimensions).toBe(8)
      expect(metadata?.documentCount).toBe(5)
    })
  })

  describe('isLoaded', () => {
    it('should return false before loading', () => {
      expect(helpSearch.isLoaded()).toBe(false)
    })

    it('should return true after loading', async () => {
      const bundle = createTestBundle()
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      expect(helpSearch.isLoaded()).toBe(true)
    })
  })

  describe('getMetadata', () => {
    it('should return null when not loaded', () => {
      expect(helpSearch.getMetadata()).toBeNull()
    })
  })

  describe('search', () => {
    it('should return empty array when bundle not loaded', () => {
      const results = helpSearch.search([1, 0, 0, 0])
      expect(results).toEqual([])
    })

    it('should return empty array for wrong dimension query', async () => {
      const bundle = createTestBundle(3, 4)
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      // Query with wrong dimensions
      const results = helpSearch.search([1, 0]) // Only 2 dimensions instead of 4
      expect(results).toEqual([])
    })

    it('should find the most similar document', async () => {
      const bundle = createTestBundle(3, 4)
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      // Query that matches doc-0's embedding exactly
      const results = helpSearch.search([1, 0, 0, 0])

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].document.id).toBe('doc-0')
      expect(results[0].score).toBe(1) // Perfect match
    })

    it('should return results sorted by score descending', async () => {
      const bundle = createTestBundle(3, 4)
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      // Query that partially matches multiple documents
      const results = helpSearch.search([0.5, 0.5, 0, 0])

      expect(results.length).toBe(3)
      // Scores should be in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
      }
    })

    it('should respect the limit parameter', async () => {
      const bundle = createTestBundle(10, 4)
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      const results = helpSearch.search([1, 0, 0, 0], 3)
      expect(results.length).toBe(3)
    })

    it('should return all documents when limit exceeds count', async () => {
      const bundle = createTestBundle(3, 4)
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      const results = helpSearch.search([1, 0, 0, 0], 100)
      expect(results.length).toBe(3)
    })
  })

  describe('getDocument', () => {
    it('should return null when bundle not loaded', () => {
      expect(helpSearch.getDocument('doc-0')).toBeNull()
    })

    it('should return null for non-existent ID', async () => {
      const bundle = createTestBundle()
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      expect(helpSearch.getDocument('non-existent')).toBeNull()
    })

    it('should return the correct document', async () => {
      const bundle = createTestBundle()
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      const doc = helpSearch.getDocument('doc-1')
      expect(doc).not.toBeNull()
      expect(doc?.id).toBe('doc-1')
      expect(doc?.title).toBe('Document 1')
    })
  })

  describe('getAllDocuments', () => {
    it('should return empty array when bundle not loaded', () => {
      expect(helpSearch.getAllDocuments()).toEqual([])
    })

    it('should return all documents without embeddings', async () => {
      const bundle = createTestBundle(3, 4)
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      const docs = helpSearch.getAllDocuments()
      expect(docs.length).toBe(3)

      for (const doc of docs) {
        expect(doc).toHaveProperty('id')
        expect(doc).toHaveProperty('title')
        expect(doc).toHaveProperty('path')
        expect(doc).toHaveProperty('content')
        expect(doc).not.toHaveProperty('embedding')
      }
    })
  })

  describe('listDocuments', () => {
    it('should return empty array when bundle not loaded', () => {
      expect(helpSearch.listDocuments()).toEqual([])
    })

    it('should return document listing', async () => {
      const bundle = createTestBundle(3, 4)
      await helpSearch.loadFromBuffer(compressBundle(bundle))

      const list = helpSearch.listDocuments()
      expect(list.length).toBe(3)

      for (const item of list) {
        expect(item).toHaveProperty('id')
        expect(item).toHaveProperty('title')
        expect(item).toHaveProperty('path')
        expect(item).not.toHaveProperty('content')
        expect(item).not.toHaveProperty('embedding')
      }
    })
  })
})

describe('Singleton', () => {
  afterEach(() => {
    resetHelpSearch()
  })

  it('should return the same instance', () => {
    const instance1 = getHelpSearch()
    const instance2 = getHelpSearch()
    expect(instance1).toBe(instance2)
  })

  it('should return a new instance after reset', () => {
    const instance1 = getHelpSearch()
    resetHelpSearch()
    const instance2 = getHelpSearch()
    expect(instance1).not.toBe(instance2)
  })
})
