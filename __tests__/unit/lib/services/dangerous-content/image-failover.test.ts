/**
 * generateImageWithConciergeFailover — the one image failover chokepoint.
 * Detection, the Auto-Route gate, understudy resolution, the trail and the
 * Concierge's announcement; the call itself is the caller's closure.
 */



jest.mock('@/lib/services/dangerous-content/understudy', () => ({
  resolveUncensoredImageUnderstudy: jest.fn(),
  resolveUncensoredTextUnderstudy: jest.fn(),
}))
jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeRefusalAnnouncement: jest.fn(async () => null),
}))

import { resolveUncensoredImageUnderstudy } from '@/lib/services/dangerous-content/understudy'
import { postConciergeRefusalAnnouncement } from '@/lib/services/concierge-notifications/writer'
import {
  generateImageWithConciergeFailover,
  getConciergeTrail,
} from '@/lib/services/dangerous-content/image-failover'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import type { ImageProfile } from '@/lib/schemas/types'

const mockResolve = jest.mocked(resolveUncensoredImageUnderstudy)
const mockAnnounce = jest.mocked(postConciergeRefusalAnnouncement)

const PRIMARY = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'House Painter',
  provider: 'GOOGLE',
  modelName: 'gemini-2.5-flash-image',
} as unknown as ImageProfile
const UNDERSTUDY = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Kestrel Studio',
  provider: 'GROK',
  modelName: 'grok-2-image',
} as unknown as ImageProfile

const settings = (mode: DangerousContentSettings['mode']) => ({ mode } as DangerousContentSettings)
const ctx = (mode: DangerousContentSettings['mode'] = 'AUTO_ROUTE') => ({
  userId: 'user-1',
  chatId: 'chat-1',
  purpose: 'tool' as const,
  settings: settings(mode),
})

const refusal = () => Object.assign(new Error('Gemini image blocked'), {
  code: 'MODERATION_REJECTED',
  providerReason: 'IMAGE_SAFETY',
})

beforeEach(() => {
  jest.clearAllMocks()
  mockResolve.mockResolvedValue({ profile: UNDERSTUDY, apiKey: 'sk-understudy' } as never)
})

describe('generateImageWithConciergeFailover', () => {
  it('primary answers → no trail, no announcement, no lookup', async () => {
    const attempt = jest.fn(async () => 'picture')
    const outcome = await generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'sk-p' }, attempt, ctx())
    expect(outcome).toMatchObject({ result: 'picture', rerouted: false, trail: [] })
    expect(outcome.profile).toBe(PRIMARY)
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('refused under DETECT_ONLY → refusal-not-permitted, rethrow with trail', async () => {
    const err = refusal()
    const attempt = jest.fn(async () => { throw err })
    await expect(generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx('DETECT_ONLY')))
      .rejects.toBe(err)
    expect(getConciergeTrail(err)).toEqual([
      expect.objectContaining({
        profileId: PRIMARY.id, outcome: 'refused', trigger: 'moderation-refusal',
        evidence: 'typed-error', profileKind: 'image', via: 'primary',
      }),
    ])
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refusal-not-permitted', chatId: 'chat-1' }))
  })

  it('refused with no understudy → refusal-no-understudy, rethrow', async () => {
    mockResolve.mockResolvedValue(null as never)
    const attempt = jest.fn(async () => { throw refusal() })
    await expect(generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx()))
      .rejects.toThrow('Gemini image blocked')
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ exclude: [PRIMARY.id] }))
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refusal-no-understudy' }))
  })

  it('refused, understudy answers → rerouted, two-entry trail, refusal-rerouted', async () => {
    const attempt = jest.fn(async (profile: ImageProfile, key: string) => {
      if (profile.id === PRIMARY.id) throw refusal()
      return `picture by ${profile.name} with ${key}`
    })
    const outcome = await generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx())
    expect(outcome.rerouted).toBe(true)
    expect(outcome.result).toBe('picture by Kestrel Studio with sk-understudy')
    expect(outcome.profile).toBe(UNDERSTUDY)
    expect(outcome.trail.map((a) => [a.profileName, a.via, a.outcome])).toEqual([
      ['House Painter', 'primary', 'refused'],
      ['Kestrel Studio', 'concierge', 'answered'],
    ])
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'refusal-rerouted',
      details: expect.objectContaining({
        refusingProvider: 'GOOGLE', refusingModel: 'gemini-2.5-flash-image',
        answeringProfileName: 'Kestrel Studio', purpose: 'tool',
      }),
    }))
  })

  it('refused, understudy refuses too → rethrow with the full trail', async () => {
    const attempt = jest.fn(async (profile: ImageProfile) => {
      if (profile.id === PRIMARY.id) throw refusal()
      throw new Error('Generated image rejected by content moderation.')
    })
    let caught: unknown
    try {
      await generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx())
    } catch (e) {
      caught = e
    }
    expect((caught as Error).message).toContain('content moderation')
    expect(getConciergeTrail(caught)!.map((a) => [a.profileName, a.outcome, a.evidence])).toEqual([
      ['House Painter', 'refused', 'typed-error'],
      ['Kestrel Studio', 'refused', 'message-pattern'],
    ])
    expect(mockAnnounce).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'refusal-rerouted' }))
  })

  it('an understudy that fails for another reason is recorded as failed', async () => {
    const attempt = jest.fn(async (profile: ImageProfile) => {
      if (profile.id === PRIMARY.id) throw refusal()
      throw new Error('503 Service Unavailable')
    })
    const err = await generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx())
      .catch((e) => e)
    expect(getConciergeTrail(err)![1]).toMatchObject({ outcome: 'failed', trigger: 'provider-error' })
  })

  it('a non-refusal error is rethrown untouched and nothing is posted', async () => {
    const err = Object.assign(new Error('429 Too Many Requests'), { status: 429 })
    const attempt = jest.fn(async () => { throw err })
    await expect(generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx()))
      .rejects.toBe(err)
    expect(getConciergeTrail(err)).toBeNull()
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('announces nothing without a chat, but still reroutes', async () => {
    const attempt = jest.fn(async (profile: ImageProfile) => {
      if (profile.id === PRIMARY.id) throw refusal()
      return 'ok'
    })
    const outcome = await generateImageWithConciergeFailover(
      { profile: PRIMARY, apiKey: 'k' },
      attempt,
      { ...ctx(), chatId: null, purpose: 'dialog' },
    )
    expect(outcome.rerouted).toBe(true)
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('uses a caller-supplied understudy resolver and profile kind', async () => {
    const custom = jest.fn(async (_exclude: string[]) => ({ profile: UNDERSTUDY, apiKey: 'sk-custom' }))
    const attempt = jest.fn(async (profile: ImageProfile) => {
      if (profile.id === PRIMARY.id) throw refusal()
      return 'ok'
    })
    const outcome = await generateImageWithConciergeFailover(
      { profile: PRIMARY, apiKey: 'k' },
      attempt,
      { ...ctx(), resolveUnderstudy: custom, profileKind: 'connection', primaryVia: 'concierge' },
    )
    expect(custom).toHaveBeenCalledWith([PRIMARY.id])
    expect(mockResolve).not.toHaveBeenCalled()
    expect(outcome.trail[0]).toMatchObject({ via: 'concierge' })
    expect(outcome.trail.every((a) => a.profileKind === undefined)).toBe(true)
  })
})
