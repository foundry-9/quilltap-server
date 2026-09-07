/**
 * handleParticipantUpdate — subprompt selection changes recompile the seat's
 * cached identity stack, the same way a system-prompt change does. The
 * compare is order-insensitive so re-sending the same set in a different
 * order does not churn the cache.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}))

jest.mock('@/lib/api/middleware', () => ({
  enrichWithDefaultImage: jest.fn(),
  enrichWithApiKey: jest.fn(),
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostAddAnnouncement: jest.fn(),
  postHostStatusChangeAnnouncement: jest.fn(),
  postHostRemoveAnnouncement: jest.fn(),
  postHostSilentModeAnnouncement: jest.fn(),
  postHostJoinScenarioAnnouncement: jest.fn(),
}))

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  postProsperoConnectionProfileChangeAnnouncement: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/manual-flip', () => ({
  applyConciergeFlip: jest.fn(),
}))

const compileAllIdentityStacks = jest.fn()
const compileIdentityStackForParticipant = jest.fn()
jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileAllIdentityStacks: (...args: unknown[]) => compileAllIdentityStacks(...args),
  compileIdentityStackForParticipant: (...args: unknown[]) => compileIdentityStackForParticipant(...args),
}))

const { handleParticipantUpdate } = require('@/app/api/v1/chats/[id]/helpers')

describe('handleParticipantUpdate — selectedSubpromptIds', () => {
  const chatId = 'chat-1'
  const participantId = 'part-1'

  let repos: any
  let finalChat: any

  function setup(existingIds: string[] | undefined, nextIds: string[]) {
    const baseChat = {
      id: chatId,
      participants: [
        {
          id: participantId,
          type: 'CHARACTER',
          characterId: 'char-1',
          controlledBy: 'llm',
          status: 'active',
          selectedSubpromptIds: existingIds,
        },
      ],
      impersonatingParticipantIds: [],
      activeTypingParticipantId: null,
    }
    finalChat = {
      ...baseChat,
      participants: [{ ...baseChat.participants[0], selectedSubpromptIds: nextIds }],
    }
    repos = {
      chats: {
        findById: jest.fn().mockResolvedValueOnce(baseChat).mockResolvedValue(finalChat),
        updateParticipant: jest.fn().mockResolvedValue(finalChat),
        update: jest.fn().mockResolvedValue(finalChat),
      },
      characters: { findById: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Echo' }) },
      connections: { findById: jest.fn() },
      imageProfiles: { findById: jest.fn() },
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('recompiles the seat when the set of subprompts changes', async () => {
    setup(['terse'], ['terse', 'verse'])
    await handleParticipantUpdate(
      chatId,
      { participantId, selectedSubpromptIds: ['terse', 'verse'] } as any,
      'user-1',
      repos,
    )
    expect(repos.chats.updateParticipant).toHaveBeenCalledWith(
      chatId,
      participantId,
      expect.objectContaining({ selectedSubpromptIds: ['terse', 'verse'] }),
    )
    expect(compileIdentityStackForParticipant).toHaveBeenCalledTimes(1)
    expect(compileIdentityStackForParticipant).toHaveBeenCalledWith(finalChat, participantId)
    expect(compileAllIdentityStacks).not.toHaveBeenCalled()
  })

  it('recompiles when the last subprompt is switched off', async () => {
    setup(['terse'], [])
    await handleParticipantUpdate(
      chatId,
      { participantId, selectedSubpromptIds: [] } as any,
      'user-1',
      repos,
    )
    expect(compileIdentityStackForParticipant).toHaveBeenCalledTimes(1)
  })

  it('treats a reordered but identical set as unchanged', async () => {
    setup(['a', 'b'], ['b', 'a'])
    await handleParticipantUpdate(
      chatId,
      { participantId, selectedSubpromptIds: ['b', 'a'] } as any,
      'user-1',
      repos,
    )
    expect(compileIdentityStackForParticipant).not.toHaveBeenCalled()
  })

  it('does not recompile when the field is absent from the patch', async () => {
    setup(['a'], ['a'])
    await handleParticipantUpdate(
      chatId,
      { participantId, talkativeness: 0.7 } as any,
      'user-1',
      repos,
    )
    expect(compileIdentityStackForParticipant).not.toHaveBeenCalled()
  })
})
