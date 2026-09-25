/**
 * The uncensored understudy resolver: one order for text and images — the
 * configured profile, then any `isDangerousCompatible` one, then nobody — and
 * never a policy decision of its own.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
// A profile "can carry" an image exactly when it says it takes uploads — the
// real predicate also consults the provider registry, which is not loaded here.
jest.mock('@/lib/llm/image-transport', () => ({
  profileCanReceiveAttachment: (p: { supportsImageUpload?: boolean }, mime: string) =>
    !mime.startsWith('image/') || p.supportsImageUpload === true,
}))

import { getRepositories } from '@/lib/repositories/factory'
import {
  resolveUncensoredImageUnderstudy,
  resolveUncensoredTextUnderstudy,
} from '@/lib/services/dangerous-content/understudy'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

const USER = 'user-1'

function conn(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId: USER,
    name: `Profile ${id}`,
    provider: 'OPENAI',
    modelName: 'gpt-4o',
    apiKeyId: `key-${id}`,
    transport: 'api',
    isDangerousCompatible: false,
    supportsImageUpload: false,
    ...extra,
  }
}

function img(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId: USER,
    name: `Image ${id}`,
    provider: 'OPENAI',
    modelName: 'gpt-image-1',
    apiKeyId: `key-${id}`,
    isDangerousCompatible: false,
    ...extra,
  }
}

function wire(opts: {
  connections?: ReturnType<typeof conn>[]
  images?: ReturnType<typeof img>[]
  keyless?: string[]
}) {
  const connections = opts.connections ?? []
  const images = opts.images ?? []
  const keyless = new Set(opts.keyless ?? [])
  const repos = {
    connections: {
      findById: jest.fn(async (id: string) => connections.find((c) => c.id === id) ?? null),
      findAll: jest.fn(async () => connections),
      findApiKeyByIdAndUserId: jest.fn(async (keyId: string) =>
        keyless.has(keyId) ? null : { key_value: `sk-${keyId}` }),
    },
    imageProfiles: {
      findById: jest.fn(async (id: string) => images.find((p) => p.id === id) ?? null),
      findAll: jest.fn(async () => images),
    },
  }
  ;(getRepositories as jest.Mock).mockReturnValue(repos)
  return repos
}

const settings = (extra: Partial<DangerousContentSettings> = {}): DangerousContentSettings => ({
  mode: 'OFF',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('resolveUncensoredImageUnderstudy', () => {
  it('prefers the configured profile over the scan', async () => {
    wire({ images: [img('scan', { isDangerousCompatible: true }), img('explicit')] })
    const result = await resolveUncensoredImageUnderstudy({
      userId: USER,
      settings: settings({ uncensoredImageProfileId: 'explicit' }),
    })
    expect(result?.profile.id).toBe('explicit')
    expect(result?.apiKey).toBe('sk-key-explicit')
  })

  it('scans for a compatible profile when nothing is configured', async () => {
    wire({ images: [img('plain'), img('compatible', { isDangerousCompatible: true })] })
    const result = await resolveUncensoredImageUnderstudy({ userId: USER, settings: settings() })
    expect(result?.profile.id).toBe('compatible')
  })

  it('skips excluded ids — the configured one included', async () => {
    wire({ images: [img('explicit', { isDangerousCompatible: true }), img('other', { isDangerousCompatible: true })] })
    const result = await resolveUncensoredImageUnderstudy({
      userId: USER,
      settings: settings({ uncensoredImageProfileId: 'explicit' }),
      exclude: ['explicit'],
    })
    expect(result?.profile.id).toBe('other')
  })

  it('skips profiles without a usable key and profiles owned by someone else', async () => {
    wire({
      images: [
        img('keyless', { isDangerousCompatible: true }),
        img('foreign', { isDangerousCompatible: true, userId: 'someone-else' }),
        img('good', { isDangerousCompatible: true }),
      ],
      keyless: ['key-keyless'],
    })
    const result = await resolveUncensoredImageUnderstudy({ userId: USER, settings: settings() })
    expect(result?.profile.id).toBe('good')
  })

  it('returns null when nothing qualifies', async () => {
    wire({ images: [img('plain')] })
    expect(await resolveUncensoredImageUnderstudy({ userId: USER, settings: settings() })).toBeNull()
  })

  it('never reads the mode: the same answer under OFF, DETECT_ONLY and AUTO_ROUTE', async () => {
    wire({ images: [img('compatible', { isDangerousCompatible: true })] })
    for (const mode of ['OFF', 'DETECT_ONLY', 'AUTO_ROUTE'] as const) {
      const result = await resolveUncensoredImageUnderstudy({ userId: USER, settings: settings({ mode }) })
      expect(result?.profile.id).toBe('compatible')
    }
  })

  it('swallows a failed read as "nobody to ask"', async () => {
    const repos = wire({})
    repos.imageProfiles.findAll.mockRejectedValue(new Error('db down') as never)
    expect(await resolveUncensoredImageUnderstudy({ userId: USER, settings: settings() })).toBeNull()
  })
})

describe('resolveUncensoredTextUnderstudy', () => {
  it('prefers the configured profile over the scan', async () => {
    wire({ connections: [conn('scan', { isDangerousCompatible: true }), conn('explicit')] })
    const result = await resolveUncensoredTextUnderstudy({
      userId: USER,
      settings: settings({ uncensoredTextProfileId: 'explicit' }),
    })
    expect(result?.profile.id).toBe('explicit')
  })

  it('skips courier-transport profiles, even the configured one', async () => {
    wire({
      connections: [
        conn('courier', { isDangerousCompatible: true, transport: 'courier' }),
        conn('api', { isDangerousCompatible: true }),
      ],
    })
    const result = await resolveUncensoredTextUnderstudy({
      userId: USER,
      settings: settings({ uncensoredTextProfileId: 'courier' }),
    })
    expect(result?.profile.id).toBe('api')
  })

  it('orders attachment-capable profiles first when the turn carries images', async () => {
    wire({
      connections: [
        conn('text-only', { isDangerousCompatible: true, provider: 'OLLAMA' }),
        conn('vision', { isDangerousCompatible: true, supportsImageUpload: true }),
      ],
    })
    const withImages = await resolveUncensoredTextUnderstudy({
      userId: USER,
      settings: settings(),
      turnAttachmentMimeTypes: ['image/png'],
    })
    expect(withImages?.profile.id).toBe('vision')
    const plain = await resolveUncensoredTextUnderstudy({ userId: USER, settings: settings() })
    expect(plain?.profile.id).toBe('text-only')
  })

  it('applies an extra filter to the explicit pick and the scan alike', async () => {
    wire({
      connections: [
        conn('explicit', { provider: 'ANTHROPIC' }),
        conn('drawer', { isDangerousCompatible: true, provider: 'GROK' }),
      ],
    })
    const result = await resolveUncensoredTextUnderstudy({
      userId: USER,
      settings: settings({ uncensoredTextProfileId: 'explicit' }),
      filter: (p) => p.provider === 'GROK',
    })
    expect(result?.profile.id).toBe('drawer')
  })

  it('returns null when every candidate is excluded', async () => {
    wire({ connections: [conn('only', { isDangerousCompatible: true })] })
    expect(await resolveUncensoredTextUnderstudy({
      userId: USER,
      settings: settings(),
      exclude: ['only'],
    })).toBeNull()
  })
})
