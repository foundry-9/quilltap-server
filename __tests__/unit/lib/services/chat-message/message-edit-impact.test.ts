/**
 * Editing any Salon line: what the edit disturbs, and regenerating the
 * memories the old text formed.
 *
 * A turn's memories are stamped with the turn's last character line, so an
 * edited user line must be traced to its whole turn; a Carina answer and a
 * machine established fact each have their own memory job; other Staff rows
 * form none.
 */

import {
  assessMessageEditImpact,
  locateMemorySource,
  regenerateEditedMessageMemories,
} from '@/lib/services/chat-message/message-edit-impact'
import { getRepositories } from '@/lib/repositories/factory'
import { retireMemories } from '@/lib/memory/retire'
import {
  enqueueCarinaMemoryExtraction,
  enqueueEstablishedFactMemories,
  enqueueMemoryExtraction,
} from '@/lib/background-jobs/queue-service'
import { resolveChatExtractionProfileId } from '@/lib/memory/extraction'
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/retire', () => ({ retireMemories: jest.fn() }))
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueCarinaMemoryExtraction: jest.fn(),
  enqueueEstablishedFactMemories: jest.fn(),
  enqueueMemoryExtraction: jest.fn(),
}))
jest.mock('@/lib/background-jobs/processor', () => ({ ensureProcessorRunning: jest.fn() }))
jest.mock('@/lib/memory/extraction', () => ({ resolveChatExtractionProfileId: jest.fn() }))

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockRetire = retireMemories as jest.MockedFunction<typeof retireMemories>
const mockEnqueueTurn = enqueueMemoryExtraction as jest.MockedFunction<typeof enqueueMemoryExtraction>
const mockEnqueueCarina = enqueueCarinaMemoryExtraction as jest.MockedFunction<typeof enqueueCarinaMemoryExtraction>
const mockEnqueueFact = enqueueEstablishedFactMemories as jest.MockedFunction<typeof enqueueEstablishedFactMemories>
const mockProfile = resolveChatExtractionProfileId as jest.MockedFunction<typeof resolveChatExtractionProfileId>

let seq = 0
function msg(id: string, role: 'USER' | 'ASSISTANT', extra: Partial<MessageEvent> = {}): MessageEvent {
  seq += 1
  return {
    type: 'message',
    id,
    role,
    content: `${id} text`,
    participantId: role === 'ASSISTANT' ? 'seat-ai' : 'seat-user',
    createdAt: `2026-11-01T10:00:${String(seq).padStart(2, '0')}.000Z`,
    attachments: [],
    ...extra,
  } as unknown as MessageEvent
}

const chat = (chatType: string | null = null) =>
  ({ id: 'chat-1', userId: 'user-1', chatType, participants: [] }) as unknown as ChatMetadata

describe('locateMemorySource', () => {
  // greeting, then two user-opened turns, with a Staff row in the second
  const greeting = msg('greet', 'ASSISTANT')
  const u1 = msg('u1', 'USER')
  const a1 = msg('a1', 'ASSISTANT')
  const u2 = msg('u2', 'USER')
  const staff = msg('staff', 'ASSISTANT', { systemSender: 'lantern', participantId: null } as Partial<MessageEvent>)
  const a2 = msg('a2', 'ASSISTANT')
  const messages = [greeting, u1, a1, u2, staff, a2]

  it('traces a user line to its whole turn', () => {
    expect(locateMemorySource(messages, u1, null)).toEqual({
      kind: 'turn',
      locator: { turnOpenerMessageId: 'u1' },
      sourceMessageIds: ['u1', 'a1'],
    })
  })

  it('traces a character line to the turn its opener began', () => {
    const source = locateMemorySource(messages, a2, null)
    expect(source).toMatchObject({ kind: 'turn', locator: { turnOpenerMessageId: 'u2' } })
    expect(source && source.kind === 'turn' && source.sourceMessageIds).toEqual(['u2', 'staff', 'a2'])
  })

  it('traces the greeting to the null-opener turn', () => {
    expect(locateMemorySource(messages, greeting, null)).toEqual({
      kind: 'turn',
      locator: { turnOpenerMessageId: null },
      sourceMessageIds: ['greet'],
    })
  })

  it('gives an ordinary Staff row no memory source', () => {
    expect(locateMemorySource(messages, staff, null)).toBeNull()
  })

  it('sends a Carina answer to its own job', () => {
    const carina = msg('car', 'ASSISTANT', {
      systemSender: 'carina',
      carinaMeta: { answererId: 'char-9', question: 'Who?' },
    } as Partial<MessageEvent>)
    expect(locateMemorySource([...messages, carina], carina, null)).toEqual({
      kind: 'carina',
      messageId: 'car',
      answererId: 'char-9',
    })
  })

  it('sends a machine established fact to its own job', () => {
    const fact = msg('fact', 'ASSISTANT', { systemSender: 'host', systemKind: 'established-fact' } as Partial<MessageEvent>)
    expect(locateMemorySource([...messages, fact], fact, null)).toEqual({ kind: 'established-fact', messageId: 'fact' })
  })

  it('in an autonomous room, traces a line to the speaker turn that closes over it', () => {
    const r1 = msg('r1', 'ASSISTANT')
    const note = msg('note', 'ASSISTANT', { systemSender: 'host', participantId: null } as Partial<MessageEvent>)
    const whisper = msg('w', 'ASSISTANT', { isSilentMessage: true } as Partial<MessageEvent>)
    const r2 = msg('r2', 'ASSISTANT')
    const room = [r1, note, whisper, r2]
    expect(locateMemorySource(room, whisper, 'autonomous')).toEqual({
      kind: 'turn',
      locator: { turnOpenerMessageId: null, extractionAnchorMessageId: 'r2', extractAfterMessageId: 'r1' },
      sourceMessageIds: ['note', 'w', 'r2'],
    })
  })

  it('in an autonomous room, a line after the last speaker has no closed turn yet', () => {
    const r1 = msg('r1', 'ASSISTANT')
    const trailing = msg('t', 'ASSISTANT', { isSilentMessage: true } as Partial<MessageEvent>)
    expect(locateMemorySource([r1, trailing], trailing, 'autonomous')).toBeNull()
  })
})

describe('assessMessageEditImpact / regenerateEditedMessageMemories', () => {
  const u1 = msg('u1', 'USER')
  const a1 = msg('a1', 'ASSISTANT')
  const u2 = msg('u2', 'USER')
  const a2 = msg('a2', 'ASSISTANT')
  const messages = [u1, a1, u2, a2]

  const repos = {
    llmLogs: { countForChatSince: jest.fn() },
    memories: { findBySourceMessageId: jest.fn() },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue(repos as unknown as ReturnType<typeof getRepositories>)
    repos.memories.findBySourceMessageId.mockImplementation(async (id: string) =>
      id === 'a1'
        ? [{ id: 'm1', source: 'AUTO' }, { id: 'm2', source: 'AUTO' }, { id: 'hand', source: 'MANUAL' }]
        : [],
    )
    mockProfile.mockResolvedValue('profile-1')
    mockRetire.mockResolvedValue({ retired: 2 } as Awaited<ReturnType<typeof retireMemories>>)
    mockEnqueueTurn.mockResolvedValue('job-1')
  })

  it('reports later model calls less the line\'s own generation, and the turn\'s AUTO memories', async () => {
    repos.llmLogs.countForChatSince.mockImplementation(async (_chat: string, _since: string, only?: unknown) => (only ? 1 : 4))
    const impact = await assessMessageEditImpact(chat(), messages, a1, 'user-1')
    expect(impact).toEqual({
      seenByLlm: true,
      laterLlmCalls: 3,
      laterCharacterLines: 1,
      memoryCount: 2,
      memorySource: 'turn',
      canRegenerateMemories: true,
    })
    expect(repos.llmLogs.countForChatSince).toHaveBeenCalledWith('chat-1', a1.createdAt, {
      messageIds: ['a1'],
      types: ['CHAT_MESSAGE', 'TOOL_CONTINUATION'],
    })
  })

  it('falls back to later character lines when nothing was logged', async () => {
    repos.llmLogs.countForChatSince.mockResolvedValue(0)
    const impact = await assessMessageEditImpact(chat(), messages, u2, 'user-1')
    expect(impact.laterLlmCalls).toBe(0)
    expect(impact.laterCharacterLines).toBe(1)
    expect(impact.seenByLlm).toBe(true)
  })

  it('calls the newest unanswered line unseen', async () => {
    repos.llmLogs.countForChatSince.mockResolvedValue(0)
    const fresh = msg('u3', 'USER')
    const impact = await assessMessageEditImpact(chat(), [...messages, fresh], fresh, 'user-1')
    expect(impact.seenByLlm).toBe(false)
    expect(impact.memoryCount).toBe(0)
    expect(impact.canRegenerateMemories).toBe(false)
  })

  it('cannot offer a regenerate without a profile to extract on', async () => {
    repos.llmLogs.countForChatSince.mockResolvedValue(0)
    mockProfile.mockResolvedValue(null)
    const impact = await assessMessageEditImpact(chat(), messages, u1, 'user-1')
    expect(impact.memoryCount).toBe(2)
    expect(impact.canRegenerateMemories).toBe(false)
  })

  it('retires the turn\'s AUTO memories and re-extracts the turn whole', async () => {
    const result = await regenerateEditedMessageMemories(chat(), messages, u1, 'user-1')
    expect(mockRetire).toHaveBeenCalledWith(['m1', 'm2'], { reason: 'message-edit' })
    expect(mockEnqueueTurn).toHaveBeenCalledWith('user-1', {
      chatId: 'chat-1',
      turnOpenerMessageId: 'u1',
      extractionAnchorMessageId: null,
      connectionProfileId: 'profile-1',
      backfill: true,
    })
    expect(result).toEqual({ memoriesRetired: 2, jobId: 'job-1' })
  })

  it('keeps the old memories when there is no profile to form new ones', async () => {
    mockProfile.mockResolvedValue(null)
    const result = await regenerateEditedMessageMemories(chat(), messages, u1, 'user-1')
    expect(mockRetire).not.toHaveBeenCalled()
    expect(mockEnqueueTurn).not.toHaveBeenCalled()
    expect(result).toEqual({ memoriesRetired: 0, jobId: null })
  })

  it('re-runs a Carina answer through its own job', async () => {
    const carina = msg('car', 'ASSISTANT', {
      systemSender: 'carina',
      carinaMeta: { answererId: 'char-9', question: 'Who?' },
    } as Partial<MessageEvent>)
    repos.memories.findBySourceMessageId.mockResolvedValue([{ id: 'c1', source: 'AUTO' }])
    mockEnqueueCarina.mockResolvedValue('job-c')
    const result = await regenerateEditedMessageMemories(chat(), [...messages, carina], carina, 'user-1')
    expect(mockRetire).toHaveBeenCalledWith(['c1'], { reason: 'message-edit' })
    expect(mockEnqueueCarina).toHaveBeenCalledWith('user-1', {
      chatId: 'chat-1',
      carinaMessageId: 'car',
      answererId: 'char-9',
      connectionProfileId: 'profile-1',
    })
    expect(result.jobId).toBe('job-c')
  })

  it('re-admits an established fact (MANUAL rows) without needing a profile', async () => {
    const fact = msg('fact', 'ASSISTANT', { systemSender: 'host', systemKind: 'established-fact' } as Partial<MessageEvent>)
    repos.memories.findBySourceMessageId.mockResolvedValue([{ id: 'f1', source: 'MANUAL' }])
    mockProfile.mockResolvedValue(null)
    mockEnqueueFact.mockResolvedValue('job-f')
    const result = await regenerateEditedMessageMemories(chat(), [...messages, fact], fact, 'user-1')
    expect(mockRetire).toHaveBeenCalledWith(['f1'], { reason: 'message-edit' })
    expect(mockEnqueueFact).toHaveBeenCalledWith('user-1', { chatId: 'chat-1', messageId: 'fact' })
    expect(result.jobId).toBe('job-f')
  })
})
