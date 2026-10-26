/**
 * Tests for the snapshot-whisper sweep, the whisper-scope predicate it uses,
 * and the turn transcript snapshot that feeds it.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

import { sweepPriorWhispers } from '@/lib/chat/whisper-sweep'
import { isInWhisperScope } from '@/lib/schemas/chat.types'
import { createTurnTranscript, minutesSinceLastHostTimestamp } from '@/lib/chat/context/turn-transcript'
import { getRepositories } from '@/lib/repositories/factory'
import type { ChatEvent } from '@/lib/schemas/types'

const mockedGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

const whisper = (id: string, systemKind: string, targetParticipantIds: string[] | null) => ({
  type: 'message',
  id,
  role: 'ASSISTANT',
  content: id,
  createdAt: '2026-10-01T12:00:00.000Z',
  systemSender: 'commonplaceBook',
  systemKind,
  targetParticipantIds,
}) as unknown as ChatEvent

describe('isInWhisperScope', () => {
  it('treats null as the whole room', () => {
    expect(isInWhisperScope({ targetParticipantIds: null }, null)).toBe(true)
    expect(isInWhisperScope({ targetParticipantIds: [] }, null)).toBe(true)
    expect(isInWhisperScope({ targetParticipantIds: ['p1'] }, null)).toBe(false)
  })

  it('matches a whisper naming the participant', () => {
    expect(isInWhisperScope({ targetParticipantIds: ['p1', 'p2'] }, 'p2')).toBe(true)
    expect(isInWhisperScope({ targetParticipantIds: ['p1'] }, 'p2')).toBe(false)
    expect(isInWhisperScope({ targetParticipantIds: null }, 'p2')).toBe(false)
  })
})

describe('sweepPriorWhispers', () => {
  const events = [
    whisper('old-p1', 'consolidated', ['p1']),
    whisper('old-p2', 'consolidated', ['p2']),
    whisper('standing-p1', 'relevant-conversations', ['p1']),
    whisper('new-p1', 'consolidated', ['p1']),
  ]

  it('deletes the scope\'s earlier whispers of the kind from the transcript it is given', async () => {
    const chats = { getMessages: jest.fn(), deleteMessagesByIds: jest.fn().mockResolvedValue(1) }
    mockedGetRepositories.mockReturnValue({ chats } as any)

    const removed = await sweepPriorWhispers({
      chatId: 'chat',
      keepId: 'new-p1',
      targetParticipantId: 'p1',
      isSameKind: m => m.systemKind !== 'relevant-conversations',
      events,
      logTag: '[Test]',
    })

    expect(removed).toBe(1)
    expect(chats.getMessages).not.toHaveBeenCalled()
    expect(chats.deleteMessagesByIds).toHaveBeenCalledWith('chat', ['old-p1'])
  })

  it('reads the chat when no transcript is given, and swallows a failure', async () => {
    const chats = { getMessages: jest.fn().mockRejectedValue(new Error('locked')), deleteMessagesByIds: jest.fn() }
    mockedGetRepositories.mockReturnValue({ chats } as any)

    await expect(sweepPriorWhispers({
      chatId: 'chat',
      keepId: 'new-p1',
      targetParticipantId: 'p1',
      isSameKind: () => true,
      logTag: '[Test]',
    })).resolves.toBe(0)
    expect(chats.getMessages).toHaveBeenCalledWith('chat')
    expect(chats.deleteMessagesByIds).not.toHaveBeenCalled()
  })
})

describe('createTurnTranscript', () => {
  it('reads the chat once, however many readers ask, and only when one does', async () => {
    const chats = { getMessages: jest.fn().mockResolvedValue([]) }
    mockedGetRepositories.mockReturnValue({ chats } as any)

    const transcript = createTurnTranscript('chat')
    expect(chats.getMessages).not.toHaveBeenCalled()
    await Promise.all([transcript.events(), transcript.events()])
    await transcript.events()
    expect(chats.getMessages).toHaveBeenCalledTimes(1)
  })
})

describe('minutesSinceLastHostTimestamp', () => {
  const hostStamp = (createdAt: string) => ({ type: 'message', systemSender: 'host', systemKind: 'timestamp', createdAt }) as unknown as ChatEvent

  it('is null with no announcement on record', () => {
    expect(minutesSinceLastHostTimestamp([whisper('w', 'consolidated', null)], Date.now())).toBeNull()
  })

  it('measures from the newest announcement', () => {
    const now = Date.parse('2026-10-01T12:30:00.000Z')
    const events = [hostStamp('2026-10-01T12:00:00.000Z'), hostStamp('2026-10-01T12:20:00.000Z'), hostStamp('not a date')]
    expect(minutesSinceLastHostTimestamp(events, now)).toBe(10)
  })
})
