/**
 * Unit tests for the Brahma Console lookup shortcuts
 * (`lib/tools/handlers/brahma-lookup-handler.ts`): character resolution,
 * memory search as inspection (no access stamping), FTS message search with
 * speaker and date filters, and bounded conversation slices.
 */

const mockGetRepositories = jest.fn()
const mockSearchMemories = jest.fn()
const mockLogger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() }

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => mockGetRepositories(),
}))
jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => mockLogger,
}))
jest.mock('@/lib/memory/recall/search', () => ({
  searchMemories: (...args: unknown[]) => mockSearchMemories(...args),
}))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({
  refreshMemoryTimeZone: async () => 'UTC',
}))
jest.mock('@/lib/tools/handlers/search-scriptorium-handler', () => ({
  memoryArchivedLabel: (m: { tier?: string }) => (m.tier === 'cold' ? 'archived' : undefined),
}))

const {
  executeLookupCharacterTool,
  executeLookupMemoriesTool,
  executeLookupMessagesTool,
  executeReadMessagesTool,
} = require('@/lib/tools/handlers/brahma-lookup-handler') as typeof import('@/lib/tools/handlers/brahma-lookup-handler')

const ctx = { userId: 'user-1' }

const LAURA = {
  id: 'char-laura',
  name: 'Laura',
  aliases: ['Red Cloud'],
  controlledBy: 'llm',
  createdAt: '2026-09-04T00:00:00.000Z',
  identity: 'Laura Red Cloud, twenty-nine, a pilot.',
  description: 'Arrives rather than enters.',
  personality: 'Restless.',
  manifesto: null,
  physicalDescription: { fullDescription: 'Tall, dark braid.' },
  characterDocumentMountPointId: 'mp-laura',
}
const FRIDAY = { id: 'char-friday', name: 'Friday', aliases: [], controlledBy: 'llm' }
const CHARLIE = { id: 'char-charlie', name: 'Charlie', aliases: [], controlledBy: 'user' }
const ALL = [LAURA, FRIDAY, CHARLIE]

const CHAT_A = {
  id: 'chat-a',
  title: 'Breakfast',
  chatType: 'salon',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  participants: [
    { id: 'seat-laura', characterId: 'char-laura' },
    { id: 'seat-charlie', characterId: 'char-charlie' },
  ],
}
const CHAT_B = {
  id: 'chat-b',
  title: 'Hangar',
  chatType: 'salon',
  createdAt: '2026-10-05T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
  participants: [{ id: 'seat-friday', characterId: 'char-friday' }],
}
const HELP_CHAT = { id: 'chat-help', title: 'Help', chatType: 'help', participants: [] }

function msg(id: string, participantId: string, content: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return { type: 'message', id, role: participantId === 'seat-charlie' ? 'USER' : 'ASSISTANT', participantId, content, createdAt, ...extra }
}

let repos: ReturnType<typeof makeRepos>
function makeRepos() {
  return {
    characters: {
      findAllRaw: jest.fn(async () => ALL),
      findAll: jest.fn(async () => ALL),
      findById: jest.fn(async (id: string) => ALL.find(c => c.id === id) ?? null),
      findByIdRaw: jest.fn(async (id: string) => ALL.find(c => c.id === id) ?? null),
    },
    memories: {
      countByCharacterId: jest.fn(async (id: string) => (id === 'char-laura' ? 12 : id === 'char-friday' ? 3 : 0)),
    },
    chats: {
      findByCharacterId: jest.fn(async (id: string) =>
        [CHAT_A, CHAT_B, HELP_CHAT].filter(c => c.participants.some(p => p.characterId === id))
      ),
      findAll: jest.fn(async () => [CHAT_A, CHAT_B, HELP_CHAT]),
      findById: jest.fn(async (id: string) => [CHAT_A, CHAT_B, HELP_CHAT].find(c => c.id === id) ?? null),
      searchMessagesGlobal: jest.fn(async () => [] as unknown[]),
      getMessages: jest.fn(async () => [] as unknown[]),
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  repos = makeRepos()
  mockGetRepositories.mockReturnValue(repos)
})

describe('lookup_character', () => {
  it('resolves by name without hydrating every vault, and summarises the character', async () => {
    const result = await executeLookupCharacterTool({ character: 'laura' }, ctx)
    expect(result.success).toBe(true)
    expect(repos.characters.findAll).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      id: 'char-laura',
      identity: 'Laura Red Cloud, twenty-nine, a pilot.',
      physicalDescription: 'Tall, dark braid.',
      memoriesHeld: 12,
      conversations: { count: 1, first: { id: 'chat-a', title: 'Breakfast' } },
    })
  })

  it('resolves an alias through the hydrated rows', async () => {
    const result = await executeLookupCharacterTool({ character: 'red cloud' }, ctx)
    expect(repos.characters.findAll).toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, id: 'char-laura' })
  })

  it('lists candidates when a partial name is ambiguous', async () => {
    repos.characters.findAllRaw.mockResolvedValue([LAURA, { ...LAURA, id: 'char-laurie', name: 'Laurie' }] as never)
    repos.characters.findAll.mockResolvedValue([LAURA, { ...LAURA, id: 'char-laurie', name: 'Laurie', aliases: [] }] as never)
    const result = await executeLookupCharacterTool({ character: 'laur' }, ctx)
    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toMatch(/more than one character.*char-laurie/)
  })

  it('reports an unknown name as data, not a throw', async () => {
    const result = await executeLookupCharacterTool({ character: 'Nobody' }, ctx)
    expect(result).toEqual({ success: false, error: expect.stringMatching(/No character matches "Nobody"/) })
  })
})

describe('lookup_memories', () => {
  const memory = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    content: `memory ${id}`,
    aboutCharacterId: 'char-laura',
    importance: 0.5,
    reinforcedImportance: 0.8,
    source: 'AUTO',
    createdAt: '2026-10-01T00:00:00.000Z',
    occurredAt: '2026-10-01T00:00:00.000Z',
    chatId: 'chat-a',
    ...extra,
  })

  it('searches one holder with the about filter and labels the source conversation', async () => {
    mockSearchMemories.mockResolvedValue([{ memory: memory('m1'), score: 0.91, salience: 0.5, usedEmbedding: true }])
    const result = await executeLookupMemoriesTool({ query: 'age', character: 'Friday', about: 'Laura' }, ctx)

    expect(mockSearchMemories).toHaveBeenCalledTimes(1)
    expect(mockSearchMemories).toHaveBeenCalledWith(
      'char-friday',
      'age',
      expect.objectContaining({ aboutCharacterId: 'char-laura', includeCold: true, literalPhrase: true })
    )
    expect(result).toMatchObject({
      success: true,
      memories: [
        {
          memoryId: 'm1',
          heldBy: 'Friday',
          about: 'Laura',
          importance: 0.8,
          conversation: { id: 'chat-a', title: 'Breakfast' },
        },
      ],
    })
  })

  it('searches every holder that has memories when no character is named, merging by relevance', async () => {
    mockSearchMemories.mockImplementation(async (holderId: string) =>
      holderId === 'char-laura'
        ? [{ memory: memory('low'), score: 0.4, salience: 0, usedEmbedding: true }]
        : [{ memory: memory('high'), score: 0.9, salience: 0, usedEmbedding: true }]
    )
    const result = await executeLookupMemoriesTool({ query: 'born', limit: 5 }, ctx)

    // Charlie holds no memories and is skipped.
    expect(mockSearchMemories.mock.calls.map(c => c[0]).sort()).toEqual(['char-friday', 'char-laura'])
    // One shared embedding memo for the sweep.
    expect(mockSearchMemories.mock.calls[0][2].embeddingMemo).toBe(mockSearchMemories.mock.calls[1][2].embeddingMemo)
    const ids = (result as { memories: Array<{ memoryId: string }> }).memories.map(m => m.memoryId)
    expect(ids).toEqual(['high', 'low'])
  })

  it('never stamps the memories as recalled', () => {
    // Inspection, not recall: the delivery module's access stamp is the one
    // writer of lastAccessedAt, and this handler must never reach it.
    const source = require('fs').readFileSync(
      require('path').join(process.cwd(), 'lib/tools/handlers/brahma-lookup-handler.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/stampAccessed|recall\/deliver/)
  })
})

describe('lookup_messages', () => {
  it('searches only conversation chats and labels hits with title and speaker', async () => {
    repos.chats.searchMessagesGlobal.mockResolvedValue([
      { messageId: 'msg-1', chatId: 'chat-a', role: 'ASSISTANT', participantId: 'seat-laura', createdAt: '2026-10-01T11:00:00.000Z', content: 'I turned twenty-nine last spring.' },
    ])
    const result = await executeLookupMessagesTool({ query: 'twenty-nine' }, ctx)

    expect(repos.chats.searchMessagesGlobal).toHaveBeenCalledWith(['chat-a', 'chat-b'], 'twenty-nine', 10)
    expect(result).toMatchObject({
      success: true,
      hits: [
        {
          conversation: { id: 'chat-a', title: 'Breakfast', createdAt: '2026-10-01T10:00:00.000Z' },
          messageId: 'msg-1',
          speaker: 'Laura',
          snippet: expect.stringContaining('twenty-nine'),
        },
      ],
    })
  })

  it('filters by speaker and date after over-fetching', async () => {
    repos.chats.searchMessagesGlobal.mockResolvedValue([
      { messageId: 'by-charlie', chatId: 'chat-a', role: 'USER', participantId: 'seat-charlie', createdAt: '2026-10-01T11:00:00.000Z', content: 'age' },
      { messageId: 'by-laura-old', chatId: 'chat-a', role: 'ASSISTANT', participantId: 'seat-laura', createdAt: '2026-09-01T11:00:00.000Z', content: 'age' },
      { messageId: 'by-laura', chatId: 'chat-a', role: 'ASSISTANT', participantId: 'seat-laura', createdAt: '2026-10-01T12:00:00.000Z', content: 'age' },
    ])
    const result = await executeLookupMessagesTool({ query: 'age', speaker: 'Laura', since: '2026-09-15' }, ctx)

    expect(repos.chats.searchMessagesGlobal).toHaveBeenCalledWith(['chat-a'], 'age', 200)
    const ids = (result as { hits: Array<{ messageId: string }> }).hits.map(h => h.messageId)
    expect(ids).toEqual(['by-laura'])
  })
})

describe('read_messages', () => {
  const lines = [
    msg('l0', 'seat-charlie', 'Morning.', '2026-10-01T10:00:00.000Z'),
    { type: 'message', id: 'sys', role: 'ASSISTANT', systemSender: 'host', content: 'notice', createdAt: '2026-10-01T10:00:30.000Z' },
    msg('l1', 'seat-laura', 'Cousin.', '2026-10-01T10:01:00.000Z'),
    msg('l2', 'seat-charlie', 'How old are you?', '2026-10-01T10:02:00.000Z'),
    msg('l3', 'seat-laura', 'Twenty-nine.', '2026-10-01T10:03:00.000Z'),
    msg('l4', 'seat-charlie', 'Huh.', '2026-10-01T10:04:00.000Z'),
  ]

  it('centres on a message, skips system notices, and names speakers', async () => {
    repos.chats.getMessages.mockResolvedValue(lines)
    const result = await executeReadMessagesTool({ conversation_id: 'chat-a', around_message_id: 'l3', before: 1, after: 1 }, ctx)

    expect(result).toMatchObject({
      success: true,
      conversation: { id: 'chat-a', title: 'Breakfast', spokenLines: 5 },
      messages: [
        { messageId: 'l2', speaker: 'Charlie', index: 2 },
        { messageId: 'l3', speaker: 'Laura', content: 'Twenty-nine.' },
        { messageId: 'l4', speaker: 'Charlie' },
      ],
    })
  })

  it('reads the last lines with a negative offset', async () => {
    repos.chats.getMessages.mockResolvedValue(lines)
    const result = await executeReadMessagesTool({ conversation_id: 'chat-a', offset: -2 }, ctx)
    const ids = (result as { messages: Array<{ messageId: string }> }).messages.map(m => m.messageId)
    expect(ids).toEqual(['l3', 'l4'])
  })

  it('reports a system notice id as not a spoken line', async () => {
    repos.chats.getMessages.mockResolvedValue(lines)
    const result = await executeReadMessagesTool({ conversation_id: 'chat-a', around_message_id: 'sys' }, ctx)
    expect(result.success).toBe(false)
  })
})
