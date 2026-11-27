import { createSystemEvent } from '@/lib/services/system-events.service'
import { getRepositories } from '@/lib/repositories/factory'

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

const mockGetRepositories = jest.mocked(getRepositories)

function createMockRepos() {
  return {
    chats: {
      addMessage: jest.fn(),
      addCallUsage: jest.fn(),
      addEstimatedCost: jest.fn(),
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

  it('records the event with its token figures for display', async () => {
    const result = await createSystemEvent('chat-1', {
      systemEventType: 'MEMORY_EXTRACTION',
      description: 'Extracted memories',
      promptTokens: 40,
      completionTokens: 10,
      totalTokens: 50,
      estimatedCostUSD: 0.01,
    })

    expect(result).toEqual(expect.objectContaining({ promptTokens: 40, completionTokens: 10, totalTokens: 50 }))
    expect(mockRepos.chats.addMessage).toHaveBeenCalledTimes(1)
  })

  it('never touches the chat usage totals: the call was already accounted in logLLMCall', async () => {
    await createSystemEvent('chat-1', {
      systemEventType: 'TITLE_GENERATION',
      description: 'Generated chat title',
      promptTokens: 40,
      completionTokens: 10,
      totalTokens: 50,
      estimatedCostUSD: 0.01,
    })

    expect(mockRepos.chats.addCallUsage).not.toHaveBeenCalled()
    expect(mockRepos.chats.addEstimatedCost).not.toHaveBeenCalled()
  })
})
