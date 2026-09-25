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
import {
  DEFAULT_CONCIERGE_SETTINGS,
  resolveConciergeSettings,
  type ResolvedConciergePolicy,
} from '@/lib/services/dangerous-content/resolver.service'
import type { ConciergeSettings } from '@/lib/schemas/settings.types'

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

const settings = (
  extra: Partial<ConciergeSettings> = {},
  conciergeMode: 'moderated' | 'unmoderated' | 'locked' = 'moderated',
): ResolvedConciergePolicy =>
  resolveConciergeSettings(
    { conciergeSettings: { ...DEFAULT_CONCIERGE_SETTINGS, ...extra } },
    { conciergeMode },
  )

beforeEach(() => {
  jest.clearAllMocks()
})

describe('resolveUncensoredImageUnderstudy', () => {
  it('prefers the configured profile over the scan', async () => {
    wire({ images: [img('scan', { isDangerousCompatible: true }), img('explicit')] })
    const result = await resolveUncensoredImageUnderstudy({
      userId: USER,
      conciergePolicy: settings({ uncensoredImageProfileId: 'explicit' }),
    })
    expect(result?.profile.id).toBe('explicit')
    expect(result?.apiKey).toBe('sk-key-explicit')
  })

  it('scans for a compatible profile when nothing is configured', async () => {
    wire({ images: [img('plain'), img('compatible', { isDangerousCompatible: true })] })
    const result = await resolveUncensoredImageUnderstudy({ userId: USER, conciergePolicy: settings() })
    expect(result?.profile.id).toBe('compatible')
  })

  it('skips excluded ids — the configured one included', async () => {
    wire({ images: [img('explicit', { isDangerousCompatible: true }), img('other', { isDangerousCompatible: true })] })
    const result = await resolveUncensoredImageUnderstudy({
      userId: USER,
      conciergePolicy: settings({ uncensoredImageProfileId: 'explicit' }),
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
    const result = await resolveUncensoredImageUnderstudy({ userId: USER, conciergePolicy: settings() })
    expect(result?.profile.id).toBe('good')
  })

  it('returns null when nothing qualifies', async () => {
    wire({ images: [img('plain')] })
    expect(await resolveUncensoredImageUnderstudy({ userId: USER, conciergePolicy: settings() })).toBeNull()
  })

  it('never reads the policy gates: the same answer off duty, Moderated, Unmoderated and Locked', async () => {
    wire({ images: [img('compatible', { isDangerousCompatible: true })] })
    const policies = [
      settings({ enabled: false }),
      settings({}, 'moderated'),
      settings({}, 'unmoderated'),
      settings({}, 'locked'),
    ]
    for (const conciergePolicy of policies) {
      const result = await resolveUncensoredImageUnderstudy({ userId: USER, conciergePolicy })
      expect(result?.profile.id).toBe('compatible')
    }
  })

  it('swallows a failed read as "nobody to ask"', async () => {
    const repos = wire({})
    repos.imageProfiles.findAll.mockRejectedValue(new Error('db down') as never)
    expect(await resolveUncensoredImageUnderstudy({ userId: USER, conciergePolicy: settings() })).toBeNull()
  })
})

describe('resolveUncensoredTextUnderstudy', () => {
  it('prefers the configured profile over the scan', async () => {
    wire({ connections: [conn('scan', { isDangerousCompatible: true }), conn('explicit')] })
    const result = await resolveUncensoredTextUnderstudy({
      userId: USER,
      conciergePolicy: settings({ uncensoredTextProfileId: 'explicit' }),
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
      conciergePolicy: settings({ uncensoredTextProfileId: 'courier' }),
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
      conciergePolicy: settings(),
      turnAttachmentMimeTypes: ['image/png'],
    })
    expect(withImages?.profile.id).toBe('vision')
    const plain = await resolveUncensoredTextUnderstudy({ userId: USER, conciergePolicy: settings() })
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
      conciergePolicy: settings({ uncensoredTextProfileId: 'explicit' }),
      filter: (p) => p.provider === 'GROK',
    })
    expect(result?.profile.id).toBe('drawer')
  })

  it('returns null when every candidate is excluded', async () => {
    wire({ connections: [conn('only', { isDangerousCompatible: true })] })
    expect(await resolveUncensoredTextUnderstudy({
      userId: USER,
      conciergePolicy: settings(),
      exclude: ['only'],
    })).toBeNull()
  })
})
