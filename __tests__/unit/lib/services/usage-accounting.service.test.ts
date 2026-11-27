/**
 * accountLLMCall — the one counter of provider calls
 * (lib/services/usage-accounting.service.ts).
 */

import { accountLLMCall, tallyOfCall } from '@/lib/services/usage-accounting.service'
import { getRepositories } from '@/lib/repositories/factory'
import { estimateCallCost } from '@/lib/services/cost-estimation.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateCallCost: jest.fn(),
}))

const mockGetRepositories = jest.mocked(getRepositories)
const mockEstimate = jest.mocked(estimateCallCost)

function createMockRepos() {
  return {
    connections: { incrementUsage: jest.fn().mockResolvedValue(undefined) },
    chats: {
      addCallUsage: jest.fn().mockResolvedValue(undefined),
      addEstimatedCost: jest.fn().mockResolvedValue(undefined),
    },
  } as any
}

let repos: ReturnType<typeof createMockRepos>

beforeEach(() => {
  jest.clearAllMocks()
  repos = createMockRepos()
  mockGetRepositories.mockReturnValue(repos)
  mockEstimate.mockResolvedValue({ cost: 0.02, source: 'registry' })
})

const base = { userId: 'u1', provider: 'ANTHROPIC', modelName: 'claude-x' }

describe('tallyOfCall', () => {
  it('splits cache writes out of the plugin prompt figure, so nothing overlaps', () => {
    expect(tallyOfCall({
      usage: { promptTokens: 1000, completionTokens: 200 },
      cacheUsage: { cacheCreationInputTokens: 600, cacheReadInputTokens: 5000 },
    })).toEqual({ calls: 1, promptTokens: 400, completionTokens: 200, cacheReadTokens: 5000, cacheWriteTokens: 600 })
  })

  it('counts a call that reported no usage (a failure) as a call with no tokens', () => {
    expect(tallyOfCall({ usage: undefined })).toEqual({ calls: 1, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })
})

describe('accountLLMCall', () => {
  it('puts a Salon call in the chat ledger and the chat totals, then its cost', async () => {
    await accountLLMCall({
      ...base, type: 'CHAT_MESSAGE', chatId: 'c1', connectionProfileId: 'p1',
      usage: { promptTokens: 100, completionTokens: 50 }, cacheUsage: { cacheReadInputTokens: 900 },
    })
    const tally = { calls: 1, promptTokens: 100, completionTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 0 }
    expect(repos.connections.incrementUsage).toHaveBeenCalledWith('p1', 'chat', tally)
    expect(repos.chats.addCallUsage).toHaveBeenCalledWith('c1', tally)
    expect(mockEstimate).toHaveBeenCalledWith('ANTHROPIC', 'claude-x',
      { promptTokens: 100, completionTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 0 }, 'u1')
    expect(repos.chats.addEstimatedCost).toHaveBeenCalledWith('c1', 0.02, 'registry')
  })

  it('puts background work for a chat in the automatic ledger and still in the chat cost', async () => {
    await accountLLMCall({ ...base, type: 'MEMORY_EXTRACTION', chatId: 'c1', connectionProfileId: 'cheap', usage: { promptTokens: 30, completionTokens: 5 } })
    expect(repos.connections.incrementUsage).toHaveBeenCalledWith('cheap', 'automatic', expect.objectContaining({ calls: 1 }))
    expect(repos.chats.addCallUsage).toHaveBeenCalled()
    expect(repos.chats.addEstimatedCost).toHaveBeenCalled()
  })

  it('writes the tokens before it waits on pricing', async () => {
    let resolvePrice!: (v: { cost: number; source: 'registry' }) => void
    mockEstimate.mockReturnValue(new Promise((r) => { resolvePrice = r }))
    const done = accountLLMCall({ ...base, type: 'CHAT_MESSAGE', chatId: 'c1', connectionProfileId: 'p1', usage: { promptTokens: 1, completionTokens: 1 } })
    await new Promise((r) => setImmediate(r))
    expect(repos.connections.incrementUsage).toHaveBeenCalled()
    expect(repos.chats.addCallUsage).toHaveBeenCalled()
    expect(repos.chats.addEstimatedCost).not.toHaveBeenCalled()
    resolvePrice({ cost: 0.5, source: 'registry' })
    await done
    expect(repos.chats.addEstimatedCost).toHaveBeenCalledWith('c1', 0.5, 'registry')
  })

  it('counts a failed call against the profile but touches no chat totals', async () => {
    await accountLLMCall({ ...base, type: 'CHAT_MESSAGE', chatId: 'c1', connectionProfileId: 'p1' })
    expect(repos.connections.incrementUsage).toHaveBeenCalledWith('p1', 'chat', expect.objectContaining({ calls: 1, promptTokens: 0 }))
    expect(repos.chats.addCallUsage).not.toHaveBeenCalled()
    expect(mockEstimate).not.toHaveBeenCalled()
  })

  it('prices nothing for a call made for no chat', async () => {
    await accountLLMCall({ ...base, type: 'CHARACTER_WIZARD', connectionProfileId: 'p1', usage: { promptTokens: 10, completionTokens: 10 } })
    expect(repos.connections.incrementUsage).toHaveBeenCalled()
    expect(mockEstimate).not.toHaveBeenCalled()
  })

  it('leaves the cost alone when the model has no price', async () => {
    mockEstimate.mockResolvedValue({ cost: null, source: 'unavailable' })
    await accountLLMCall({ ...base, type: 'CHAT_MESSAGE', chatId: 'c1', connectionProfileId: 'p1', usage: { promptTokens: 10, completionTokens: 10 } })
    expect(repos.chats.addEstimatedCost).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    repos.connections.incrementUsage.mockRejectedValue(new Error('boom'))
    await expect(accountLLMCall({ ...base, type: 'CHAT_MESSAGE', connectionProfileId: 'p1' })).resolves.toBeUndefined()
  })
})
