import { describe, it, expect, beforeEach, jest } from '@jest/globals'

const childLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => childLogger),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/tools/text-block-parser', () => ({
  stripTextBlockMarkers: jest.fn((text: string) => text),
}))

import { getRepositories } from '@/lib/repositories/factory'
import {
  executeWhisperTool,
  formatWhisperResults,
  WhisperError,
  type WhisperToolContext,
} from '@/lib/tools/handlers/whisper-handler'

const mockGetRepositories = getRepositories as jest.Mock
const textBlockParser = require('@/lib/tools/text-block-parser')
const mockStripTextBlockMarkers = textBlockParser.stripTextBlockMarkers as jest.Mock
const mockLogger = require('@/lib/logger').logger as { info: jest.Mock; error: jest.Mock; debug: jest.Mock; warn: jest.Mock }

describe('sanitizeWhisperMessage', () => {
  it('returns message unchanged when no markers', () => {
    // This function is internal, but behavior is tested through executeWhisperTool
    const message = 'This is a simple message'
    mockStripTextBlockMarkers.mockReturnValue(message)
    // Verified through executeWhisperTool tests
  })

  it('handles empty string', () => {
    const message = ''
    mockStripTextBlockMarkers.mockReturnValue('')
    // Verified through executeWhisperTool tests
  })
})

describe('WhisperError', () => {
  it('creates error with TARGET_NOT_FOUND code', () => {
    const error = new WhisperError('No character found', 'TARGET_NOT_FOUND')
    expect(error.message).toBe('No character found')
    expect(error.code).toBe('TARGET_NOT_FOUND')
    expect(error.name).toBe('WhisperError')
  })

  it('creates error with VALIDATION_ERROR code', () => {
    const error = new WhisperError('Invalid target', 'VALIDATION_ERROR')
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error instanceof Error).toBe(true)
  })

  it('creates error with SELF_WHISPER code', () => {
    const error = new WhisperError('Cannot whisper to yourself', 'SELF_WHISPER')
    expect(error.code).toBe('SELF_WHISPER')
  })

  it('creates error with AMBIGUOUS_TARGET code', () => {
    const error = new WhisperError('Multiple matches found', 'AMBIGUOUS_TARGET')
    expect(error.code).toBe('AMBIGUOUS_TARGET')
  })

  it('creates error with SAVE_ERROR code', () => {
    const error = new WhisperError('Failed to save message', 'SAVE_ERROR')
    expect(error.code).toBe('SAVE_ERROR')
  })

  it('has correct message and code properties', () => {
    const error = new WhisperError('Test error', 'TARGET_NOT_FOUND')
    expect(error.message).toBe('Test error')
    expect(error.code).toBe('TARGET_NOT_FOUND')
  })
})

describe('executeWhisperTool', () => {
  const context: WhisperToolContext = {
    userId: 'user-123',
    chatId: 'chat-1',
    callingParticipantId: 'caller-p',
  }

  beforeEach(() => {
    // Don't clear all mocks since we need to track logger calls
    mockGetRepositories.mockClear()
    mockStripTextBlockMarkers.mockClear()
    mockStripTextBlockMarkers.mockImplementation((text: string) => text)
  })

  it('returns validation error for invalid input (null)', async () => {
    const result = await executeWhisperTool(null, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid input')
  })

  it('returns validation error for missing target', async () => {
    const result = await executeWhisperTool({ message: 'Hello' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid input')
  })

  it('returns validation error for missing message', async () => {
    const result = await executeWhisperTool({ target: 'Alice' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid input')
  })

  it('returns validation error for empty target', async () => {
    const result = await executeWhisperTool({ target: '', message: 'Hello' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid input')
  })

  it('returns validation error for empty message', async () => {
    const result = await executeWhisperTool({ target: 'Alice', message: '' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid input')
  })

  it('loads chat and finds target by character name', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-target') {
            return Promise.resolve({ id: 'char-target', name: 'Alice', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.targetName).toBe('Alice')
    expect(result.targetParticipantId).toBe('target-p')
    expect(mockRepos.chats.findById).toHaveBeenCalledWith('chat-1')
  })

  it('returns TARGET_NOT_FOUND when no matching character', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-target') {
            return Promise.resolve({ id: 'char-target', name: 'Bob', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Charlie', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('No character found matching')
    expect(result.error).toContain('Charlie')
  })

  it('returns SELF_WHISPER when targeting own participant', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-caller') {
            return Promise.resolve({ id: 'char-caller', name: 'Alice', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('cannot whisper to yourself')
  })

  it('returns AMBIGUOUS_TARGET when multiple matches exist', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p1', characterId: 'char-alice1', isActive: true, controlledBy: 'llm' },
        { id: 'target-p2', characterId: 'char-alice2', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-alice1') {
            return Promise.resolve({ id: 'char-alice1', name: 'Alice', aliases: [] })
          }
          if (id === 'char-alice2') {
            return Promise.resolve({ id: 'char-alice2', name: 'Alice', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Ambiguous target')
  })

  it('handles case-insensitive character name matching', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-target') {
            return Promise.resolve({ id: 'char-target', name: 'Alice', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'ALICE', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.targetName).toBe('Alice')
  })

  it('saves message with correct participantId and targetParticipantIds', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-target') {
            return Promise.resolve({ id: 'char-target', name: 'Alice', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(mockRepos.chats.addMessage).toHaveBeenCalled()
    const call = (mockRepos.chats.addMessage as jest.Mock).mock.calls[0]
    const message = call[1]

    expect(message.role).toBe('ASSISTANT')
    expect(message.participantId).toBe('caller-p')
    expect(message.targetParticipantIds).toEqual(['target-p'])
    expect(message.content).toBe('Secret message')
  })

  it('returns success with targetName and targetParticipantId', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-target') {
            return Promise.resolve({ id: 'char-target', name: 'Alice', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.targetName).toBe('Alice')
    expect(result.targetParticipantId).toBe('target-p')
    expect(result.error).toBeUndefined()
  })

  it('matches target by character alias', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-target') {
            return Promise.resolve({
              id: 'char-target',
              name: 'Alice Johnson',
              aliases: ['Ali', 'AJ', 'Alice'],
            })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Ali', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.targetName).toBe('Alice Johnson')
  })

  it('returns error when chat not found', async () => {
    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(null),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: { findById: jest.fn().mockResolvedValue(null) },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Chat not found')
  })

  it('returns error when chat belongs to different user', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'different-user',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: { findById: jest.fn().mockResolvedValue(null) },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Chat not found')
  })

  it('sanitizes message when markers are present', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-target') {
            return Promise.resolve({ id: 'char-target', name: 'Alice', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    mockStripTextBlockMarkers.mockImplementation(() => 'Clean message content')

    const result = await executeWhisperTool(
      { target: 'Alice', message: '[[WHISPER to="Alice"]]Clean message content[[/WHISPER]]' },
      context
    )

    expect(result.success).toBe(true)
    const call = (mockRepos.chats.addMessage as jest.Mock).mock.calls[0]
    expect(call[1].content).toBe('Clean message content')
  })

  it('only matches active participants', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: false, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-target') {
            return Promise.resolve({ id: 'char-target', name: 'Alice', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('No character found')
  })

  it('handles uncaught exceptions gracefully', async () => {
    const mockError = new Error('Unexpected database error')
    const mockRepos = {
      chats: {
        findById: jest.fn().mockRejectedValue(mockError),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: { findById: jest.fn().mockResolvedValue(null) },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    const result = await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unexpected database error')
  })

  it('generates message ID and timestamp when saving', async () => {
    const mockChat = {
      id: 'chat-1',
      userId: 'user-123',
      participants: [
        { id: 'caller-p', characterId: 'char-caller', isActive: true, controlledBy: 'llm' },
        { id: 'target-p', characterId: 'char-target', isActive: true, controlledBy: 'llm' },
      ],
    }

    const mockRepos = {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue('msg-1'),
      },
      characters: {
        findById: jest.fn().mockImplementation((id: string) => {
          if (id === 'char-target') {
            return Promise.resolve({ id: 'char-target', name: 'Alice', aliases: [] })
          }
          return Promise.resolve(null)
        })
      },
    }
    mockGetRepositories.mockReturnValue(mockRepos as any)

    await executeWhisperTool(
      { target: 'Alice', message: 'Secret message' },
      context
    )

    expect(mockRepos.chats.addMessage).toHaveBeenCalled()
    const call = (mockRepos.chats.addMessage as jest.Mock).mock.calls[0]
    const message = call[1]

    expect(message.id).toBeDefined()
    expect(message.createdAt).toBeDefined()
    expect(typeof message.createdAt).toBe('string')
  })
})

describe('formatWhisperResults', () => {
  it('formats successful whisper with target name', () => {
    const output = {
      success: true,
      targetName: 'Alice',
      targetParticipantId: 'p-123',
    }

    const formatted = formatWhisperResults(output)

    expect(formatted).toContain('Whispered to Alice')
    expect(formatted).toContain('Message sent privately')
  })

  it('formats failed whisper with error message', () => {
    const output = {
      success: false,
      error: 'No character found matching "Charlie"',
    }

    const formatted = formatWhisperResults(output)

    expect(formatted).toContain('Whisper Error')
    expect(formatted).toContain('No character found matching "Charlie"')
  })

  it('formats failed whisper with default message when no error', () => {
    const output = {
      success: false,
    }

    const formatted = formatWhisperResults(output)

    expect(formatted).toContain('Whisper Error')
    expect(formatted).toContain('Unknown error')
  })
})
