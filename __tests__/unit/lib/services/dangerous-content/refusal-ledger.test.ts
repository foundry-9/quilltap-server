/**
 * The Concierge's refusal ledger — what counts, who decides, and when a chat
 * is switched. `applyConciergeFlip`, `getConciergeState` and the settings
 * resolver run for real; the repositories and the announcement writer are fakes.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeManualAnnouncement: jest.fn(async () => null),
}))

import { getRepositories } from '@/lib/repositories/factory'
import { postConciergeManualAnnouncement } from '@/lib/services/concierge-notifications/writer'
import {
  isRecordableRefusalEvidence,
  maybeAutoSwitchAfterRefusal,
  recordModerationRefusal,
  type RefusalRecord,
} from '@/lib/services/dangerous-content/refusal-ledger'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

const mockAnnounce = jest.mocked(postConciergeManualAnnouncement)

interface FakeChat {
  id: string
  userId: string
  messageCount: number
  isDangerousChat: boolean | null
  conciergeOverride: 'OFF' | 'UNCENSORED' | null
  chatType: string
}

let chat: FakeChat
let ledgerCount: number
let dangerSettings: Partial<DangerousContentSettings>

const chatsUpdate = jest.fn(async (_id: string, patch: Partial<FakeChat>) => {
  chat = { ...chat, ...patch }
  return chat
})
const increment = jest.fn(async () => ++ledgerCount)
const reset = jest.fn(async () => { ledgerCount = 0 })

function installRepos() {
  jest.mocked(getRepositories).mockReturnValue({
    chats: {
      findById: jest.fn(async () => ({ ...chat })),
      update: chatsUpdate,
      incrementModerationRefusalCount: increment,
      getModerationRefusalLedger: jest.fn(async () => ({ count: ledgerCount, lastAt: null })),
      resetModerationRefusalLedger: reset,
    },
    chatSettings: {
      findByUserId: jest.fn(async () => ({
        dangerousContentSettings: { mode: 'AUTO_ROUTE', autoSwitchAfterRefusals: 2, ...dangerSettings },
      })),
    },
  } as never)
}

const record = (overrides: Partial<RefusalRecord> = {}): RefusalRecord => ({
  chatId: 'chat-1',
  kind: 'image',
  purpose: 'tool',
  refusedProfileId: 'profile-1',
  refusedProfileName: 'House Painter',
  provider: 'GOOGLE',
  modelName: 'gemini-2.5-flash-image',
  evidence: 'typed-error',
  rerouted: true,
  ...overrides,
})

const flagCalls = () => mockAnnounce.mock.calls.filter(([a]) => a.kind === 'auto-flagged-refusals')

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.QUILLTAP_JOB_CHILD
  chat = {
    id: 'chat-1',
    userId: 'user-1',
    messageCount: 7,
    isDangerousChat: false,
    conciergeOverride: null,
    chatType: 'salon',
  }
  ledgerCount = 0
  dangerSettings = {}
  installRepos()
})

afterAll(() => {
  delete process.env.QUILLTAP_JOB_CHILD
})

describe('isRecordableRefusalEvidence', () => {
  it.each(['typed-error', 'provider-code', 'finish-reason', 'message-pattern'] as const)('%s counts', (e) => {
    expect(isRecordableRefusalEvidence(e)).toBe(true)
  })

  it('inferred, and no evidence at all, do not', () => {
    expect(isRecordableRefusalEvidence('inferred')).toBe(false)
    expect(isRecordableRefusalEvidence(undefined)).toBe(false)
  })
})

describe('recordModerationRefusal', () => {
  it('does not record an inferred refusal', async () => {
    const result = await recordModerationRefusal(record({ evidence: 'inferred' }))
    expect(result).toEqual({ count: null, switched: false })
    expect(increment).not.toHaveBeenCalled()
  })

  it('records a stated refusal and returns the count in the parent', async () => {
    const result = await recordModerationRefusal(record())
    expect(increment).toHaveBeenCalledWith('chat-1', expect.any(String), {
      provider: 'GOOGLE',
      modelName: 'gemini-2.5-flash-image',
    })
    expect(result).toEqual({ count: 1, switched: false })
    expect(chatsUpdate).not.toHaveBeenCalled()
  })

  it('switches a Monitored Auto-Route chat exactly once, on the N-th refusal', async () => {
    const first = await recordModerationRefusal(record())
    const second = await recordModerationRefusal(record({ provider: 'OPENAI', modelName: 'gpt-image-1' }))
    const third = await recordModerationRefusal(record())

    expect(first.switched).toBe(false)
    expect(second).toEqual({ count: 2, switched: true })
    expect(third.switched).toBe(false)
    expect(chat.isDangerousChat).toBe(true)
    expect(chatsUpdate).toHaveBeenCalledTimes(1)
    expect(chatsUpdate).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      isDangerousChat: true,
      dangerCategories: ['moderation-refusals'],
    }))
    expect(flagCalls()).toHaveLength(1)
    expect(flagCalls()[0][0]).toEqual({
      chatId: 'chat-1',
      kind: 'auto-flagged-refusals',
      details: { count: 2, lastProvider: 'OPENAI', lastModel: 'gpt-image-1' },
    })
  })

  it('never switches when N = 0', async () => {
    dangerSettings = { autoSwitchAfterRefusals: 0 }
    for (let i = 0; i < 5; i++) await recordModerationRefusal(record())
    expect(ledgerCount).toBe(5)
    expect(chatsUpdate).not.toHaveBeenCalled()
  })

  it('honours a higher threshold', async () => {
    dangerSettings = { autoSwitchAfterRefusals: 3 }
    await recordModerationRefusal(record())
    await recordModerationRefusal(record())
    expect(chatsUpdate).not.toHaveBeenCalled()
    expect((await recordModerationRefusal(record())).switched).toBe(true)
  })

  it('defaults to 2 when the stored settings predate the key', async () => {
    dangerSettings = { autoSwitchAfterRefusals: undefined }
    await recordModerationRefusal(record())
    expect((await recordModerationRefusal(record())).switched).toBe(true)
  })

  it.each([
    ['Vouched Safe', { conciergeOverride: 'OFF' as const }],
    ['Uncensored', { conciergeOverride: 'UNCENSORED' as const }],
    ['Flagged', { isDangerousChat: true }],
  ])('never switches a %s chat', async (_label, patch) => {
    chat = { ...chat, ...patch }
    for (let i = 0; i < 3; i++) await recordModerationRefusal(record())
    expect(chatsUpdate).not.toHaveBeenCalled()
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('never switches under Detect Only', async () => {
    dangerSettings = { mode: 'DETECT_ONLY' }
    for (let i = 0; i < 3; i++) await recordModerationRefusal(record())
    expect(chatsUpdate).not.toHaveBeenCalled()
  })

  it('never switches a moderation-exempt chat type', async () => {
    chat = { ...chat, chatType: 'help' }
    for (let i = 0; i < 3; i++) await recordModerationRefusal(record())
    expect(chatsUpdate).not.toHaveBeenCalled()
  })

  it('in the job child: buffers the increment and decides nothing', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1'
    increment.mockResolvedValueOnce(undefined as never)
    ledgerCount = 5
    const result = await recordModerationRefusal(record())
    expect(increment).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ count: null, switched: false })
    expect(chatsUpdate).not.toHaveBeenCalled()
  })

  it('a ledger failure never throws into the refused call', async () => {
    increment.mockRejectedValueOnce(new Error('disk full'))
    await expect(recordModerationRefusal(record())).resolves.toEqual({ count: null, switched: false })
  })
})

describe('maybeAutoSwitchAfterRefusal', () => {
  it('refuses to decide in the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1'
    ledgerCount = 9
    expect(await maybeAutoSwitchAfterRefusal('chat-1')).toEqual({ switched: false })
    expect(chatsUpdate).not.toHaveBeenCalled()
  })

  it('does not overwrite an operator state set while the check was reading', async () => {
    ledgerCount = 2
    const repos = jest.mocked(getRepositories)() as unknown as {
      chatSettings: { findByUserId: jest.Mock }
    }
    // The operator vouches for the chat while the check reads the settings.
    repos.chatSettings.findByUserId.mockImplementationOnce(async () => {
      chat = { ...chat, conciergeOverride: 'OFF' }
      return { dangerousContentSettings: { mode: 'AUTO_ROUTE', autoSwitchAfterRefusals: 2 } }
    })

    expect(await maybeAutoSwitchAfterRefusal('chat-1', { provider: 'GOOGLE' })).toEqual({ switched: false })
    expect(chatsUpdate).not.toHaveBeenCalled()
    expect(chat.conciergeOverride).toBe('OFF')
    expect(flagCalls()).toHaveLength(0)
  })

  it('two checks landing together switch and announce once', async () => {
    ledgerCount = 2
    const results = await Promise.all([
      maybeAutoSwitchAfterRefusal('chat-1', { provider: 'GOOGLE' }),
      maybeAutoSwitchAfterRefusal('chat-1', { provider: 'GOOGLE' }),
    ])
    expect(results.filter((r) => r.switched)).toHaveLength(1)
    expect(flagCalls()).toHaveLength(1)
  })

  it('an operator return to Monitored empties the ledger, so the next refusal starts afresh', async () => {
    await recordModerationRefusal(record())
    await recordModerationRefusal(record())
    expect(chat.isDangerousChat).toBe(true)

    const { applyConciergeFlip } = await import('@/lib/services/dangerous-content/manual-flip')
    await applyConciergeFlip('chat-1', 'monitored', chat as never)
    expect(reset).toHaveBeenCalledWith('chat-1')
    expect(ledgerCount).toBe(0)

    chatsUpdate.mockClear()
    expect((await recordModerationRefusal(record())).switched).toBe(false)
    expect(chatsUpdate).not.toHaveBeenCalled()
  })
})

describe('the auto-switch announcement', () => {
  // Real writer, not the mock above.
  const { buildAutoFlagContent, buildAutoFlagOpaqueContent } =
    jest.requireActual('@/lib/services/concierge-notifications/writer') as
      typeof import('@/lib/services/concierge-notifications/writer')

  it('states a single refusal plainly when the threshold is one', () => {
    const text = buildAutoFlagContent({ count: 1, lastProvider: 'GOOGLE', lastModel: 'imagen' })
    expect(text).not.toMatch(/more than once|once now|most recently/i)
    expect(text).toContain('GOOGLE imagen')
    expect(buildAutoFlagOpaqueContent({ count: 1, lastProvider: 'GOOGLE' })).toMatch(/^One moderation refusal \(last: GOOGLE\)/)
  })

  it('counts two and more', () => {
    expect(buildAutoFlagContent({ count: 2, lastProvider: 'GOOGLE' })).toMatch(/^Twice now .* most recently GOOGLE\./)
    expect(buildAutoFlagContent({ count: 11, lastProvider: '' })).toMatch(/^More than once now [^—]*\./)
  })
})
