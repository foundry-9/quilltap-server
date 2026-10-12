/**
 * Bug 199 — a chat imported under a fresh id must not reuse its bundle's
 * message ids.
 *
 * `chat_messages.id` is a global primary key. The `duplicate` conflict
 * strategy created the copy under a new chat id but inserted every message
 * under its original id, beside the original chat that still held them, so
 * every insert failed on `UNIQUE constraint failed: chat_messages.id` and the
 * copy landed empty. The default (non-`preserveIds`) path had the same hole
 * whenever the same bundle was imported twice.
 *
 * The repository stub below enforces the global uniqueness the way SQLite
 * does, so the failure reproduces without a database.
 */

import { createMockExportManifest, generateId } from '../../fixtures/test-factories'

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))

import { executeImport } from '@/lib/import/quilltap-import-service'
import { remintChatMessageIds } from '@/lib/import/quilltap-import/message-id-remap'
import { importMemories } from '@/lib/import/quilltap-import/import-entities'
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory'

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

const SOURCE_CHAT_ID = '11111111-1111-4111-8111-111111111111'
const USER_MSG = '22222222-2222-4222-8222-222222222221'
const REPLY_A = '22222222-2222-4222-8222-222222222222'
const REPLY_B = '22222222-2222-4222-8222-222222222223'
const HOST_RECORD = '22222222-2222-4222-8222-222222222224'
const ALICE = '33333333-3333-4333-8333-333333333333'
const ALICE_CHARACTER = '44444444-4444-4444-8444-444444444444'
const SWIPE_GROUP = `swipe-${REPLY_A}`

function message(id: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'message',
    id,
    role: 'USER',
    content: `content of ${id}`,
    attachments: [],
    createdAt: '2026-10-12T00:00:00.000Z',
    ...extra,
  }
}

function bundleChat() {
  return {
    id: SOURCE_CHAT_ID,
    userId: 'someone',
    title: 'The Clockwork Tea',
    participants: [{ id: ALICE }],
    tags: [],
    summaryAnchorMessageIds: [USER_MSG, REPLY_A, 'not-in-the-bundle'],
    otherExtractionWatermarkMessageId: REPLY_B,
    courierCheckpoints: {
      [ALICE_CHARACTER]: { lastResolvedMessageId: REPLY_B, resolvedAt: '2026-10-12T00:05:00.000Z' },
    },
    messages: [
      message(USER_MSG),
      message(REPLY_A, { role: 'ASSISTANT', participantId: ALICE, swipeGroupId: SWIPE_GROUP, swipeIndex: 0 }),
      message(REPLY_B, { role: 'ASSISTANT', participantId: ALICE, swipeGroupId: SWIPE_GROUP, swipeIndex: 1 }),
      message(HOST_RECORD, { role: 'ASSISTANT', systemSender: 'host' }),
    ],
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:10:00.000Z',
  }
}

describe('executeImport — message ids of a chat imported under a fresh id (bug 199)', () => {
  /** Every chat row by id, and every message row by its (global) id. */
  let chats: Map<string, Record<string, unknown>>
  let messages: Map<string, { chatId: string; message: Record<string, unknown> }>
  let chatsCreate: jest.Mock
  let informsCreate: jest.Mock
  let annotationsCreate: jest.Mock
  let memoriesCreate: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    chats = new Map()
    messages = new Map()

    chatsCreate = jest.fn(async (data: Record<string, unknown>, opts?: { id?: string }) => {
      const id = (data.id as string | undefined) ?? opts?.id ?? generateId()
      const row = { ...data, id }
      chats.set(id, row)
      return row
    })
    const chatsRepo = repoStub({
      findById: jest.fn(async (id: string) => chats.get(id) ?? null),
      create: chatsCreate,
      addMessage: jest.fn(async (chatId: string, msg: Record<string, unknown>) => {
        const id = msg.id as string
        if (messages.has(id)) throw new Error('UNIQUE constraint failed: chat_messages.id')
        messages.set(id, { chatId, message: msg })
        return msg
      }),
      getMessages: jest.fn(async (chatId: string) =>
        [...messages.values()].filter((m) => m.chatId === chatId).map((m) => m.message)
      ),
    })
    memoriesCreate = jest.fn(async (data: Record<string, unknown>, opts?: { id?: string }) => ({
      ...data,
      id: opts?.id ?? generateId(),
    }))
    const userRepos = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === 'chats') return chatsRepo
        if (prop === 'memories') return repoStub({ create: memoriesCreate })
        if (prop === 'characters') {
          return repoStub({ findById: jest.fn(async (id: string) => (id === ALICE_CHARACTER ? { id } : null)) })
        }
        return repoStub()
      },
    })

    informsCreate = jest.fn(async (data: Record<string, unknown>) => ({ ...data, id: generateId() }))
    annotationsCreate = jest.fn(async (data: Record<string, unknown>) => ({ ...data, id: generateId() }))
    const globalRepos = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === 'chatInforms') return repoStub({ create: informsCreate })
        if (prop === 'conversationAnnotations') return repoStub({ create: annotationsCreate })
        return repoStub()
      },
    })
    ;(getUserRepositories as jest.Mock).mockReturnValue(userRepos)
    ;(getRepositories as jest.Mock).mockReturnValue(globalRepos)
  })

  /** Seed the original chat and its messages, as on the exporting instance. */
  function seedOriginal() {
    const chat = bundleChat()
    chats.set(chat.id, { ...chat })
    for (const m of chat.messages) messages.set(m.id, { chatId: chat.id, message: m })
  }

  function archive() {
    return {
      manifest: createMockExportManifest({ exportType: 'chats' }),
      data: {
        chats: [bundleChat()],
        chatInforms: [
          {
            id: generateId(),
            chatId: SOURCE_CHAT_ID,
            batchId: 'batch-1',
            participantId: ALICE,
            contentMarkdown: 'The kettle is enchanted.',
            recordMessageId: HOST_RECORD,
            consumedAt: '2026-10-12T00:06:00.000Z',
            consumedByMessageId: REPLY_B,
            createdAt: '2026-10-12T00:04:00.000Z',
            updatedAt: '2026-10-12T00:06:00.000Z',
          },
        ],
        conversationAnnotations: [
          {
            id: generateId(),
            chatId: SOURCE_CHAT_ID,
            messageIndex: 1,
            sourceMessageId: REPLY_A,
            characterName: 'Alice',
            content: 'a note',
            createdAt: '2026-10-12T00:04:00.000Z',
            updatedAt: '2026-10-12T00:04:00.000Z',
          },
        ],
      },
    }
  }

  const copiesOf = () => [...chats.values()].filter((c) => c.id !== SOURCE_CHAT_ID)
  const messagesOf = (chatId: string) =>
    [...messages.values()].filter((m) => m.chatId === chatId).map((m) => m.message)

  it('duplicates a chat beside its original with every message, under fresh ids', async () => {
    seedOriginal()

    const result = await executeImport(generateId(), archive() as never, {
      conflictStrategy: 'duplicate',
      includeMemories: false,
      includeRelatedEntities: true,
    })

    expect(result.warnings.filter((w) => w.includes('UNIQUE'))).toEqual([])
    expect(result.imported.chats).toBe(1)
    expect(result.imported.messages).toBe(4)

    const [copy] = copiesOf()
    expect(copy.title).toBe('The Clockwork Tea (imported)')
    const copied = messagesOf(copy.id as string)
    expect(copied).toHaveLength(4)
    const sourceIds = [USER_MSG, REPLY_A, REPLY_B, HOST_RECORD]
    for (const m of copied) expect(sourceIds).not.toContain(m.id)
    // The original is untouched.
    expect(messagesOf(SOURCE_CHAT_ID).map((m) => m.id)).toEqual(sourceIds)

    const [newUser, newA, newB, newHost] = copied.map((m) => m.id as string)

    // Swipe siblings stay grouped, under the reminted anchor.
    expect(copied[1].swipeGroupId).toBe(`swipe-${newA}`)
    expect(copied[2].swipeGroupId).toBe(`swipe-${newA}`)

    // Chat-row message references follow; an anchor with no message is dropped.
    expect(copy.summaryAnchorMessageIds).toEqual([newUser, newA])
    expect(copy.otherExtractionWatermarkMessageId).toBe(newB)
    expect(copy.courierCheckpoints).toEqual({
      [ALICE_CHARACTER]: { lastResolvedMessageId: newB, resolvedAt: '2026-10-12T00:05:00.000Z' },
    })

    // Sidecars follow the copy's chat id and its messages.
    expect(informsCreate).toHaveBeenCalledTimes(1)
    expect(informsCreate.mock.calls[0][0]).toMatchObject({
      chatId: copy.id,
      recordMessageId: newHost,
      consumedByMessageId: newB,
    })
    expect(annotationsCreate.mock.calls[0][0]).toMatchObject({ chatId: copy.id, sourceMessageId: newA })
  })

  it('imports the same bundle twice without preserveIds and keeps every message both times', async () => {
    const options = { conflictStrategy: 'duplicate' as const, includeMemories: false, includeRelatedEntities: true }

    const first = await executeImport(generateId(), archive() as never, options)
    const second = await executeImport(generateId(), archive() as never, options)

    expect(first.imported.messages).toBe(4)
    expect(second.imported.messages).toBe(4)
    expect(second.warnings.filter((w) => w.includes('UNIQUE'))).toEqual([])

    const copies = copiesOf()
    expect(copies).toHaveLength(2)
    for (const copy of copies) expect(messagesOf(copy.id as string)).toHaveLength(4)
  })

  it('remaps a memory\'s sourceMessageId to the duplicated message', async () => {
    const idMaps = {
      characters: new Map([[ALICE_CHARACTER, ALICE_CHARACTER]]),
      chats: new Map([[SOURCE_CHAT_ID, 'chat-copy']]),
      projects: new Map(),
      tags: new Map(),
      preserveIdsSkips: new Set(),
      messages: new Map([[REPLY_A, 'reply-a-copy']]),
    }
    const memory = {
      id: generateId(),
      characterId: ALICE_CHARACTER,
      chatId: SOURCE_CHAT_ID,
      sourceMessageId: REPLY_A,
      content: 'Alice likes tea.',
      summary: 'tea',
      tags: [],
      relatedMemoryIds: [],
      createdAt: '2026-10-12T00:04:00.000Z',
      updatedAt: '2026-10-12T00:04:00.000Z',
    }

    await importMemories(
      generateId(),
      [memory] as never,
      { conflictStrategy: 'duplicate', includeMemories: true, includeRelatedEntities: true },
      idMaps as never,
      (getUserRepositories as jest.Mock)(),
      []
    )

    expect(memoriesCreate).toHaveBeenCalledTimes(1)
    expect(memoriesCreate.mock.calls[0][0]).toMatchObject({ chatId: 'chat-copy', sourceMessageId: 'reply-a-copy' })
  })

  it('keeps source message ids under preserveIds', async () => {
    const result = await executeImport(generateId(), archive() as never, {
      conflictStrategy: 'skip',
      includeMemories: false,
      includeRelatedEntities: true,
      preserveIds: true,
    })

    expect(result.imported.messages).toBe(4)
    expect(messagesOf(SOURCE_CHAT_ID).map((m) => m.id)).toEqual([USER_MSG, REPLY_A, REPLY_B, HOST_RECORD])
  })
})

describe('remintChatMessageIds', () => {
  it('keeps an opaque swipe group key that names no message', () => {
    let n = 0
    const { messages } = remintChatMessageIds(
      {},
      [message(REPLY_A, { swipeGroupId: 'swipe-3' })] as never,
      () => `new-${++n}`
    )
    expect(messages[0]).toMatchObject({ id: 'new-1', swipeGroupId: 'swipe-3' })
  })

  it('nulls unresolvable watermarks and checkpoints, and leaves absent fields absent', () => {
    const result = remintChatMessageIds(
      {
        otherExtractionWatermarkMessageId: 'gone',
        courierCheckpoints: { c: { lastResolvedMessageId: 'gone', resolvedAt: 'x' } },
      },
      [message(USER_MSG)] as never
    )
    expect(result.chatPatch).toEqual({ otherExtractionWatermarkMessageId: null, courierCheckpoints: null })
    expect(result.droppedRefs).toBe(2)
    expect('summaryAnchorMessageIds' in result.chatPatch).toBe(false)
  })
})
