/**
 * Unit tests for Phase C / G / "no user character" pure-function helpers
 * in lib/services/host-notifications/writer.ts
 *
 * These content builders produce the Salon messages for scenario announcements,
 * user-character introductions, multi-character rosters, silent mode, join
 * scenarios, timestamps, and the "no user-controlled character" advisory.
 *
 * The idempotence check on postHostNoUserCharacterAnnouncement is also covered
 * here as a regression test for the memory-pipeline no-user-character whisper.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getCollection: jest.fn(),
  getDatabaseAsync: jest.fn(),
  ensureCollection: jest.fn(),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn().mockRejectedValue(new Error('no vault')),
}))

const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}

import {
  buildScenarioContent,
  buildUserCharacterContent,
  buildMultiCharacterRosterContent,
  buildSilentModeEntryContent,
  buildSilentModeExitContent,
  buildJoinScenarioContent,
  buildTimestampContent,
  postHostNoUserCharacterAnnouncement,
} from '@/lib/services/host-notifications/writer'
import type { OtherParticipantInfo } from '@/lib/chat/context/system-prompt-builder'

// ---------------------------------------------------------------------------
// buildScenarioContent
// ---------------------------------------------------------------------------

describe('buildScenarioContent', () => {
  it('includes the scenario text', () => {
    const result = buildScenarioContent('The party gathers at the ancient keep.')
    expect(result).toContain('The party gathers at the ancient keep.')
  })

  it('begins with the Host setting the scene', () => {
    const result = buildScenarioContent('A dimly lit library.')
    expect(result).toMatch(/^The Host sets the scene/)
  })

  it('trims leading/trailing whitespace from the scenario text', () => {
    const result = buildScenarioContent('   A fog-bound harbour.   ')
    expect(result).toContain('A fog-bound harbour.')
    expect(result).not.toContain('   A fog')
  })
})

// ---------------------------------------------------------------------------
// buildUserCharacterContent
// ---------------------------------------------------------------------------

describe('buildUserCharacterContent', () => {
  it('introduces the user character by name', () => {
    const result = buildUserCharacterContent('Charlie', 'A wandering scholar.')
    expect(result).toContain('Charlie')
  })

  it('includes description when non-empty', () => {
    const result = buildUserCharacterContent('Charlie', 'A wandering scholar.')
    expect(result).toContain('A wandering scholar.')
  })

  it('uses the no-description fallback when description is null', () => {
    const result = buildUserCharacterContent('Charlie', null)
    expect(result).toContain('Charlie')
    expect(result).toContain("user's voice in this conversation")
  })

  it('uses the no-description fallback when description is undefined', () => {
    const result = buildUserCharacterContent('Charlie', undefined)
    expect(result).toContain("user's voice in this conversation")
  })

  it('uses the no-description fallback when description is only whitespace', () => {
    const result = buildUserCharacterContent('Charlie', '   ')
    expect(result).toContain("user's voice in this conversation")
  })
})

// ---------------------------------------------------------------------------
// buildMultiCharacterRosterContent
// ---------------------------------------------------------------------------

describe('buildMultiCharacterRosterContent', () => {
  it('returns a standalone message when there are no other participants', () => {
    const result = buildMultiCharacterRosterContent('Friday', [])
    expect(result).toContain('Friday')
    expect(result).toContain('stands alone in the Salon')
  })

  it('announces the company present when others are listed', () => {
    const others: OtherParticipantInfo[] = [
      {
        name: 'Reginald',
        type: 'CHARACTER',
        description: 'A pompous barrister.',
        status: 'active',
      },
    ]
    const result = buildMultiCharacterRosterContent('Friday', others)
    expect(result).toContain('The Host outlines the company present in the Salon:')
    expect(result).toContain('Reginald')
  })

  it('includes the responding character name in the standalone fallback', () => {
    const result = buildMultiCharacterRosterContent('Constance', [])
    expect(result).toContain('Constance')
  })
})

// ---------------------------------------------------------------------------
// buildSilentModeEntryContent
// ---------------------------------------------------------------------------

describe('buildSilentModeEntryContent', () => {
  it('addresses the character by name', () => {
    const result = buildSilentModeEntryContent('Viola')
    expect(result).toContain('Viola')
  })

  it('instructs not to speak aloud', () => {
    const result = buildSilentModeEntryContent('Viola')
    expect(result).toContain('MUST NOT speak out loud')
  })

  it('labels it as a private note from the Host', () => {
    const result = buildSilentModeEntryContent('Viola')
    expect(result).toContain('private note to Viola alone')
  })

  it('mentions that the rule remains until lifted', () => {
    const result = buildSilentModeEntryContent('Viola')
    expect(result).toContain('remains in force until the Host whispers')
  })
})

// ---------------------------------------------------------------------------
// buildSilentModeExitContent
// ---------------------------------------------------------------------------

describe('buildSilentModeExitContent', () => {
  it('addresses the character by name', () => {
    const result = buildSilentModeExitContent('Viola')
    expect(result).toContain('Viola')
  })

  it('lifts the silence', () => {
    const result = buildSilentModeExitContent('Viola')
    expect(result).toContain('silence is lifted')
  })

  it('confirms the character may speak again', () => {
    const result = buildSilentModeExitContent('Viola')
    expect(result).toContain('may speak aloud again')
  })
})

// ---------------------------------------------------------------------------
// buildJoinScenarioContent
// ---------------------------------------------------------------------------

describe('buildJoinScenarioContent', () => {
  it('addresses the character by name', () => {
    const result = buildJoinScenarioContent('Montague', 'He arrived by moonlit carriage.')
    expect(result).toContain('Montague')
  })

  it('includes the join scenario text', () => {
    const result = buildJoinScenarioContent('Montague', 'He arrived by moonlit carriage.')
    expect(result).toContain('He arrived by moonlit carriage.')
  })

  it('labels it as a private note from the Host', () => {
    const result = buildJoinScenarioContent('Montague', 'Anything here.')
    expect(result).toContain('private note to Montague alone')
  })

  it('trims leading/trailing whitespace from the join scenario', () => {
    const result = buildJoinScenarioContent('Montague', '  She swept in.  ')
    expect(result).toContain('She swept in.')
    expect(result).not.toContain('  She swept in')
  })
})

// ---------------------------------------------------------------------------
// buildTimestampContent
// ---------------------------------------------------------------------------

describe('buildTimestampContent', () => {
  it('includes the formatted time string', () => {
    const result = buildTimestampContent('Tuesday, 29 April 2026 at 18:00')
    expect(result).toContain('Tuesday, 29 April 2026 at 18:00')
  })

  it('begins with the Host marking the time', () => {
    const result = buildTimestampContent('noon')
    expect(result).toMatch(/^The Host marks the time/)
  })
})

// ---------------------------------------------------------------------------
// postHostNoUserCharacterAnnouncement — idempotence regression
// ---------------------------------------------------------------------------

describe('postHostNoUserCharacterAnnouncement', () => {
  const CHAT_ID = 'chat-idempotence-test'

  function makeAddMessage() {
    return jest.fn().mockResolvedValue(undefined)
  }

  function makeChatWithNoMessages(addMessage = makeAddMessage()) {
    return {
      id: CHAT_ID,
      messages: [],
      addMessage,
    }
  }

  function makeChatWithExistingWhisper(addMessage = makeAddMessage()) {
    return {
      id: CHAT_ID,
      messages: [
        {
          type: 'message',
          systemSender: 'host',
          systemKind: 'no-user-character',
        },
      ],
      addMessage,
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('posts the whisper when none has been sent yet', async () => {
    const addMessage = makeAddMessage()
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue(makeChatWithNoMessages(addMessage)),
        addMessage,
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostNoUserCharacterAnnouncement({ chatId: CHAT_ID })
    expect(addMessage).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
  })

  it('is idempotent — does NOT post a second whisper when one already exists', async () => {
    const addMessage = makeAddMessage()
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue(makeChatWithExistingWhisper(addMessage)),
        addMessage,
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostNoUserCharacterAnnouncement({ chatId: CHAT_ID })
    expect(addMessage).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('returns null and does not throw when the chat is not found', async () => {
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue(null),
        addMessage: makeAddMessage(),
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostNoUserCharacterAnnouncement({ chatId: 'missing-chat' })
    expect(result).toBeNull()
  })

  it('returns null and does not throw when the repo call rejects', async () => {
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockRejectedValue(new Error('DB failure')),
        addMessage: makeAddMessage(),
      },
    } as unknown as ReturnType<typeof getRepositories>)

    const result = await postHostNoUserCharacterAnnouncement({ chatId: CHAT_ID })
    expect(result).toBeNull()
  })

  it('the posted message carries the host-no-user-character systemKind', async () => {
    const addMessage = makeAddMessage()
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue(makeChatWithNoMessages()),
        addMessage,
      },
    } as unknown as ReturnType<typeof getRepositories>)

    await postHostNoUserCharacterAnnouncement({ chatId: CHAT_ID })

    const [chatIdArg, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(chatIdArg).toBe(CHAT_ID)
    expect(message.systemSender).toBe('host')
    expect(message.systemKind).toBe('no-user-character')
    expect(typeof message.content).toBe('string')
    expect((message.content as string).length).toBeGreaterThan(0)
  })
})
