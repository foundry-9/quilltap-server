/**
 * The context-summary fold's title (bugs 163 and 164).
 *
 * The fold writes a fresh title after every pass. It used to write it straight
 * to the column: over a title the user had set by hand (164), and without
 * telling the Lantern the scene had moved, so a chat retitled three times got
 * one story background (163). Both rules now live in `applyAutoTitle`; this
 * pins that the fold goes through it and does not pay for a title it may not
 * use.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  logger.child = jest.fn(() => logger)
  return { logger }
})

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(() => ({ provider: 'anthropic', modelName: 'claude-haiku-4-5-20251001' })),
  resolveUncensoredCheapLLMSelection: jest.fn((s: unknown) => s),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  foldChatSummary: jest.fn(),
  generateTitleFromSummary: jest.fn(),
  generateHelpChatTitleFromSummary: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: jest.fn(() => false),
}))

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(() => ({ settings: { mode: 'OFF' } })),
}))

jest.mock('@/lib/services/system-events.service', () => ({
  createContextSummaryEvent: jest.fn(),
  createTitleGenerationEvent: jest.fn(),
}))

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn(async () => ({ cost: 0 })),
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueTitleUpdate: jest.fn(),
}))

jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianSummaryAnnouncement: jest.fn(),
  SUMMARY_CONTENT_PREFIX: '[Summary]',
}))

jest.mock('@/lib/file-storage/conversation-summary-vault-bridge', () => ({
  writeConversationSummaryToVaults: jest.fn(),
  computeConversationStats: jest.fn(() => ({ messageCount: 0, firstMessageAt: null, lastMessageAt: null })),
}))

jest.mock('@/lib/services/commonplace-notifications/relevant-conversations-refresh', () => ({
  refreshRelevantConversationsOnFold: jest.fn(),
}))

jest.mock('@/lib/memory/fold-episode-pass', () => ({
  runFoldEpisodePass: jest.fn(),
}))

jest.mock('@/lib/chat/auto-title', () => ({
  applyAutoTitle: jest.fn(async () => 'applied'),
}))

import { generateContextSummary } from '@/lib/chat/context-summary'
import { getRepositories } from '@/lib/repositories/factory'
import { foldChatSummary, generateTitleFromSummary } from '@/lib/memory/cheap-llm-tasks'
import { applyAutoTitle } from '@/lib/chat/auto-title'

const mockRepos = getRepositories as jest.Mock
const mockFold = foldChatSummary as jest.Mock
const mockTitle = generateTitleFromSummary as jest.Mock
const mockApply = applyAutoTitle as jest.Mock

const chatSettings = { storyBackgroundsSettings: { enabled: true } }

function primeRepos(chatOver: Record<string, unknown> = {}) {
  const chat = {
    id: 'chat-1',
    title: 'Flying Above the Clouds',
    chatType: 'salon',
    participants: [{ id: 'p-amy', type: 'CHARACTER', status: 'active', characterId: 'char-amy' }],
    contextSummary: null,
    lastSummaryTurn: 0,
    compactionGeneration: 0,
    timelineMode: 'realtime',
    projectId: null,
    isManuallyRenamed: false,
    ...chatOver,
  }
  const messages: Record<string, unknown>[] = []
  for (let i = 1; i <= 12; i++) {
    messages.push({ type: 'message', id: `u${i}`, role: 'USER', content: `u ${i}`, createdAt: '2026-09-23T04:00:00.000Z' })
    messages.push({ type: 'message', id: `a${i}`, role: 'ASSISTANT', content: `a ${i}`, participantId: 'p-amy', createdAt: '2026-09-23T04:00:01.000Z' })
  }
  mockRepos.mockReturnValue({
    chats: {
      findById: jest.fn(async () => chat),
      getMessages: jest.fn(async () => messages),
      update: jest.fn(async () => undefined),
      addMessage: jest.fn(async () => undefined),
      deleteMessagesByIds: jest.fn(async () => 0),
    },
    characters: { findByIdRaw: jest.fn(async () => ({ id: 'char-amy', name: 'Amy' })) },
    chatSettings: { findByUserId: jest.fn(async () => chatSettings) },
  })
}

function options(): never {
  return {
    userId: 'user-1',
    chatId: 'chat-1',
    connectionProfile: { id: 'profile-1', maxContext: 8000 },
    cheapLLMSettings: { strategy: 'auto', fallbackToLocal: false },
    availableProfiles: [{ id: 'profile-1' }],
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFold.mockResolvedValue({
    success: true,
    result: 'Active threads: bread and cheese.',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  })
  mockTitle.mockResolvedValue({ success: true, result: 'Bread, Cheese, and Borrowed Stars' })
})

describe('generateContextSummary — fold title', () => {
  it('routes the fold title through applyAutoTitle with chat settings (bug 163)', async () => {
    primeRepos()
    const result = await generateContextSummary(options())

    expect(result.success).toBe(true)
    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      chatId: 'chat-1',
      title: 'Bread, Cheese, and Borrowed Stars',
      chatSettings,
      source: 'summary-fold',
    }))
  })

  it('never writes the title column itself', async () => {
    primeRepos()
    await generateContextSummary(options())

    const repos = mockRepos.mock.results[0].value
    const titleWrites = (repos.chats.update as jest.Mock).mock.calls
      .filter(([, patch]) => patch && 'title' in patch)
    expect(titleWrites).toEqual([])
  })

  it('skips the title call entirely on a hand-renamed chat (bug 164)', async () => {
    primeRepos({ isManuallyRenamed: true, title: 'My Own Title' })
    const result = await generateContextSummary(options())

    expect(result.success).toBe(true)
    expect(mockFold).toHaveBeenCalledTimes(1)
    expect(mockTitle).not.toHaveBeenCalled()
    expect(mockApply).not.toHaveBeenCalled()
  })
})
