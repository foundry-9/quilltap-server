/**
 * Importing a `.qtap` bundle from before the three Concierge states.
 *
 * `chats.conciergeOverride` was dropped in 4.10 and `ChatMetadataSchema` no
 * longer declares it, so the repository would strip it silently. The importer
 * must therefore derive `conciergeMode` from the raw bundle JSON *before*
 * `repos.chats.create` — on both the fresh-insert and the duplicate path.
 */

import { createMockExportManifest, generateId } from '../fixtures/test-factories'

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
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory'
import { ChatMetadataSchema } from '@/lib/schemas/chat.types'

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

const OLD_CHAT_ID = 'chat-from-before-the-three-states'

describe('executeImport — legacy conciergeOverride', () => {
  let chatsCreate: jest.Mock
  let existingChat: Record<string, unknown> | null

  beforeEach(() => {
    jest.clearAllMocks()
    existingChat = null
    chatsCreate = jest.fn(async (data: Record<string, unknown>) => ({ ...data, id: generateId() }))
    const chatsRepo = repoStub({
      findById: jest.fn(async (id: string) => (id === OLD_CHAT_ID ? existingChat : null)),
      create: chatsCreate,
      addMessage: jest.fn().mockResolvedValue(undefined),
      getMessages: jest.fn(async () => []),
    })
    const userRepos = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        return prop === 'chats' ? chatsRepo : repoStub()
      },
    })
    ;(getUserRepositories as jest.Mock).mockReturnValue(userRepos)
    ;(getRepositories as jest.Mock).mockReturnValue(new Proxy({}, { get: () => repoStub() }))
  })

  function bundle(conciergeOverride: string | null, isDangerousChat = false) {
    return {
      manifest: createMockExportManifest({ exportType: 'chats' }),
      data: {
        chats: [
          {
            id: OLD_CHAT_ID,
            userId: 'someone-else',
            title: 'Before the Three States',
            participants: [],
            tags: [],
            messages: [],
            conciergeOverride,
            isDangerousChat,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      },
    }
  }

  async function run(conciergeOverride: string | null, isDangerousChat = false) {
    return executeImport(generateId(), bundle(conciergeOverride, isDangerousChat) as never, {
      conflictStrategy: 'duplicate',
      includeMemories: false,
      includeRelatedEntities: true,
    })
  }

  it("derives Locked from conciergeOverride 'OFF' on a fresh insert", async () => {
    await run('OFF')
    expect(chatsCreate.mock.calls[0][0]).toMatchObject({
      conciergeMode: 'locked',
      conciergeModeSetBy: 'operator',
      conciergeModeReason: 'migration',
    })
  })

  it("derives Unmoderated from conciergeOverride 'UNCENSORED' on the duplicate path", async () => {
    existingChat = { id: OLD_CHAT_ID }
    await run('UNCENSORED')
    expect(chatsCreate.mock.calls[0][0]).toMatchObject({
      conciergeMode: 'unmoderated',
      conciergeModeSetBy: 'operator',
    })
  })

  it('derives Unmoderated (the Concierge, classifier) from a flagged chat with no override', async () => {
    await run(null, true)
    expect(chatsCreate.mock.calls[0][0]).toMatchObject({
      conciergeMode: 'unmoderated',
      conciergeModeSetBy: 'concierge',
      conciergeModeReason: 'classifier',
    })
  })

  it('the schema no longer declares conciergeOverride, which is why derivation must come first', () => {
    expect('conciergeOverride' in ChatMetadataSchema.shape).toBe(false)
  })
})
