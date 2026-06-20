/**
 * Unit tests for the Character Rename / Replace service.
 *
 * Covers preview (dry-run) counting, executed writes across character fields /
 * memories / chats, case sensitivity, and the rule that Staff-authored
 * (systemSender) messages are never rewritten.
 */

import { runCharacterRename } from '@/lib/services/character-rename.service'
import type { RenameRequest } from '@/lib/services/character-rename.service'
import { enqueueConversationRender } from '@/lib/background-jobs/queue-service'
import {
  createMockCharacter,
  createMockChat,
  createMockMemory,
  createMockMessage,
} from '../fixtures/test-factories'

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueConversationRender: jest.fn(),
}))

type RenameRepos = Parameters<typeof runCharacterRename>[3]

const enqueueRenderMock = jest.mocked(enqueueConversationRender)

/** Build a mock repos surface exposing only what the service touches. */
function buildRepos(over: {
  memories?: unknown[]
  chats?: unknown[]
  messagesByChat?: Record<string, unknown[]>
} = {}) {
  const memoryUpdate = jest.fn().mockResolvedValue(null)
  const characterUpdate = jest.fn().mockResolvedValue(null)
  const chatUpdate = jest.fn().mockResolvedValue(null)
  const messageUpdate = jest.fn().mockResolvedValue(null)

  const repos = {
    characters: { update: characterUpdate },
    memories: {
      findByCharacterId: jest.fn().mockResolvedValue(over.memories ?? []),
      update: memoryUpdate,
    },
    chats: {
      findByCharacterId: jest.fn().mockResolvedValue(over.chats ?? []),
      getMessages: jest.fn().mockImplementation(async (chatId: string) =>
        over.messagesByChat?.[chatId] ?? []
      ),
      update: chatUpdate,
      updateMessage: messageUpdate,
    },
  }

  return { repos: repos as unknown as RenameRepos, characterUpdate, memoryUpdate, chatUpdate, messageUpdate }
}

const renameDaciana = (over: Partial<RenameRequest> = {}): RenameRequest => ({
  primaryRename: { oldValue: 'Daciana', newValue: 'Morgan', caseSensitive: false },
  additionalReplacements: [],
  dryRun: true,
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  enqueueRenderMock.mockResolvedValue({ jobId: 'job-1', isNew: true })
})

describe('runCharacterRename — preview (dry run)', () => {
  it('counts occurrences across character fields without writing', async () => {
    const character = createMockCharacter({
      name: 'Daciana',
      description: 'Daciana is brave. Everyone respects Daciana.',
      personality: 'Reserved',
    })
    const { repos, characterUpdate } = buildRepos()

    const result = await runCharacterRename(character, renameDaciana(), 'user-1', repos)

    // name (1) + description (2) = 3 character-field matches
    expect(result.summary.characterFields).toBe(3)
    expect(result.summary.total).toBe(3)
    expect(result.dryRun).toBe(true)
    expect(result.replacements.length).toBeGreaterThan(0)
    expect(characterUpdate).not.toHaveBeenCalled()
  })

  it('counts memory and chat matches and skips Staff messages', async () => {
    const character = createMockCharacter({ id: 'char-1', name: 'Daciana' })
    const chat = createMockChat({ id: 'chat-1', title: 'A talk with Daciana' })
    const userMsg = createMockMessage({ id: 'm1', content: 'Hello Daciana, how are you?' })
    const staffMsg = createMockMessage({ id: 'm2', content: 'Daciana has joined', systemSender: 'host' })
    const memory = createMockMemory({ id: 'mem-1', content: 'Daciana likes tea', summary: 'about Daciana' })

    const { repos } = buildRepos({
      memories: [memory],
      chats: [chat],
      messagesByChat: { 'chat-1': [userMsg, staffMsg] },
    })

    const result = await runCharacterRename(character, renameDaciana(), 'user-1', repos)

    expect(result.summary.chatTitles).toBe(1)
    expect(result.summary.chatMessages).toBe(1) // staff message NOT counted
    expect(result.summary.memories).toBe(2) // content + summary
  })
})

describe('runCharacterRename — execute', () => {
  it('writes character, memory, and chat updates and re-renders touched chats', async () => {
    const character = createMockCharacter({ id: 'char-1', name: 'Daciana', description: 'Daciana the brave' })
    const chat = createMockChat({ id: 'chat-1', title: 'Daciana session' })
    const userMsg = createMockMessage({ id: 'm1', content: 'Hi Daciana' })
    const staffMsg = createMockMessage({ id: 'm2', content: 'Daciana joined', systemSender: 'host' })
    const memory = createMockMemory({ id: 'mem-1', content: 'Daciana is kind', summary: 'note' })

    const { repos, characterUpdate, memoryUpdate, chatUpdate, messageUpdate } = buildRepos({
      memories: [memory],
      chats: [chat],
      messagesByChat: { 'chat-1': [userMsg, staffMsg] },
    })

    await runCharacterRename(character, renameDaciana({ dryRun: false }), 'user-1', repos)

    expect(characterUpdate).toHaveBeenCalledWith('char-1', expect.objectContaining({
      name: 'Morgan',
      description: 'Morgan the brave',
    }))
    expect(memoryUpdate).toHaveBeenCalledWith('mem-1', { content: 'Morgan is kind' })
    expect(chatUpdate).toHaveBeenCalledWith('chat-1', { title: 'Morgan session' })
    expect(messageUpdate).toHaveBeenCalledWith('chat-1', 'm1', { content: 'Hi Morgan' })
    // Staff message left untouched
    expect(messageUpdate).not.toHaveBeenCalledWith('chat-1', 'm2', expect.anything())
    // Archive re-render enqueued for the chat whose messages changed
    expect(enqueueRenderMock).toHaveBeenCalledWith('user-1', { chatId: 'chat-1', fullReembed: true })
  })

  it('does not write when nothing matches', async () => {
    const character = createMockCharacter({ name: 'Daciana' })
    const { repos, characterUpdate } = buildRepos()

    const result = await runCharacterRename(
      character,
      { additionalReplacements: [{ oldValue: 'Nonexistent', newValue: 'X', caseSensitive: false }], dryRun: false },
      'user-1',
      repos
    )

    expect(result.summary.total).toBe(0)
    expect(characterUpdate).not.toHaveBeenCalled()
    expect(enqueueRenderMock).not.toHaveBeenCalled()
  })
})

describe('runCharacterRename — case sensitivity', () => {
  it('respects case-sensitive matching', async () => {
    const character = createMockCharacter({ name: 'Voss', description: 'voss and Voss' })
    const { repos } = buildRepos()

    const result = await runCharacterRename(
      character,
      { additionalReplacements: [{ oldValue: 'Voss', newValue: 'Morariu', caseSensitive: true }], dryRun: true },
      'user-1',
      repos
    )

    // name 'Voss' (1) + description 'Voss' only, not 'voss' (1) = 2
    expect(result.summary.characterFields).toBe(2)
  })
})
