/**
 * generateImageWithConciergeFailover — the one image failover chokepoint.
 * Detection, the Concierge-policy gate, understudy resolution, the trail and the
 * Concierge's announcement; the call itself is the caller's closure.
 */



jest.mock('@/lib/services/dangerous-content/understudy', () => ({
  resolveUncensoredImageUnderstudy: jest.fn(),
  resolveUncensoredTextUnderstudy: jest.fn(),
}))
jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeRefusalAnnouncement: jest.fn(async () => null),
}))
// The refusal-time state read; by default it agrees with the snapshot.
jest.mock('@/lib/services/dangerous-content/current-state', () => ({
  readCurrentConciergeState: jest.fn(async (_chatId: unknown, snapshot?: string | null) => snapshot ?? 'moderated'),
  readCurrentConciergeOnDuty: jest.fn(async (_userId: unknown, snapshot: boolean) => snapshot),
}))
jest.mock('@/lib/services/dangerous-content/refusal-ledger', () => ({
  recordModerationRefusal: jest.fn(async () => ({ count: 1, switched: false })),
}))

import { resolveUncensoredImageUnderstudy } from '@/lib/services/dangerous-content/understudy'
import { postConciergeRefusalAnnouncement } from '@/lib/services/concierge-notifications/writer'
import { recordModerationRefusal } from '@/lib/services/dangerous-content/refusal-ledger'
import { readCurrentConciergeOnDuty, readCurrentConciergeState } from '@/lib/services/dangerous-content/current-state'
import {
  generateImageWithConciergeFailover,
  getConciergeTrail,
} from '@/lib/services/dangerous-content/image-failover'
import {
  DEFAULT_CONCIERGE_SETTINGS,
  resolveConciergeSettings,
} from '@/lib/services/dangerous-content/resolver.service'
import type { ImageProfile } from '@/lib/schemas/types'

const mockResolve = jest.mocked(resolveUncensoredImageUnderstudy)
const mockAnnounce = jest.mocked(postConciergeRefusalAnnouncement)
const mockLedger = jest.mocked(recordModerationRefusal)

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

type Duty = 'on-duty' | 'off-duty' | 'locked-snapshot'
const policy = (duty: Duty) =>
  resolveConciergeSettings(
    { conciergeSettings: { ...DEFAULT_CONCIERGE_SETTINGS, enabled: duty !== 'off-duty' } },
    duty === 'locked-snapshot' ? { conciergeMode: 'locked' } : undefined,
  )
const ctx = (duty: Duty = 'on-duty') => ({
  userId: 'user-1',
  chatId: 'chat-1',
  purpose: 'tool' as const,
  conciergePolicy: policy(duty),
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

  it('refused while the Concierge is off duty → no announcement, rethrow with trail', async () => {
    const err = refusal()
    const attempt = jest.fn(async () => { throw err })
    await expect(generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx('off-duty')))
      .rejects.toBe(err)
    expect(getConciergeTrail(err)).toEqual([
      expect.objectContaining({
        profileId: PRIMARY.id, outcome: 'refused', trigger: 'moderation-refusal',
        evidence: 'typed-error', profileKind: 'image', via: 'primary',
      }),
    ])
    expect(mockResolve).not.toHaveBeenCalled()
    // Off duty means the Concierge does nothing at all, announcements included.
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('refused after the Concierge was sent off duty mid-call → no understudy, no announcement', async () => {
    jest.mocked(readCurrentConciergeOnDuty).mockResolvedValueOnce(false)
    const err = refusal()
    const attempt = jest.fn(async () => { throw err })
    await expect(generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx()))
      .rejects.toBe(err)
    expect(readCurrentConciergeOnDuty).toHaveBeenCalledWith('user-1', true)
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('refused on a Locked chat → refusal-not-permitted (reason locked), never resolves an understudy', async () => {
    const err = refusal()
    const attempt = jest.fn(async () => { throw err })
    // Even with the Concierge on duty, Locked wins.
    await expect(generateImageWithConciergeFailover(
      { profile: PRIMARY, apiKey: 'k' },
      attempt,
      { ...ctx(), chat: { conciergeMode: 'locked' } },
    )).rejects.toBe(err)
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'refusal-not-permitted',
      chatId: 'chat-1',
      details: expect.objectContaining({ reason: 'locked' }),
    }))
    expect(getConciergeTrail(err)).toHaveLength(1)
  })

  it('reads the state at refusal time: a chat locked while the provider was thinking never fails over', async () => {
    jest.mocked(readCurrentConciergeState).mockResolvedValueOnce('locked')
    const err = refusal()
    await expect(generateImageWithConciergeFailover(
      { profile: PRIMARY, apiKey: 'k' },
      jest.fn(async () => { throw err }),
      { ...ctx(), chat: { conciergeMode: 'moderated' } },
    )).rejects.toBe(err)
    expect(readCurrentConciergeState).toHaveBeenCalledWith('chat-1', 'moderated')
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'refusal-not-permitted',
      details: expect.objectContaining({ reason: 'locked' }),
    }))
  })

  it('a chat unlocked while the provider was thinking fails over, though its snapshot policy was Locked', async () => {
    jest.mocked(readCurrentConciergeState).mockResolvedValueOnce('moderated')
    const attempt = jest.fn(async (profile: ImageProfile) => {
      if (profile.id === PRIMARY.id) throw refusal()
      return 'picture'
    })
    const outcome = await generateImageWithConciergeFailover(
      { profile: PRIMARY, apiKey: 'k' },
      attempt,
      { ...ctx('locked-snapshot'), chat: { conciergeMode: 'locked' } },
    )
    expect(outcome.rerouted).toBe(true)
  })

  it('refused on an Unmoderated chat still asks another uncensored understudy', async () => {
    const attempt = jest.fn(async (profile: ImageProfile) => {
      if (profile.id === PRIMARY.id) throw refusal()
      return 'picture'
    })
    const outcome = await generateImageWithConciergeFailover(
      { profile: PRIMARY, apiKey: 'k' },
      attempt,
      { ...ctx(), chat: { conciergeMode: 'unmoderated' } },
    )
    expect(outcome.rerouted).toBe(true)
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

  describe('the refusal ledger', () => {
    const refusingRow = expect.objectContaining({
      chatId: 'chat-1',
      kind: 'image',
      purpose: 'tool',
      refusedProfileId: PRIMARY.id,
      refusedProfileName: 'House Painter',
      provider: 'GOOGLE',
      modelName: 'gemini-2.5-flash-image',
      evidence: 'typed-error',
    })

    it('records the primary refusal once when the reroute answers', async () => {
      const attempt = jest.fn(async (profile: ImageProfile) => {
        if (profile.id === PRIMARY.id) throw refusal()
        return 'ok'
      })
      await generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx())
      expect(mockLedger).toHaveBeenCalledTimes(1)
      expect(mockLedger).toHaveBeenCalledWith(refusingRow)
      expect(mockLedger.mock.calls[0][0].rerouted).toBe(true)
    })

    it.each([
      ['not permitted', () => ctx('off-duty'), () => undefined],
      ['no understudy', () => ctx(), () => mockResolve.mockResolvedValue(null as never)],
    ])('records the refusal when %s', async (_label, makeCtx, arrange) => {
      arrange()
      const attempt = jest.fn(async () => { throw refusal() })
      await generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, makeCtx()).catch(() => undefined)
      expect(mockLedger).toHaveBeenCalledTimes(1)
      expect(mockLedger.mock.calls[0][0]).toMatchObject({ rerouted: false, evidence: 'typed-error' })
    })

    it('records the primary (not the understudy) when both refuse', async () => {
      const attempt = jest.fn(async (profile: ImageProfile) => {
        if (profile.id === PRIMARY.id) throw refusal()
        throw new Error('Generated image rejected by content moderation.')
      })
      await generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, attempt, ctx()).catch(() => undefined)
      expect(mockLedger).toHaveBeenCalledTimes(1)
      expect(mockLedger).toHaveBeenCalledWith(refusingRow)
    })

    it('records nothing for a non-refusal failure, or without a chat', async () => {
      const busy = jest.fn(async () => { throw Object.assign(new Error('429'), { status: 429 }) })
      await generateImageWithConciergeFailover({ profile: PRIMARY, apiKey: 'k' }, busy, ctx()).catch(() => undefined)
      const refused = jest.fn(async (profile: ImageProfile) => {
        if (profile.id === PRIMARY.id) throw refusal()
        return 'ok'
      })
      await generateImageWithConciergeFailover(
        { profile: PRIMARY, apiKey: 'k' }, refused, { ...ctx(), chatId: null, purpose: 'dialog' },
      )
      expect(mockLedger).not.toHaveBeenCalled()
    })
  })
})
