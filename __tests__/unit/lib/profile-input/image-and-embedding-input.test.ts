/**
 * Image and embedding profile bodies validate through one schema per kind,
 * shared by create and update (`lib/image-gen/image-profile-input.ts`,
 * `lib/embedding/embedding-profile-input.ts`).
 */

import { ImageProfileCreateSchema, ImageProfileUpdateSchema } from '@/lib/image-gen/image-profile-input'
import { EmbeddingProfileCreateSchema, EmbeddingProfileUpdateSchema } from '@/lib/embedding/embedding-profile-input'

const KEY = '44444444-4444-4444-8444-444444444444'

describe('image profile input', () => {
  const minimal = { name: ' Pics ', provider: 'OPENAI', modelName: 'dall-e-3' }

  it('creates with defaults and trimmed strings', () => {
    expect(ImageProfileCreateSchema.parse(minimal)).toEqual({
      name: 'Pics', provider: 'OPENAI', modelName: 'dall-e-3', parameters: {}, isDefault: false, isDangerousCompatible: false,
    })
  })

  it('accepts the editor form: an empty key and URL are cleared', () => {
    const parsed = ImageProfileCreateSchema.parse({ ...minimal, apiKeyId: '', baseUrl: '' })
    expect(parsed.apiKeyId).toBeNull()
    expect(parsed.baseUrl).toBeNull()
  })

  it('refuses a malformed LoRA list with the issue under parameters.loras', () => {
    const result = ImageProfileCreateSchema.safeParse({ ...minimal, parameters: { loras: [{ source: '', scale: 1 }] } })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0].path.slice(0, 2)).toEqual(['parameters', 'loras'])
  })

  it.each([
    [{ parameters: [] }],
    [{ parameters: null }],
    [{ isDefault: 'yes' }],
    [{ apiKeyId: 'not-a-uuid' }],
    [{ stray: true }],
  ])('refuses %j', (extra) => {
    expect(ImageProfileCreateSchema.safeParse({ ...minimal, ...extra }).success).toBe(false)
  })

  it('updates only what was sent, and clears with an empty key', () => {
    expect(ImageProfileUpdateSchema.parse({ isDefault: true })).toEqual({ isDefault: true })
    expect(ImageProfileUpdateSchema.parse({ apiKeyId: '' })).toEqual({ apiKeyId: null })
    expect(ImageProfileUpdateSchema.parse({ apiKeyId: KEY })).toEqual({ apiKeyId: KEY })
  })
})

describe('embedding profile input', () => {
  const minimal = { name: 'Vectors', provider: 'OPENAI', modelName: 'text-embedding-3-small' }

  it('creates with defaults', () => {
    expect(EmbeddingProfileCreateSchema.parse(minimal)).toEqual({ ...minimal, normalizeL2: true, isDefault: false })
  })

  it.each([
    [{ provider: 'ACME' }],
    [{ dimensions: 0 }],
    [{ dimensions: 'big' }],
    [{ truncateToDimensions: 1.5 }],
    [{ normalizeL2: 'no' }],
    [{ stray: 1 }],
  ])('refuses %j', (extra) => {
    expect(EmbeddingProfileCreateSchema.safeParse({ ...minimal, ...extra }).success).toBe(false)
  })

  it('distinguishes an absent field from a cleared one on update', () => {
    expect(EmbeddingProfileUpdateSchema.parse({ isDefault: true })).toEqual({ isDefault: true })
    expect(EmbeddingProfileUpdateSchema.parse({ dimensions: null, baseUrl: null, apiKeyId: null })).toEqual({
      dimensions: null, baseUrl: null, apiKeyId: null,
    })
  })
})
