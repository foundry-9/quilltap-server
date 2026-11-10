/**
 * `resolveChatExtractionProfileId` — the connection profile a by-hand extraction
 * of one chat runs on (queue-memories, and an edited Salon line's "regenerate
 * on save"). Seat profile first (an LLM seat's, else any seat's), then the
 * user's cheap-LLM default, then a USER_DEFINED pick; a profile that is missing
 * or belongs to another user never answers. Null when nothing does — the edit
 * path then retires nothing.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

import { getRepositories } from '@/lib/repositories/factory'
import { resolveChatExtractionProfileId } from '@/lib/memory/extraction'

const mockGetRepositories = getRepositories as jest.Mock

function seat(over: Record<string, unknown>) {
  return { type: 'CHARACTER', controlledBy: 'llm', connectionProfileId: null, ...over } as any
}

function setup(opts: {
  cheapLLMSettings?: Record<string, unknown> | null
  profiles?: Record<string, { userId: string }>
}) {
  const findByUserId = jest.fn(async () =>
    opts.cheapLLMSettings === undefined ? null : { cheapLLMSettings: opts.cheapLLMSettings }
  )
  const findById = jest.fn(async (id: string) => {
    const p = opts.profiles?.[id]
    return p ? { id, ...p } : null
  })
  mockGetRepositories.mockReturnValue({
    chatSettings: { findByUserId },
    connections: { findById },
  })
  return { findByUserId, findById }
}

describe('resolveChatExtractionProfileId', () => {
  beforeEach(() => mockGetRepositories.mockReset())

  it('prefers an LLM-controlled seat profile and reads no settings', async () => {
    const { findByUserId } = setup({})
    const chat = {
      participants: [
        seat({ type: 'USER', controlledBy: 'user', connectionProfileId: 'p-user' }),
        seat({ connectionProfileId: 'p-llm' }),
      ],
    }
    await expect(resolveChatExtractionProfileId(chat, 'u1')).resolves.toBe('p-llm')
    expect(findByUserId).not.toHaveBeenCalled()
  })

  it('falls back to any seat with a profile', async () => {
    setup({})
    const chat = { participants: [seat({ controlledBy: 'user', connectionProfileId: 'p-user' })] }
    await expect(resolveChatExtractionProfileId(chat, 'u1')).resolves.toBe('p-user')
  })

  it('with no seat profile, uses the user\'s cheap default when it is theirs', async () => {
    setup({
      cheapLLMSettings: { defaultCheapProfileId: 'cheap', strategy: 'PROVIDER_CHEAPEST' },
      profiles: { cheap: { userId: 'u1' } },
    })
    await expect(resolveChatExtractionProfileId({ participants: [seat({})] }, 'u1')).resolves.toBe('cheap')
  })

  it('skips a cheap default that is missing or another user\'s, then tries USER_DEFINED', async () => {
    setup({
      cheapLLMSettings: {
        defaultCheapProfileId: 'foreign',
        strategy: 'USER_DEFINED',
        userDefinedProfileId: 'mine',
      },
      profiles: { foreign: { userId: 'u2' }, mine: { userId: 'u1' } },
    })
    await expect(resolveChatExtractionProfileId({ participants: [] }, 'u1')).resolves.toBe('mine')
  })

  it('ignores userDefinedProfileId unless the strategy is USER_DEFINED', async () => {
    setup({
      cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', userDefinedProfileId: 'mine' },
      profiles: { mine: { userId: 'u1' } },
    })
    await expect(resolveChatExtractionProfileId({ participants: [] }, 'u1')).resolves.toBeNull()
  })

  it('is null with no seat profile and no settings row', async () => {
    setup({})
    await expect(resolveChatExtractionProfileId({ participants: [] }, 'u1')).resolves.toBeNull()
  })
})
