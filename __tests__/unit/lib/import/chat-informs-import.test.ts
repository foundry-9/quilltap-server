/**
 * Importing Inform rows: every reference is checked, and a row that cannot be
 * resolved never lands.
 *
 * An Inform row points at four things — the chat, one of its seats, the Host
 * message that recorded the post, and (once consumed) the assistant message
 * that carried it. Chat ids are remapped; participant and message ids are
 * carried verbatim by `chats.create` / `addMessage`, which is precisely why
 * they have to be *verified* rather than trusted: a chat the conflict strategy
 * skipped, or a message whose insert warned and continued, leaves a hole.
 *
 * The rules under test:
 *   - a missing seat drops the row (an inform aimed at nobody sits pending
 *     forever)
 *   - a missing record message drops the row (a transcript pointer into empty
 *     space is a lie)
 *   - a missing `consumedByMessageId` only nulls that field: the row is still
 *     a real historical inform, it simply loses its swipe anchor
 */

import { createMockExportManifest, generateId } from '../fixtures/test-factories'

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}))

const moduleLoggerWarn = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: (...args: unknown[]) => moduleLoggerWarn(...args),
      error: jest.fn(),
    }),
  },
}))

import { executeImport } from '@/lib/import/quilltap-import-service'
import { remapChatInform } from '@/lib/import/quilltap-import/reconcile'
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory'

/** Every method you touch exists and resolves to null. */
function repoStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>()
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      if (!cache.has(prop)) cache.set(prop, jest.fn().mockResolvedValue(null))
      return cache.get(prop)
    },
  })
}

const OLD_CHAT_ID = 'chat-from-the-other-instance'
const NEW_CHAT_ID = 'chat-freshly-minted-here'
const ALICE = 'participant-alice'
const BOB = 'participant-bob'
const RECORD_MESSAGE_ID = 'msg-host-record'
const ASSISTANT_MESSAGE_ID = 'msg-alice-replied'

function inform(overrides: Record<string, unknown> = {}) {
  return {
    id: generateId(),
    chatId: OLD_CHAT_ID,
    batchId: 'batch-1',
    participantId: ALICE,
    contentMarkdown: 'You notice the clock has stopped.',
    recordMessageId: RECORD_MESSAGE_ID,
    createdAt: '2026-09-19T21:14:00.000Z',
    updatedAt: '2026-09-19T21:14:00.000Z',
    consumedAt: null,
    consumedByMessageId: null,
    ...overrides,
  }
}

describe('executeImport — chat informs', () => {
  const testUserId = generateId()

  let informsCreate: jest.Mock

  /**
   * The destination chat as it exists after `importChats`: Alice and Bob in
   * their seats, the Host record and Alice's reply in the transcript.
   */
  function primeRepos() {
    const createdChat = {
      id: NEW_CHAT_ID,
      participants: [{ id: ALICE }, { id: BOB }],
    }
    const chatsRepo = repoStub({
      findById: jest.fn(async (id: string) => (id === NEW_CHAT_ID ? createdChat : null)),
      create: jest.fn(async (data: Record<string, unknown>) => ({ ...data, id: NEW_CHAT_ID })),
      addMessage: jest.fn().mockResolvedValue(undefined),
      getMessages: jest.fn(async () => [
        { id: RECORD_MESSAGE_ID, type: 'message' },
        { id: ASSISTANT_MESSAGE_ID, type: 'message' },
      ]),
    })

    const userRepos = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === 'chats') return chatsRepo
        return repoStub()
      },
    })

    informsCreate = jest.fn(async (data: Record<string, unknown>) => ({ ...data, id: generateId() }))
    const globalRepos = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === 'chatInforms') return repoStub({ create: informsCreate })
        return repoStub()
      },
    })

    ;(getUserRepositories as jest.Mock).mockReturnValue(userRepos)
    ;(getRepositories as jest.Mock).mockReturnValue(globalRepos)
  }

  function archive(chatInforms: unknown[]) {
    return {
      manifest: createMockExportManifest({ exportType: 'chats' }),
      data: {
        chats: [
          {
            id: OLD_CHAT_ID,
            userId: 'someone-else',
            title: 'The Stopped Clock',
            participants: [{ id: ALICE }, { id: BOB }],
            tags: [],
            messages: [
              { id: RECORD_MESSAGE_ID, type: 'message' },
              { id: ASSISTANT_MESSAGE_ID, type: 'message' },
            ],
            createdAt: '2026-09-19T21:00:00.000Z',
            updatedAt: '2026-09-19T21:20:00.000Z',
          },
        ],
        chatInforms,
      },
    }
  }

  async function run(chatInforms: unknown[]) {
    return executeImport(testUserId, archive(chatInforms) as never, {
      conflictStrategy: 'duplicate',
      includeMemories: false,
      includeRelatedEntities: true,
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    moduleLoggerWarn.mockClear()
    primeRepos()
  })

  it('creates the row against the remapped chat id', async () => {
    const result = await run([inform({ participantId: ALICE })])

    expect(result.success).toBe(true)
    expect(result.imported.chatInforms).toBe(1)
    expect(informsCreate).toHaveBeenCalledTimes(1)
    expect(informsCreate.mock.calls[0][0]).toMatchObject({
      chatId: NEW_CHAT_ID,
      participantId: ALICE,
      recordMessageId: RECORD_MESSAGE_ID,
      contentMarkdown: 'You notice the clock has stopped.',
    })
  })

  it('keeps a consumed row with its swipe anchor', async () => {
    await run([
      inform({
        consumedAt: '2026-09-19T21:16:00.000Z',
        consumedByMessageId: ASSISTANT_MESSAGE_ID,
      }),
    ])

    expect(informsCreate.mock.calls[0][0]).toMatchObject({
      consumedAt: '2026-09-19T21:16:00.000Z',
      consumedByMessageId: ASSISTANT_MESSAGE_ID,
    })
  })

  it('drops a row whose participant is not a seat in the chat, with a warning', async () => {
    const result = await run([inform({ participantId: 'participant-who-never-arrived' })])

    expect(informsCreate).not.toHaveBeenCalled()
    expect(result.imported.chatInforms).toBe(0)
    expect(result.warnings.some((w) => w.includes('participant-who-never-arrived'))).toBe(true)
    expect(
      moduleLoggerWarn.mock.calls.some(
        ([message]) => message === 'Dropped imported inform with an unresolvable reference'
      )
    ).toBe(true)
  })

  it('drops a row whose Host record message is gone, with a warning', async () => {
    const result = await run([inform({ recordMessageId: 'msg-that-never-landed' })])

    expect(informsCreate).not.toHaveBeenCalled()
    expect(result.warnings.some((w) => w.includes('msg-that-never-landed'))).toBe(true)
  })

  it('keeps a row whose consumedByMessageId is gone, nulling only that field', async () => {
    const result = await run([
      inform({
        consumedAt: '2026-09-19T21:16:00.000Z',
        consumedByMessageId: 'msg-that-never-landed',
      }),
    ])

    expect(result.imported.chatInforms).toBe(1)
    expect(informsCreate.mock.calls[0][0]).toMatchObject({
      consumedAt: '2026-09-19T21:16:00.000Z',
      consumedByMessageId: null,
    })
  })

  it('imports the good rows of a batch and drops only the bad ones', async () => {
    const result = await run([
      inform({ participantId: ALICE }),
      inform({ participantId: BOB }),
      inform({ participantId: 'participant-who-never-arrived' }),
    ])

    expect(result.imported.chatInforms).toBe(2)
    expect(informsCreate).toHaveBeenCalledTimes(2)
  })
})

describe('remapChatInform', () => {
  const idMaps = { chats: new Map([[OLD_CHAT_ID, NEW_CHAT_ID]]) } as never

  const known = {
    participantIds: new Set([ALICE]),
    messageIds: new Set([RECORD_MESSAGE_ID, ASSISTANT_MESSAGE_ID]),
  }

  it('rewrites the chat id and leaves a null record pointer alone', () => {
    const result = remapChatInform(inform({ recordMessageId: null }) as never, idMaps, known)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.chatId).toBe(NEW_CHAT_ID)
    expect(result.data.recordMessageId).toBeNull()
    expect(result.consumedByMessageIdCleared).toBe(false)
  })

  it('falls back to the row-s own chat id when the map has no entry', () => {
    const result = remapChatInform(
      inform({ chatId: 'chat-preserved-ids' }) as never,
      idMaps,
      known
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.chatId).toBe('chat-preserved-ids')
  })

  it('reports the missing seat rather than guessing one', () => {
    const result = remapChatInform(inform({ participantId: BOB }) as never, idMaps, known)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain(BOB)
  })
})
