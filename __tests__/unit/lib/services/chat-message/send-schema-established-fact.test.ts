/**
 * The send schema's rules for an established fact (Deus Ex Machina): public
 * only, and it needs words.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})

import { sendMessageSchema } from '@/lib/services/chat-message/orchestrator.service'

const TARGET = '11111111-1111-4111-8111-111111111111'

describe('sendMessageSchema — isEstablishedFact', () => {
  it('accepts a public fact with words', () => {
    const parsed = sendMessageSchema.safeParse({ content: 'The bridge is gone.', isEstablishedFact: true })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.isEstablishedFact).toBe(true)
  })

  it('refuses a whispered fact', () => {
    const parsed = sendMessageSchema.safeParse({
      content: 'The bridge is gone.',
      isEstablishedFact: true,
      targetParticipantIds: [TARGET],
    })
    expect(parsed.success).toBe(false)
  })

  it('refuses a fact with no words, attachments notwithstanding', () => {
    expect(sendMessageSchema.safeParse({ content: '  ', fileIds: ['f1'], isEstablishedFact: true }).success).toBe(false)
  })

  it('leaves an ordinary whisper alone', () => {
    expect(sendMessageSchema.safeParse({ content: 'psst', targetParticipantIds: [TARGET] }).success).toBe(true)
    expect(sendMessageSchema.safeParse({ content: 'psst', targetParticipantIds: [TARGET], isEstablishedFact: false }).success).toBe(true)
  })
})
