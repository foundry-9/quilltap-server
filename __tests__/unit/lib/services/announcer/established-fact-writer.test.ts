/**
 * The machine-delivered established fact (the Salon's Deus Ex Machina tab):
 * the row shape `postEstablishedFact` writes, the memory job it enqueues, and
 * the announcement schema's refusal of an audience.
 */

import { postEstablishedFact } from '@/lib/services/announcer/writer'
import { insertAnnouncementSchema } from '@/app/api/v1/chats/[id]/schemas'

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

const mockEnqueue = jest.fn()
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEstablishedFactMemories: (...args: unknown[]) => mockEnqueue(...args),
}))

const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }

const CHAT_ID = '11111111-1111-4111-8111-111111111111'
const addMessage = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  addMessage.mockResolvedValue(undefined)
  mockEnqueue.mockResolvedValue('job-1')
  getRepositories.mockReturnValue({
    chats: {
      findById: jest.fn(async (id: string) => (id === CHAT_ID ? { id, participants: [] } : null)),
      addMessage,
    },
  })
})

describe('postEstablishedFact', () => {
  it('writes a public, persona-free Host row with the text as typed', async () => {
    const message = await postEstablishedFact({ chatId: CHAT_ID, userId: 'user-1', contentMarkdown: '  The river has risen.  ' })
    expect(message).not.toBeNull()
    const [, row] = addMessage.mock.calls[0]
    expect(row).toMatchObject({
      type: 'message',
      role: 'ASSISTANT',
      content: 'The river has risen.',
      opaqueContent: 'The river has risen.',
      participantId: null,
      systemSender: 'host',
      systemKind: 'established-fact',
      targetParticipantIds: null,
      customAnnouncer: null,
    })
    expect(JSON.stringify(row)).not.toMatch(/deus\s+ex\s+machina/i)
  })

  it('enqueues the memory job for the posted row', async () => {
    const message = await postEstablishedFact({ chatId: CHAT_ID, userId: 'user-1', contentMarkdown: 'A fact.' })
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { chatId: CHAT_ID, messageId: message!.id })
  })

  it('stands when the enqueue fails', async () => {
    mockEnqueue.mockRejectedValue(new Error('queue down'))
    const message = await postEstablishedFact({ chatId: CHAT_ID, userId: 'user-1', contentMarkdown: 'A fact.' })
    expect(message).not.toBeNull()
    expect(addMessage).toHaveBeenCalledTimes(1)
  })

  it('writes nothing for empty text or an unknown chat', async () => {
    expect(await postEstablishedFact({ chatId: CHAT_ID, userId: 'user-1', contentMarkdown: '   ' })).toBeNull()
    expect(await postEstablishedFact({ chatId: 'nope', userId: 'user-1', contentMarkdown: 'A fact.' })).toBeNull()
    expect(addMessage).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})

describe('insertAnnouncementSchema — the fact sender', () => {
  it('accepts a public fact', () => {
    expect(insertAnnouncementSchema.safeParse({ contentMarkdown: 'A fact.', sender: { kind: 'fact' } }).success).toBe(true)
    expect(insertAnnouncementSchema.safeParse({ contentMarkdown: 'A fact.', sender: { kind: 'fact' }, targetParticipantIds: null }).success).toBe(true)
  })

  it('refuses a fact with an audience', () => {
    expect(insertAnnouncementSchema.safeParse({
      contentMarkdown: 'A fact.',
      sender: { kind: 'fact' },
      targetParticipantIds: [CHAT_ID],
    }).success).toBe(false)
  })

  it('still lets an ordinary announcement be whispered', () => {
    expect(insertAnnouncementSchema.safeParse({
      contentMarkdown: 'Psst.',
      sender: { kind: 'staff', staffId: 'host' },
      targetParticipantIds: [CHAT_ID],
    }).success).toBe(true)
  })
})
