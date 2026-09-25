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

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => ({
    imageProfiles: {
      findAll: jest.fn().mockResolvedValue([
        { id: 'img-same-model', provider: 'GOOGLE', modelName: 'imagen' },
        { id: 'img-other', provider: 'OPENROUTER', modelName: 'flux' },
      ]),
    },
  })),
}))
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
  connections: {
    findAll: jest.fn().mockResolvedValue([
      // Reassigned since: the character now points elsewhere, but this profile
      // is on the model that answered the target.
      { id: 'old-profile', provider: 'OPENAI', modelName: 'gpt-answered' },
      { id: 'unrelated', provider: 'OPENROUTER', modelName: 'free-model' },
    ]),
  },
} as never

const target = {
  id: 'msg-1',
  role: 'ASSISTANT',
  participantId: 'seat-1',
  provider: 'OPENAI',
  modelName: 'gpt-answered',
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
    expect(new Set(lookup.exclude)).toEqual(new Set(['refuser', 'tier', 'responder-profile', 'old-profile']))
    expect(lookup.userId).toBe('u1')
  })

  it('works whatever the duty roster says: off duty still offers the configured desk', async () => {
    mockText.mockResolvedValue(UNDERSTUDY as never)
    const result = await resolveTextRetryUnderstudy({
      repos,
      userId: 'u1',
      chat: makeChat(),
      chatSettings: { conciergeSettings: { enabled: false, uncensoredTextProfileId: 'desk-1' } } as never,
      targetMessage: target,
    })
    expect(result.ok).toBe(true)
    // The off-duty policy's desk is empty; the retry's must not be.
    expect(mockText.mock.calls[0][0].conciergePolicy.desk.textProfileId).toBe('desk-1')
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

  it('excludes every image profile on the model that drew the original', async () => {
    mockImage.mockResolvedValue(UNDERSTUDY as never)
    await resolveImageRetryUnderstudy({
      userId: 'u1',
      chat: makeChat(),
      chatSettings: null,
      excludeProfileIds: ['img-1'],
      answeredBy: { provider: 'GOOGLE', modelName: 'imagen' },
    })
    expect(new Set(mockImage.mock.calls[0][0].exclude)).toEqual(new Set(['img-1', 'img-same-model']))
  })

  it('offers the configured image desk while the Concierge is off duty', async () => {
    mockImage.mockResolvedValue(UNDERSTUDY as never)
    await resolveImageRetryUnderstudy({
      userId: 'u1',
      chat: makeChat(),
      chatSettings: { conciergeSettings: { enabled: false, uncensoredImageProfileId: 'desk-img' } } as never,
      excludeProfileIds: [],
    })
    expect(mockImage.mock.calls[0][0].conciergePolicy.desk.imageProfileId).toBe('desk-img')
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
