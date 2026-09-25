/**
 * "Try uncensored" — the gate and the understudy lookup behind the Salon's
 * per-request escape hatch (concierge-overhaul phase 5).
 *
 * The resolver runs for real; the understudy lookup is mocked so each test can
 * say who is (or is not) available and read back what was excluded.
 */

import {
  composeRetryRouteTrail,
  mayRetryUncensored,
  resolveImageRetryUnderstudy,
  resolveTextRetryUnderstudy,
} from '@/lib/services/dangerous-content/retry-uncensored'
import {
  resolveUncensoredImageUnderstudy,
  resolveUncensoredTextUnderstudy,
} from '@/lib/services/dangerous-content/understudy'

jest.mock('@/lib/services/dangerous-content/understudy', () => ({
  resolveUncensoredTextUnderstudy: jest.fn(),
  resolveUncensoredImageUnderstudy: jest.fn(),
}))

const mockText = jest.mocked(resolveUncensoredTextUnderstudy)
const mockImage = jest.mocked(resolveUncensoredImageUnderstudy)

const UNDERSTUDY = {
  profile: { id: 'desk-1', name: 'The Back Room', provider: 'OPENROUTER', modelName: 'free-model' },
  apiKey: 'sk-desk',
}

function makeChat(conciergeMode: 'moderated' | 'unmoderated' | 'locked' = 'moderated') {
  return {
    id: 'chat-1',
    conciergeMode,
    participants: [
      { id: 'seat-1', type: 'CHARACTER', characterId: 'char-1', connectionProfileId: null },
    ],
  } as never
}

const repos = {
  characters: {
    findById: jest.fn().mockResolvedValue({ id: 'char-1', defaultConnectionProfileId: 'responder-profile' }),
  },
} as never

const target = {
  id: 'msg-1',
  role: 'ASSISTANT',
  participantId: 'seat-1',
  routeTrail: [
    { profileId: 'refuser', profileName: 'Prim', provider: 'OPENAI', modelName: 'gpt', via: 'primary', outcome: 'refused' },
    { profileId: 'tier', profileName: 'Tier', provider: 'OPENAI', modelName: 'mini', via: 'tier-pick', outcome: 'answered' },
  ],
} as never

beforeEach(() => {
  jest.clearAllMocks()
})

describe('mayRetryUncensored', () => {
  it('refuses only a Locked chat', () => {
    expect(mayRetryUncensored({ conciergeMode: 'moderated' })).toBe(true)
    expect(mayRetryUncensored({ conciergeMode: 'unmoderated' })).toBe(true)
    expect(mayRetryUncensored({ conciergeMode: null })).toBe(true)
    expect(mayRetryUncensored({ conciergeMode: 'locked' })).toBe(false)
  })
})

describe('resolveTextRetryUnderstudy', () => {
  it('refuses a Locked chat without looking for anyone', async () => {
    const result = await resolveTextRetryUnderstudy({
      repos, userId: 'u1', chat: makeChat('locked'), chatSettings: null, targetMessage: target,
    })
    expect(result).toEqual({ ok: false, reason: 'locked' })
    expect(mockText).not.toHaveBeenCalled()
  })

  it('says no-understudy when nobody can take it', async () => {
    mockText.mockResolvedValue(null)
    const result = await resolveTextRetryUnderstudy({
      repos, userId: 'u1', chat: makeChat(), chatSettings: null, targetMessage: target,
    })
    expect(result).toEqual({ ok: false, reason: 'no-understudy' })
  })

  it('excludes the responder\'s profile and every profile on the trail', async () => {
    mockText.mockResolvedValue(UNDERSTUDY as never)
    const result = await resolveTextRetryUnderstudy({
      repos, userId: 'u1', chat: makeChat(), chatSettings: null, targetMessage: target,
    })
    expect(result).toEqual({ ok: true, understudy: UNDERSTUDY })
    const lookup = mockText.mock.calls[0][0]
    expect(new Set(lookup.exclude)).toEqual(new Set(['refuser', 'tier', 'responder-profile']))
    expect(lookup.userId).toBe('u1')
  })

  it('works whatever the duty roster says: off duty does not bar the operator', async () => {
    mockText.mockResolvedValue(UNDERSTUDY as never)
    const result = await resolveTextRetryUnderstudy({
      repos,
      userId: 'u1',
      chat: makeChat(),
      chatSettings: { conciergeSettings: { enabled: false } } as never,
      targetMessage: target,
    })
    expect(result.ok).toBe(true)
  })
})

describe('resolveImageRetryUnderstudy', () => {
  it('refuses a Locked chat', async () => {
    const result = await resolveImageRetryUnderstudy({
      userId: 'u1', chat: makeChat('locked'), chatSettings: null, excludeProfileIds: ['img-1'],
    })
    expect(result).toEqual({ ok: false, reason: 'locked' })
    expect(mockImage).not.toHaveBeenCalled()
  })

  it('excludes the chat\'s image profile and the image profiles on the trail only', async () => {
    mockImage.mockResolvedValue(UNDERSTUDY as never)
    await resolveImageRetryUnderstudy({
      userId: 'u1',
      chat: makeChat(),
      chatSettings: null,
      excludeProfileIds: ['img-1', null, undefined],
      trail: [
        { profileId: 'img-refuser', profileName: 'P', provider: 'GOOGLE', modelName: 'imagen', via: 'primary', outcome: 'refused', profileKind: 'image' },
        { profileId: 'text-profile', profileName: 'T', provider: 'OPENAI', modelName: 'gpt', via: 'primary', outcome: 'refused' },
      ],
    })
    expect(new Set(mockImage.mock.calls[0][0].exclude)).toEqual(new Set(['img-1', 'img-refuser']))
  })
})

describe('composeRetryRouteTrail', () => {
  it('keeps the original\'s failures and ends on the understudy, via the Concierge', () => {
    const trail = composeRetryRouteTrail(
      (target as unknown as { routeTrail: never }).routeTrail,
      UNDERSTUDY.profile,
      'image',
    )
    expect(trail.map(a => [a.profileId, a.outcome, a.via])).toEqual([
      ['refuser', 'refused', 'primary'],
      ['desk-1', 'answered', 'concierge'],
    ])
    expect(trail[1].profileKind).toBe('image')
  })

  it('is a single Concierge row when the original had no trail', () => {
    const trail = composeRetryRouteTrail(null, UNDERSTUDY.profile, 'connection')
    expect(trail).toEqual([expect.objectContaining({ profileId: 'desk-1', via: 'concierge', outcome: 'answered' })])
    expect(trail[0].profileKind).toBeUndefined()
  })
})
