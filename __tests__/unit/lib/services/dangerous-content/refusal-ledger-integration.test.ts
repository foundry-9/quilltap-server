/**
 * The refusal ledger end to end, with mocked providers: the image failover
 * chokepoint, the ledger, the auto-switch and `applyConciergeFlip` all run for
 * real; only the repositories, the understudy lookup and the announcement
 * writers are fakes.
 *
 * Two refused pictures on a Moderated chat → the second moves the chat to
 * Unmoderated (set by the Concierge, for refusals) with one auto-switch bubble;
 * the third picture, whose caller now reads the chat as Unmoderated and sends it
 * straight to the uncensored desk, records no refusal at all.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeManualAnnouncement: jest.fn(async () => null),
  postConciergeRefusalAnnouncement: jest.fn(async () => null),
  postConciergeDangerAnnouncement: jest.fn(async () => null),
}))
jest.mock('@/lib/services/dangerous-content/understudy', () => ({
  resolveUncensoredImageUnderstudy: jest.fn(),
  resolveUncensoredTextUnderstudy: jest.fn(),
}))

import { getRepositories } from '@/lib/repositories/factory'
import {
  postConciergeManualAnnouncement,
  postConciergeRefusalAnnouncement,
} from '@/lib/services/concierge-notifications/writer'
import { resolveUncensoredImageUnderstudy } from '@/lib/services/dangerous-content/understudy'
import { generateImageWithConciergeFailover } from '@/lib/services/dangerous-content/image-failover'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service'
import type { ImageProfile } from '@/lib/schemas/types'

const HOUSE = { id: 'house', name: 'House Painter', provider: 'GOOGLE', modelName: 'imagen' } as unknown as ImageProfile
const FRANK = { id: 'frank', name: 'Kestrel Studio', provider: 'GROK', modelName: 'grok-image' } as unknown as ImageProfile

let chat: {
  id: string
  userId: string
  messageCount: number
  isDangerousChat: boolean
  conciergeMode: 'moderated' | 'unmoderated' | 'locked' | null
  conciergeModeSetBy: 'operator' | 'concierge' | null
  conciergeModeReason: string | null
  chatType: string
}
let ledger: number
const increment = jest.fn(async () => ++ledger)

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.QUILLTAP_JOB_CHILD
  chat = {
    id: 'chat-1', userId: 'user-1', messageCount: 3, isDangerousChat: false,
    conciergeMode: null, conciergeModeSetBy: null, conciergeModeReason: null, chatType: 'salon',
  }
  ledger = 0
  jest.mocked(getRepositories).mockReturnValue({
    chats: {
      findById: jest.fn(async () => ({ ...chat })),
      update: jest.fn(async (_id: string, patch: object) => { chat = { ...chat, ...patch }; return chat }),
      setConciergeMode: jest.fn(async (_id: string, cols: object, expected?: string) => {
        if (expected && ((chat as { conciergeMode?: string | null }).conciergeMode ?? 'moderated') !== expected) return false
        chat = { ...chat, ...cols }
        return true
      }),
      incrementModerationRefusalCount: increment,
      getModerationRefusalLedger: jest.fn(async () => ({ count: ledger, lastAt: null })),
      resetModerationRefusalLedger: jest.fn(),
    },
    chatSettings: {
      findByUserId: jest.fn(async () => ({
        conciergeSettings: { enabled: true, autoSwitchAfterRefusals: 2 },
      })),
    },
  } as never)
  jest.mocked(resolveUncensoredImageUnderstudy).mockResolvedValue({ profile: FRANK, apiKey: 'sk-frank' } as never)
})

/** The house painter refuses on content grounds; the frank desk always obliges. */
const attempt = jest.fn(async (profile: ImageProfile) => {
  if (profile.id === HOUSE.id) {
    throw Object.assign(new Error('blocked'), { code: 'MODERATION_REJECTED' })
  }
  return `picture by ${profile.name}`
})

/** What a call site does: an Unmoderated chat's picture goes to the uncensored desk first. */
async function commissionPicture() {
  const primary = shouldUseUncensoredRoute(chat)
    ? { profile: FRANK, apiKey: 'sk-frank' }
    : { profile: HOUSE, apiKey: 'sk-house' }
  return generateImageWithConciergeFailover(primary, attempt, {
    userId: 'user-1',
    chatId: 'chat-1',
    purpose: 'tool',
    conciergePolicy: resolveConciergeSettings({ conciergeSettings: { enabled: true } } as never, chat),
  })
}

const autoFlags = () =>
  jest.mocked(postConciergeManualAnnouncement).mock.calls.filter(([a]) => a.kind === 'auto-unmoderated')

describe('refusal ledger — two refused pictures switch the chat', () => {
  it('flips on the second refusal, once, and the third picture records nothing', async () => {
    const first = await commissionPicture()
    expect(first.rerouted).toBe(true)
    expect(chat.conciergeMode).toBeNull()
    expect(autoFlags()).toHaveLength(0)

    const second = await commissionPicture()
    expect(second.rerouted).toBe(true)
    expect(chat.conciergeMode).toBe('unmoderated')
    expect(chat.conciergeModeSetBy).toBe('concierge')
    expect(chat.conciergeModeReason).toBe('refusals')
    expect(autoFlags()).toHaveLength(1)
    expect(autoFlags()[0][0].details).toEqual({ count: 2, lastProvider: 'GOOGLE', lastModel: 'imagen' })

    const third = await commissionPicture()
    expect(third.rerouted).toBe(false)
    expect(third.profile).toBe(FRANK)
    expect(increment).toHaveBeenCalledTimes(2)
    expect(autoFlags()).toHaveLength(1)
    expect(postConciergeRefusalAnnouncement).toHaveBeenCalledTimes(2)
  })
})
