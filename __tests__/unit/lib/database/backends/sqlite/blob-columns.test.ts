/**
 * BLOB Column Utilities Unit Tests
 *
 * Tests Float32 BLOB serialization/deserialization for embedding storage.
 */

import { describe, it, expect } from '@jest/globals'
import { embeddingToBlob, blobToEmbedding, documentToRow, parseLegacyEmbeddingText } from '@/lib/database/backends/sqlite/json-columns'

describe('embeddingToBlob', () => {
  it('converts a number array to a Buffer', () => {
    const embedding = [1.0, 2.0, 3.0]
    const blob = embeddingToBlob(embedding)

    expect(Buffer.isBuffer(blob)).toBe(true)
    expect(blob.byteLength).toBe(3 * 4) // 3 floats × 4 bytes each
  })

  it('handles empty arrays', () => {
    const blob = embeddingToBlob([])
    expect(Buffer.isBuffer(blob)).toBe(true)
    expect(blob.byteLength).toBe(0)
  })

  it('handles large embeddings', () => {
    const embedding = Array.from({ length: 1536 }, (_, i) => Math.random())
    const blob = embeddingToBlob(embedding)

    expect(blob.byteLength).toBe(1536 * 4)
  })
})

describe('blobToEmbedding', () => {
  it('converts a Buffer back to a Float32Array', () => {
    const original = [1.0, 2.0, 3.0]
    const blob = embeddingToBlob(original)
    const result = blobToEmbedding(blob)

    expect(result).toBeInstanceOf(Float32Array)
    expect(result).toHaveLength(3)
    expect(result[0]).toBeCloseTo(1.0, 5)
    expect(result[1]).toBeCloseTo(2.0, 5)
    expect(result[2]).toBeCloseTo(3.0, 5)
  })

  it('handles empty buffers', () => {
    const blob = Buffer.alloc(0)
    const result = blobToEmbedding(blob)

    expect(result).toBeInstanceOf(Float32Array)
    expect(result).toHaveLength(0)
  })
})

describe('embeddingToBlob/blobToEmbedding round-trip', () => {
  it('preserves values through round-trip (Float32 precision)', () => {
    // Note: Float32 has ~7 decimal digits of precision
    const original = [0.123456789, -0.987654321, 0.0, 1.0, -1.0]
    const roundTripped = blobToEmbedding(embeddingToBlob(original))

    expect(roundTripped).toHaveLength(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(roundTripped[i]).toBeCloseTo(original[i], 5) // Float32 precision
    }
  })

  it('preserves typical embedding values through round-trip', () => {
    // Simulated embedding output from an LLM
    const original = Array.from({ length: 768 }, () => (Math.random() - 0.5) * 2)
    const roundTripped = blobToEmbedding(embeddingToBlob(original))

    expect(roundTripped).toHaveLength(768)
    for (let i = 0; i < original.length; i++) {
      expect(roundTripped[i]).toBeCloseTo(original[i], 5)
    }
  })

  it('is significantly smaller than JSON text', () => {
    const embedding = Array.from({ length: 1536 }, () => Math.random())
    const jsonSize = Buffer.byteLength(JSON.stringify(embedding), 'utf8')
    const blobSize = embeddingToBlob(embedding).byteLength

    // BLOB should be ~4-5x smaller than JSON
    expect(blobSize).toBeLessThan(jsonSize / 3)
    expect(blobSize).toBe(1536 * 4) // Exact: 4 bytes per float
  })
})

describe('documentToRow with blobColumns', () => {
  it('converts embedding arrays to Buffers when in blobColumns set', () => {
    const doc = {
      id: 'test',
      embedding: [1.0, 2.0, 3.0],
      name: 'test',
    }
    const blobColumns = new Set(['embedding'])
    const row = documentToRow(doc, [], blobColumns)

    expect(Buffer.isBuffer(row.embedding)).toBe(true)
    expect(typeof row.name).toBe('string')
    expect(typeof row.id).toBe('string')
  })

  it('passes through Buffer values in blobColumns', () => {
    const blob = Buffer.from([1, 2, 3])
    const doc = {
      id: 'test',
      embedding: blob,
    }
    const blobColumns = new Set(['embedding'])
    const row = documentToRow(doc, [], blobColumns)

    expect(row.embedding).toBe(blob)
  })

  it('does not convert arrays outside blobColumns set', () => {
    const doc = {
      id: 'test',
      tags: ['a', 'b'],
      embedding: [1.0, 2.0],
    }
    const blobColumns = new Set(['embedding'])
    const row = documentToRow(doc, ['tags'], blobColumns)

    expect(typeof row.tags).toBe('string') // JSON serialized
    expect(Buffer.isBuffer(row.embedding)).toBe(true) // BLOB
  })

  it('handles null embedding in blobColumns', () => {
    const doc = {
      id: 'test',
      embedding: null,
    }
    const blobColumns = new Set(['embedding'])
    const row = documentToRow(doc, [], blobColumns)

    expect(row.embedding).toBeNull()
  })
})

describe('parseLegacyEmbeddingText', () => {
  it('parses the JSON-array legacy shape', () => {
    const result = parseLegacyEmbeddingText('[0.1, 0.2, 0.3]')
    expect(result).toEqual([0.1, 0.2, 0.3])
  })

  it('recovers the index-keyed object shape left by JSON.stringify(Float32Array)', () => {
    // JSON.stringify(new Float32Array([...])) yields {"0":..,"1":..,...}.
    const original = new Float32Array([0.5, -0.25, 0.125, 0.0625])
    const legacyText = JSON.stringify(original)
    expect(legacyText.startsWith('{')).toBe(true) // confirms the object shape

    const result = parseLegacyEmbeddingText(legacyText)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(4)
    // Values come back in index order.
    expect((result as number[])[0]).toBeCloseTo(0.5, 5)
    expect((result as number[])[1]).toBeCloseTo(-0.25, 5)
    expect((result as number[])[3]).toBeCloseTo(0.0625, 5)
  })

  it('preserves index order for a large index-keyed object', () => {
    const dims = 1024
    const original = Array.from({ length: dims }, (_, i) => i / dims)
    const legacyText = JSON.stringify(new Float32Array(original))
    const result = parseLegacyEmbeddingText(legacyText) as number[]

    expect(result).toHaveLength(dims)
    expect(result[0]).toBeCloseTo(0, 5)
    expect(result[512]).toBeCloseTo(512 / dims, 5)
    expect(result[dims - 1]).toBeCloseTo((dims - 1) / dims, 5)
  })

  it('returns undefined for unparseable or non-embedding text', () => {
    expect(parseLegacyEmbeddingText('not json')).toBeUndefined()
    expect(parseLegacyEmbeddingText('42')).toBeUndefined()
    expect(parseLegacyEmbeddingText('"a string"')).toBeUndefined()
    expect(parseLegacyEmbeddingText('null')).toBeUndefined()
  })

  it('round-trips an index-keyed object back into a Float32 BLOB', () => {
    const original = [0.1, 0.2, 0.3, 0.4]
    const legacyText = JSON.stringify(new Float32Array(original))
    const recovered = parseLegacyEmbeddingText(legacyText) as number[]
    const roundTripped = blobToEmbedding(embeddingToBlob(recovered))

    expect(roundTripped).toHaveLength(4)
    for (let i = 0; i < original.length; i++) {
      expect(roundTripped[i]).toBeCloseTo(original[i], 5)
    }
  })
})
