import { createSystemEvent } from '@/lib/services/system-events.service'
import { getRepositories } from '@/lib/repositories/factory'
import { updateChatTokenAggregates } from '@/lib/services/token-tracking.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/services/token-tracking.service', () => ({
  updateChatTokenAggregates: jest.fn(),
}))

const mockGetRepositories = jest.mocked(getRepositories)
const mockUpdateChatTokenAggregates = jest.mocked(updateChatTokenAggregates)

function createMockRepos() {
  return {
    chats: {
      addMessage: jest.fn(),
    },
  } as any
}

describe('system-events.service', () => {
  let mockRepos: ReturnType<typeof createMockRepos>

  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos = createMockRepos()
    mockGetRepositories.mockReturnValue(mockRepos)
  })

  it('updates token aggregates when token usage values are explicitly zero', async () => {
    const result = await createSystemEvent('chat-1', {
      systemEventType: 'MEMORY_EXTRACTION',
      description: 'Extracted memories',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUSD: 0,
    })

    expect(result).not.toBeNull()
    expect(mockRepos.chats.addMessage).toHaveBeenCalledTimes(1)
    expect(mockUpdateChatTokenAggregates).toHaveBeenCalledWith(
      'chat-1',
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      0
    )
  })

  it('does not update token aggregates when token usage is omitted', async () => {
    const result = await createSystemEvent('chat-1', {
      systemEventType: 'SUMMARIZATION',
      description: 'Summarized chat',
    })

    expect(result).not.toBeNull()
    expect(mockRepos.chats.addMessage).toHaveBeenCalledTimes(1)
    expect(mockUpdateChatTokenAggregates).not.toHaveBeenCalled()
  })
})
