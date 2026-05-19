/**
 * Unit tests for lib/services/system-prompt-compiler/compiler.ts
 *
 * Covers:
 * - getCompiledIdentityStack — pure cache-read helper
 * - compileAllIdentityStacks — fan-out compile for all eligible participants
 * - compileIdentityStackForParticipant — single-participant compile + merge
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}

import {
  getCompiledIdentityStack,
  compileAllIdentityStacks,
  compileIdentityStackForParticipant,
} from '@/lib/services/system-prompt-compiler/compiler'
import type { ChatMetadataBase, ChatParticipantBase } from '@/lib/schemas/types'

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeParticipant(overrides: Partial<ChatParticipantBase> = {}): ChatParticipantBase {
  return {
    id: 'part-1',
    type: 'CHARACTER',
    characterId: 'char-1',
    controlledBy: 'llm',
    status: 'active',
    selectedSystemPromptId: null,
    ...overrides,
  } as ChatParticipantBase
}

function makeChat(overrides: Partial<ChatMetadataBase> = {}): ChatMetadataBase {
  return {
    id: 'chat-1',
    participants: [],
    compiledIdentityStacks: null,
    scenarioText: null,
    ...overrides,
  } as unknown as ChatMetadataBase
}

function makeRepos(opts: {
  character?: Record<string, unknown> | null
  updateChat?: jest.Mock
} = {}) {
  return {
    characters: {
      findById: jest.fn().mockResolvedValue(
        opts.character !== undefined
          ? opts.character
          : { id: 'char-1', name: 'Friday', controlledBy: 'llm', description: 'Calm and precise.' },
      ),
    },
    chats: {
      update: opts.updateChat ?? jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as ReturnType<typeof getRepositories>
}

// ---------------------------------------------------------------------------
// getCompiledIdentityStack
// ---------------------------------------------------------------------------

describe('getCompiledIdentityStack', () => {
  it('returns null when compiledIdentityStacks is null', () => {
    const chat = makeChat({ compiledIdentityStacks: null })
    expect(getCompiledIdentityStack(chat, 'part-1')).toBeNull()
  })

  it('returns null when compiledIdentityStacks is undefined', () => {
    const chat = makeChat({ compiledIdentityStacks: undefined as unknown as null })
    expect(getCompiledIdentityStack(chat, 'part-1')).toBeNull()
  })

  it('returns null when the participant key is absent', () => {
    const chat = makeChat({ compiledIdentityStacks: { 'part-99': 'some stack' } })
    expect(getCompiledIdentityStack(chat, 'part-1')).toBeNull()
  })

  it('returns null when the stored value is an empty string', () => {
    const chat = makeChat({ compiledIdentityStacks: { 'part-1': '' } })
    expect(getCompiledIdentityStack(chat, 'part-1')).toBeNull()
  })

  it('returns the cached stack string when present', () => {
    const stack = '## System Prompt\nYou are Friday.'
    const chat = makeChat({ compiledIdentityStacks: { 'part-1': stack } })
    expect(getCompiledIdentityStack(chat, 'part-1')).toBe(stack)
  })

  it('returns the correct stack when multiple participants are cached', () => {
    const stackA = 'Stack for A'
    const stackB = 'Stack for B'
    const chat = makeChat({
      compiledIdentityStacks: { 'part-A': stackA, 'part-B': stackB },
    })
    expect(getCompiledIdentityStack(chat, 'part-A')).toBe(stackA)
    expect(getCompiledIdentityStack(chat, 'part-B')).toBe(stackB)
  })
})

// ---------------------------------------------------------------------------
// compileAllIdentityStacks
// ---------------------------------------------------------------------------

describe('compileAllIdentityStacks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('writes stacks for all eligible LLM-controlled CHARACTER participants', async () => {
    const updateChat = jest.fn().mockResolvedValue(undefined)
    getRepositories.mockReturnValue(makeRepos({ updateChat }))

    const participantA = makeParticipant({ id: 'part-a', characterId: 'char-a' })
    const participantB = makeParticipant({ id: 'part-b', characterId: 'char-b' })
    const chat = makeChat({ participants: [participantA, participantB] })

    await compileAllIdentityStacks(chat)

    expect(updateChat).toHaveBeenCalledTimes(1)
    const [chatId, update] = updateChat.mock.calls[0] as [string, Record<string, unknown>]
    expect(chatId).toBe('chat-1')
    const stacks = update.compiledIdentityStacks as Record<string, string>
    // Both eligible participants should have a non-empty compiled stack
    expect(typeof stacks['part-a']).toBe('string')
    expect((stacks['part-a'] as string).length).toBeGreaterThan(0)
    expect(typeof stacks['part-b']).toBe('string')
    expect((stacks['part-b'] as string).length).toBeGreaterThan(0)
  })

  it('skips user-controlled participants', async () => {
    const updateChat = jest.fn().mockResolvedValue(undefined)
    getRepositories.mockReturnValue(makeRepos({ updateChat }))

    const userParticipant = makeParticipant({ id: 'part-user', controlledBy: 'user' })
    const chat = makeChat({ participants: [userParticipant] })

    await compileAllIdentityStacks(chat)

    // No eligible participants → update is called with null stacks
    expect(updateChat).toHaveBeenCalledTimes(1)
    const [, update] = updateChat.mock.calls[0] as [string, Record<string, unknown>]
    expect(update.compiledIdentityStacks).toBeNull()
  })

  it('skips removed participants', async () => {
    const updateChat = jest.fn().mockResolvedValue(undefined)
    getRepositories.mockReturnValue(makeRepos({ updateChat }))

    const removedParticipant = makeParticipant({ id: 'part-removed', status: 'removed' })
    const chat = makeChat({ participants: [removedParticipant] })

    await compileAllIdentityStacks(chat)

    const [, update] = updateChat.mock.calls[0] as [string, Record<string, unknown>]
    expect(update.compiledIdentityStacks).toBeNull()
  })

  it('skips participants with no characterId', async () => {
    const updateChat = jest.fn().mockResolvedValue(undefined)
    getRepositories.mockReturnValue(makeRepos({ updateChat }))

    const noCharParticipant = makeParticipant({ id: 'part-no-char', characterId: undefined })
    const chat = makeChat({ participants: [noCharParticipant] })

    await compileAllIdentityStacks(chat)

    const [, update] = updateChat.mock.calls[0] as [string, Record<string, unknown>]
    expect(update.compiledIdentityStacks).toBeNull()
  })

  it('skips participants whose character cannot be found', async () => {
    const updateChat = jest.fn().mockResolvedValue(undefined)
    getRepositories.mockReturnValue(makeRepos({ character: null, updateChat }))

    const participant = makeParticipant()
    const chat = makeChat({ participants: [participant] })

    await compileAllIdentityStacks(chat)

    const [, update] = updateChat.mock.calls[0] as [string, Record<string, unknown>]
    expect(update.compiledIdentityStacks).toBeNull()
  })

  it('does not throw when the repo update fails', async () => {
    getRepositories.mockReturnValue({
      characters: { findById: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Friday' }) },
      chats: { update: jest.fn().mockRejectedValue(new Error('DB error')) },
    } as unknown as ReturnType<typeof getRepositories>)

    const chat = makeChat({ participants: [makeParticipant()] })
    await expect(compileAllIdentityStacks(chat)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// compileIdentityStackForParticipant
// ---------------------------------------------------------------------------

describe('compileIdentityStackForParticipant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('compiles and merges a new stack for the participant', async () => {
    const updateChat = jest.fn().mockResolvedValue(undefined)
    getRepositories.mockReturnValue(makeRepos({ updateChat }))

    const participant = makeParticipant({ id: 'part-new' })
    const chat = makeChat({
      participants: [participant],
      compiledIdentityStacks: { 'part-existing': '## Old Stack' },
    })

    await compileIdentityStackForParticipant(chat, 'part-new')

    expect(updateChat).toHaveBeenCalledTimes(1)
    const [, update] = updateChat.mock.calls[0] as [string, Record<string, unknown>]
    const stacks = update.compiledIdentityStacks as Record<string, string>
    // New participant stack is added as a non-empty string
    expect(typeof stacks['part-new']).toBe('string')
    expect((stacks['part-new'] as string).length).toBeGreaterThan(0)
    // Existing entry is preserved
    expect(stacks['part-existing']).toBe('## Old Stack')
  })

  it('does nothing when the participant ID is not found on the chat', async () => {
    const updateChat = jest.fn().mockResolvedValue(undefined)
    getRepositories.mockReturnValue(makeRepos({ updateChat }))

    const chat = makeChat({ participants: [] })
    await compileIdentityStackForParticipant(chat, 'ghost-participant')

    expect(updateChat).not.toHaveBeenCalled()
  })

  it('removes a stale entry when the participant is user-controlled (no longer eligible)', async () => {
    const updateChat = jest.fn().mockResolvedValue(undefined)
    getRepositories.mockReturnValue(makeRepos({ updateChat }))

    // A user-controlled participant is not eligible for stack compilation;
    // `buildStackFor` returns null for it, which triggers the stale-entry
    // removal path.
    const participant = makeParticipant({ id: 'part-stale', controlledBy: 'user' })
    const chat = makeChat({
      participants: [participant],
      compiledIdentityStacks: {
        'part-stale': '## Old stale stack',
        'part-other': '## Other',
      },
    })

    await compileIdentityStackForParticipant(chat, 'part-stale')

    expect(updateChat).toHaveBeenCalledTimes(1)
    const [, update] = updateChat.mock.calls[0] as [string, Record<string, unknown>]
    const stacks = update.compiledIdentityStacks as Record<string, string>
    expect('part-stale' in stacks).toBe(false)
    expect(stacks['part-other']).toBe('## Other')
  })

  it('does not throw when the repo update fails', async () => {
    getRepositories.mockReturnValue({
      characters: { findById: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Friday' }) },
      chats: { update: jest.fn().mockRejectedValue(new Error('DB write error')) },
    } as unknown as ReturnType<typeof getRepositories>)

    const participant = makeParticipant()
    const chat = makeChat({ participants: [participant] })

    await expect(
      compileIdentityStackForParticipant(chat, 'part-1'),
    ).resolves.toBeUndefined()
  })
})
