/**
 * The transcript `generateContextSummary` hands to the fold (bug 161).
 *
 * The fold prompt asks for character names. For years the transcript under it
 * carried `USER:` / `ASSISTANT:`, so on a chat where nobody says the character's
 * name out loud the model was ordered to name a speaker it had no name for and
 * obliged — then carried the invention forward through every later fold. This
 * pins the one thing that stops it: every line the fold sees is labelled with a
 * resolved seat name, and an unresolvable seat gets a role *label*, never a
 * bare role.
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

import { generateContextSummary } from '@/lib/chat/context-summary'
import { getRepositories } from '@/lib/repositories/factory'
import { foldChatSummary, generateTitleFromSummary } from '@/lib/memory/cheap-llm-tasks'

const mockRepos = getRepositories as jest.Mock
const mockFold = foldChatSummary as jest.Mock
const mockTitle = generateTitleFromSummary as jest.Mock

type AnyRecord = Record<string, unknown>

const CHARS: Record<string, string> = {
  'char-charlie': 'Charlie',
  'char-friday': 'Friday',
}

/** Ten turns, alternating the user's persona and the LLM seat. */
function buildMessages(over: { assistantParticipantId?: string | null } = {}) {
  const messages: AnyRecord[] = []
  for (let i = 1; i <= 10; i++) {
    messages.push({
      type: 'message',
      id: `u${i}`,
      role: 'USER',
      content: `user line ${i}`,
      participantId: 'p-charlie',
      createdAt: `2026-09-2${i % 10}T10:00:00.000Z`,
    })
    messages.push({
      type: 'message',
      id: `a${i}`,
      role: 'ASSISTANT',
      content: `assistant line ${i}`,
      participantId:
        over.assistantParticipantId === undefined ? 'p-friday' : over.assistantParticipantId,
      createdAt: `2026-09-2${i % 10}T10:01:00.000Z`,
    })
  }
  return messages
}

function primeRepos(over: { participants?: AnyRecord[]; messages?: AnyRecord[] } = {}) {
  const participants = over.participants ?? [
    { id: 'p-charlie', type: 'CHARACTER', status: 'active', characterId: 'char-charlie' },
    { id: 'p-friday', type: 'CHARACTER', status: 'active', characterId: 'char-friday' },
  ]

  const chat = {
    id: 'chat-1',
    title: 'Tuesday-Night Pie',
    chatType: 'roleplay',
    participants,
    contextSummary: null,
    lastSummaryTurn: 0,
    compactionGeneration: 0,
    timelineMode: 'realtime',
    projectId: null,
  }

  mockRepos.mockReturnValue({
    chats: {
      findById: jest.fn(async () => chat),
      getMessages: jest.fn(async () => over.messages ?? buildMessages()),
      update: jest.fn(async () => undefined),
      addMessage: jest.fn(async () => undefined),
      deleteMessagesByIds: jest.fn(async () => 0),
    },
    characters: {
      findByIdRaw: jest.fn(async (id: string) => (CHARS[id] ? { id, name: CHARS[id] } : null)),
    },
    chatSettings: { findByUserId: jest.fn(async () => ({})) },
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

/** The `newTurns` array the fold was handed. */
function foldedTurns() {
  return (mockFold.mock.calls[0][0] as { newTurns: Array<{ speaker: string; content: string }> })
    .newTurns
}

beforeEach(() => {
  jest.clearAllMocks()
  primeRepos()
  mockFold.mockResolvedValue({
    success: true,
    result: 'Active threads: pie.',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  })
  mockTitle.mockResolvedValue({ success: false, error: 'not under test' })
})

describe('generateContextSummary — the fold transcript carries speaker names', () => {
  it('labels every line of a two-seat chat with its character name', async () => {
    const result = await generateContextSummary(options())

    expect(result.success).toBe(true)
    expect(mockFold).toHaveBeenCalledTimes(1)

    const turns = foldedTurns()
    expect(turns.length).toBeGreaterThan(0)
    expect(turns.every(t => t.speaker === 'Charlie' || t.speaker === 'Friday')).toBe(true)
    expect(turns.map(t => t.speaker)).toContain('Charlie')
    expect(turns.map(t => t.speaker)).toContain('Friday')
  })

  it('never hands the fold a bare LLM role as a speaker', async () => {
    await generateContextSummary(options())

    for (const turn of foldedTurns()) {
      expect(turn.speaker).not.toBe('USER')
      expect(turn.speaker).not.toBe('ASSISTANT')
      expect(turn.speaker).not.toBe('user')
      expect(turn.speaker).not.toBe('assistant')
    }
  })

  it('falls back to a role label when a line has no seat to resolve', async () => {
    primeRepos({ messages: buildMessages({ assistantParticipantId: null }) })

    await generateContextSummary(options())

    const speakers = new Set(foldedTurns().map(t => t.speaker))
    expect(speakers).toContain('Charlie')
    expect(speakers).toContain('Character')
  })

  it('names a seat that has since been removed from the chat', async () => {
    primeRepos({
      participants: [
        { id: 'p-charlie', type: 'CHARACTER', status: 'active', characterId: 'char-charlie' },
        { id: 'p-friday', type: 'CHARACTER', status: 'removed', characterId: 'char-friday' },
      ],
    })

    await generateContextSummary(options())

    expect(new Set(foldedTurns().map(t => t.speaker))).toContain('Friday')
  })
})
