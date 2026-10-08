/**
 * @jest-environment node
 *
 * Bug 181: backups written before the fix carry memory embeddings as
 * JSON.stringify(Float32Array) output — an index-keyed object. The restore
 * decodes exactly that shape and leaves everything else for MemorySchema.
 */

import { decodeIndexKeyedEmbedding } from '@/lib/backup/restore/index-keyed-embedding';
import { MemorySchema } from '@/lib/schemas/memory.types';

describe('decodeIndexKeyedEmbedding', () => {
  it('decodes the JSON round-trip of a Float32Array', () => {
    const wire = JSON.parse(JSON.stringify(new Float32Array([0.25, -0.5, 1])));
    expect(Array.isArray(wire)).toBe(false);
    expect(decodeIndexKeyedEmbedding(wire)).toEqual([0.25, -0.5, 1]);
  });

  it('decodes keys in any order', () => {
    expect(decodeIndexKeyedEmbedding({ '1': 2, '0': 1 })).toEqual([1, 2]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number[]', [0.1, 0.2]],
    ['a string', '[0.1,0.2]'],
    ['an empty object', {}],
    ['a gap in the keys', { '0': 1, '2': 3 }],
    ['a non-canonical key', { '00': 1 }],
    ['a negative key', { '-1': 1 }],
    ['a non-numeric key', { '0': 1, dims: 2 }],
    ['a non-number value', { '0': 1, '1': 'x' }],
    ['a non-finite value', { '0': Number.NaN }],
  ])('leaves %s unchanged', (_label, value) => {
    expect(decodeIndexKeyedEmbedding(value)).toBe(value);
  });

  it('leaves a Float32Array unchanged', () => {
    const vec = new Float32Array([0.5]);
    expect(decodeIndexKeyedEmbedding(vec)).toBe(vec);
  });

  it('produces an embedding MemorySchema accepts, where the raw shape is refused', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      characterId: '00000000-0000-4000-8000-000000000002',
      content: 'Embedded.',
      summary: 'Embedded.',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    const wire = { '0': 0.25, '1': -0.5 };
    expect(MemorySchema.safeParse({ ...base, embedding: wire }).success).toBe(false);
    const parsed = MemorySchema.safeParse({ ...base, embedding: decodeIndexKeyedEmbedding(wire) });
    expect(parsed.success).toBe(true);
    expect(parsed.success && Array.from(parsed.data.embedding as Float32Array)).toEqual([0.25, -0.5]);
  });
});
