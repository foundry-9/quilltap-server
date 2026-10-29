/**
 * @jest-environment node
 */
/**
 * The Salon turn stream's lifecycle (`openTurnStream`) and the done frame a
 * turn closes with (`encodeTurnDoneEvent`).
 */

jest.mock('@/lib/logging/create-logger', () => {
  const logger = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() })
  return { createServiceLogger: jest.fn(logger), createLogger: jest.fn(logger) }
})

jest.mock('@/lib/chat/turn-control', () => ({
  ...jest.requireActual('@/lib/chat/turn-control'),
  runWithTurnControl: jest.fn(async (_chatId: string, fn: () => Promise<void>) => fn()),
}))

import { openTurnStream } from '@/lib/services/chat-message/turn-stream'
import { encodeTurnDoneEvent } from '@/lib/services/chat-message/streaming.service'
import { runWithTurnControl } from '@/lib/chat/turn-control'

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text
    text += decoder.decode(value)
  }
}

describe('openTurnStream', () => {
  it('runs the body under turn control and closes the stream', async () => {
    const text = await readAll(openTurnStream('chat-1', async (controller, encoder) => {
      controller.enqueue(encoder.encode('data: {"hello":true}\n\n'))
    }))
    expect(runWithTurnControl).toHaveBeenCalledWith('chat-1', expect.any(Function), expect.objectContaining({ keepAlive: expect.any(Function) }))
    expect(text).toBe('data: {"hello":true}\n\n')
  })

  it('a throw becomes one error frame saying what of the submission was saved (bug 241)', async () => {
    const text = await readAll(openTurnStream('chat-1', async (_controller, _encoder, ledger) => {
      ledger.userMessagePersisted = true
      throw new Error('No API key configured for this connection profile')
    }))
    const frame = JSON.parse(text.replace(/^data: /, '').trim())
    expect(frame).toMatchObject({
      error: 'Failed to generate response',
      errorType: 'Error',
      details: 'No API key configured for this connection profile',
      userMessagePersisted: true,
      pendingToolResultsPersisted: false,
    })
  })

  it('a body that closed the stream itself is not an error', async () => {
    const text = await readAll(openTurnStream('chat-1', async (controller) => {
      controller.close()
    }))
    expect(text).toBe('')
  })
})

describe('encodeTurnDoneEvent', () => {
  it('reports usage, attachments and the answering model from the streaming state', () => {
    const streaming = {
      usage: { totalTokens: 12 },
      cacheUsage: { cacheReadInputTokens: 3 },
      attachmentResults: { sent: ['f1'], failed: [] },
      effectiveProfile: { provider: 'ANTHROPIC', modelName: 'claude' },
    } as never
    const frame = JSON.parse(new TextDecoder().decode(
      encodeTurnDoneEvent(new TextEncoder(), streaming, { messageId: null, participantId: 'p1', toolsExecuted: false, stopped: true })
    ).replace(/^data: /, '').trim())
    expect(frame).toEqual({
      done: true,
      messageId: null,
      participantId: 'p1',
      toolsExecuted: false,
      stopped: true,
      usage: { totalTokens: 12 },
      cacheUsage: { cacheReadInputTokens: 3 },
      attachmentResults: { sent: ['f1'], failed: [] },
      provider: 'ANTHROPIC',
      modelName: 'claude',
    })
  })
})
