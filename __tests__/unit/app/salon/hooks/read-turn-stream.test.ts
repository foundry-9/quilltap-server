/**
 * `readTurnStream` — the Salon's stream reader as a plain function.
 *
 * Refactor 4.13 (Salon stream lifecycles) pulled the reader out of
 * `useSSEStreaming` so it could be driven without rendering: a fake reader of
 * `encodeFrame` bytes in, a handler object of mocks out. One case per frame
 * kind the reader acts on, plus the ways a stream ends.
 */

import { encodeFrame, type StreamFrame, type FrameOf } from '@/lib/chat/stream-frames'
import { readTurnStream, readGreenRoomFrames, type TurnStreamHandlers } from '@/app/salon/[id]/hooks/read-turn-stream'
import { SalonSendError, StreamClosedEarlyError, type ConcurrentStream } from '@/app/salon/[id]/hooks/stream-helpers'
import type { Message } from '@/app/salon/[id]/types'
import { showErrorToast, showWarningToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

/** A reader over the frames, cut into `chunk`-byte reads so frames straddle reads. */
function readerOf(frames: StreamFrame[], chunk = 23): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder()
  const bytes = frames.flatMap((f) => Array.from(encodeFrame(encoder, f)))
  let at = 0
  return {
    read: async () => {
      if (at >= bytes.length) return { done: true, value: undefined }
      const value = Uint8Array.from(bytes.slice(at, at + chunk))
      at += chunk
      return { done: false, value }
    },
    releaseLock: () => {},
    cancel: async () => {},
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>
}

function done(over: Partial<FrameOf<'done'>> = {}): FrameOf<'done'> {
  return {
    kind: 'done',
    outcome: 'finished',
    messageId: 'm-1',
    participantId: 'p-1',
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    toolsExecuted: false,
    ...over,
  }
}

const chainComplete: FrameOf<'chainComplete'> = {
  kind: 'chainComplete',
  reason: 'user_turn',
  nextSpeakerId: null,
  chainDepth: 1,
}

function handlers() {
  let messages: Message[] = []
  let concurrent: ConcurrentStream[] = []
  const h = {
    setResponseStatus: jest.fn(),
    setWaitingForResponse: jest.fn(),
    setStreaming: jest.fn(),
    scheduleStreamingContent: jest.fn(),
    scheduleStreamingReasoning: jest.fn(),
    resetStreamingContent: jest.fn(),
    setHandStatus: jest.fn(),
    setConcurrentStreams: jest.fn((fn: (prev: ConcurrentStream[]) => ConcurrentStream[]) => {
      concurrent = fn(concurrent)
    }),
    setMessages: jest.fn((fn: (prev: Message[]) => Message[]) => {
      messages = fn(messages)
    }),
    surfaceMessage: jest.fn(),
    fetchChat: jest.fn(async () => {}),
    onStorytellerEvent: jest.fn(),
    onGreenRoom: jest.fn(),
    onToolsDetected: jest.fn(),
    onToolResult: jest.fn(),
    onDone: jest.fn(),
    onSurfacedMessage: jest.fn(),
    onConfirmationResult: jest.fn(),
    onIntermediateDone: jest.fn(),
    onTurnStart: jest.fn(),
    onTurnComplete: jest.fn(),
    onChainComplete: jest.fn(),
  } satisfies TurnStreamHandlers
  return { h, messages: () => messages, concurrent: () => concurrent }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('readTurnStream — the stream’s own frames', () => {
  it('accumulates content, flips the flags once, and hands the prose to onDone', async () => {
    const { h } = handlers()
    const full = await readTurnStream(readerOf([
      { kind: 'content', text: 'Good ' },
      { kind: 'content', text: 'evening.' },
      done(),
    ]), h)

    expect(full).toBe('Good evening.')
    expect(h.setStreaming).toHaveBeenCalledTimes(1)
    expect(h.setStreaming).toHaveBeenCalledWith(true)
    expect(h.scheduleStreamingContent).toHaveBeenLastCalledWith('Good evening.')
    expect(h.onDone).toHaveBeenCalledWith('Good evening.', expect.objectContaining({ kind: 'done', messageId: 'm-1' }))
    expect(h.onIntermediateDone).not.toHaveBeenCalled()
  })

  it('replaces the reasoning buffer with each cumulative frame', async () => {
    const { h } = handlers()
    await readTurnStream(readerOf([
      { kind: 'reasoning', text: 'Hm' },
      { kind: 'reasoning', text: 'Hmm, yes' },
      done(),
    ]), h)
    expect(h.scheduleStreamingReasoning).toHaveBeenLastCalledWith('Hmm, yes')
  })

  it('sets the status line and warns aloud on a rescue', async () => {
    const { h } = handlers()
    await readTurnStream(readerOf([
      { kind: 'status', status: { stage: 'failing-over', message: 'Trying the understudy.' } },
      done(),
    ]), h)
    expect(h.setResponseStatus).toHaveBeenCalledWith(expect.objectContaining({ stage: 'failing-over' }))
    expect(showWarningToast).toHaveBeenCalledWith('Trying the understudy.')
  })

  it('throws a SalonSendError carrying what the server saved', async () => {
    const { h } = handlers()
    const err = await readTurnStream(readerOf([
      { kind: 'error', message: 'Provider down', errorType: 'x', details: 'timeout', userMessagePersisted: true },
    ]), h).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SalonSendError)
    expect((err as SalonSendError).message).toBe('Provider down: timeout')
    expect((err as SalonSendError).userMessagePersisted).toBe(true)
  })

  it('passes tool batches on with the prose offset where they fired', async () => {
    const { h } = handlers()
    await readTurnStream(readerOf([
      { kind: 'content', text: 'Let me look.' },
      { kind: 'toolsDetected', names: ['search'], arguments: [{ q: 'x' }] },
      { kind: 'toolResult', index: 0, name: 'search', success: true, result: { hits: 1 } },
      done(),
    ]), h)
    expect(h.onToolsDetected).toHaveBeenCalledWith(expect.objectContaining({ names: ['search'] }), 'Let me look.'.length)
    expect(h.onToolResult).toHaveBeenCalledWith(expect.objectContaining({ name: 'search', success: true }))
  })

  it('surfaces a posted message and a confirmation result', async () => {
    const { h } = handlers()
    await readTurnStream(readerOf([
      { kind: 'posted', what: 'hostAnnouncement', message: { id: 'host-1', role: 'ASSISTANT', content: 'Note.' } as never },
      { kind: 'confirmationResult', messageId: 'm-1', confirmed: true, revised: false, notes: null },
      done(),
    ]), h)
    expect(h.onSurfacedMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'host-1' }))
    expect(h.onConfirmationResult).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm-1', confirmed: true }))
  })

  it('refetches for a Courier placeholder', async () => {
    const { h } = handlers()
    await readTurnStream(readerOf([
      { kind: 'pendingExternalTurn', messageId: 'm-9', participantId: 'p-1', characterName: 'Ada' },
      done({ pendingExternalTurn: true }),
    ]), h)
    expect(h.fetchChat).toHaveBeenCalledTimes(2)
  })

  it('warns about attachments the provider could not send', async () => {
    const { h } = handlers()
    await readTurnStream(readerOf([
      done({ attachmentResults: { sent: [], failed: [{ id: 'f-1', error: 'too large' }] } as never }),
    ]), h)
    expect(showWarningToast).toHaveBeenCalledWith(expect.stringContaining('too large'))
  })

  it('routes a chained turn’s done to onIntermediateDone and reports the chain', async () => {
    const { h } = handlers()
    await readTurnStream(readerOf([
      { kind: 'turnStart', participantId: 'p-1', characterName: 'Ada', chainDepth: 0 },
      { kind: 'content', text: 'First.' },
      done(),
      { kind: 'turnComplete', participantId: 'p-1', messageId: 'm-1', chainDepth: 0 },
      { kind: 'turnStart', participantId: 'p-2', characterName: 'Bea', chainDepth: 1 },
      { kind: 'content', text: 'Second.' },
      done({ messageId: 'm-2', participantId: 'p-2' }),
      { ...chainComplete, paused: true },
    ]), h)

    expect(h.onDone).toHaveBeenCalledWith('First.', expect.objectContaining({ messageId: 'm-1' }))
    expect(h.onIntermediateDone).toHaveBeenCalledWith('Second.', expect.objectContaining({ messageId: 'm-2' }))
    expect(h.onTurnStart).toHaveBeenCalledWith({ participantId: 'p-2', characterName: 'Bea', chainDepth: 1 })
    expect(h.onTurnComplete).toHaveBeenCalledWith({ participantId: 'p-1', messageId: 'm-1', chainDepth: 0 })
    expect(h.onChainComplete).toHaveBeenCalledWith(expect.objectContaining({ reason: 'user_turn', paused: true, heldUserTurn: false }))
  })

  it('passes the hand, the Storyteller board and the Green Room on', async () => {
    const { h } = handlers()
    await readTurnStream(readerOf([
      { kind: 'handAsked', participantId: 'p-1', characterName: 'Ada' },
      { kind: 'handAnswered', participantId: 'p-1', characterName: 'Ada', yielded: true },
      { kind: 'roundOpen', roundId: 'r-1' },
      { kind: 'greenRoom', greenRoom: { event: 'done' } },
      done(),
    ]), h)
    expect(h.setHandStatus).toHaveBeenNthCalledWith(1, { kind: 'asked', characterName: 'Ada' })
    expect(h.setHandStatus).toHaveBeenNthCalledWith(2, { kind: 'yielded', characterName: 'Ada' })
    expect(h.onStorytellerEvent).toHaveBeenCalledWith({ kind: 'open', roundId: 'r-1' })
    expect(h.onGreenRoom).toHaveBeenCalledWith({ event: 'done' })
  })
})

describe('readTurnStream — how a stream ends', () => {
  it('throws StreamClosedEarlyError when the stream ends with its turn open', async () => {
    const { h } = handlers()
    await expect(readTurnStream(readerOf([{ kind: 'content', text: 'Half a' }]), h))
      .rejects.toBeInstanceOf(StreamClosedEarlyError)
    expect(h.setResponseStatus).toHaveBeenCalledWith(null)
  })

  it('treats a chained turnStart after a done as reopening the turn', async () => {
    const { h } = handlers()
    await expect(readTurnStream(readerOf([
      done(),
      { kind: 'turnStart', participantId: 'p-2', characterName: 'Bea', chainDepth: 1 },
    ]), h)).rejects.toBeInstanceOf(StreamClosedEarlyError)
  })

  it('reads a final frame left in the buffer with no trailing blank line', async () => {
    const { h } = handlers()
    const encoder = new TextEncoder()
    const text = new TextDecoder().decode(encodeFrame(encoder, done())).trimEnd()
    const bytes = encoder.encode(text)
    let read = false
    const reader = {
      read: async () => {
        if (read) return { done: true, value: undefined }
        read = true
        return { done: false, value: bytes }
      },
    } as unknown as ReadableStreamDefaultReader<Uint8Array>
    await readTurnStream(reader, h)
    expect(h.onDone).toHaveBeenCalled()
  })
})

describe('readTurnStream — a concurrent seat’s frames', () => {
  it('fills the seat’s own bubble and closes it into a reply', async () => {
    const { h, messages, concurrent } = handlers()
    const seat = { participantId: 'p-3', concurrent: true as const }
    await readTurnStream(readerOf([
      { kind: 'turnStart', participantId: 'p-3', characterName: 'Cy', chainDepth: 0, seat },
      { kind: 'content', text: 'All ', seat },
      { kind: 'content', text: 'at once.', seat },
      done({ messageId: 'm-3', participantId: 'p-3', seat }),
      chainComplete,
    ]), h)

    expect(concurrent()).toEqual([])
    expect(messages()).toEqual([expect.objectContaining({ id: 'm-3', content: 'All at once.', participantId: 'p-3' })])
    // The shared slot is left alone.
    expect(h.scheduleStreamingContent).not.toHaveBeenCalled()
    expect(h.onDone).not.toHaveBeenCalled()
  })

  it('toasts a seat’s error without ending the stream', async () => {
    const { h } = handlers()
    await readTurnStream(readerOf([
      { kind: 'error', message: 'Cy failed', errorType: 'x', details: '', seat: { participantId: 'p-3', concurrent: true } },
      chainComplete,
    ]), h)
    expect(showErrorToast).toHaveBeenCalledWith('Cy failed')
    expect(h.onChainComplete).toHaveBeenCalled()
  })
})

describe('readGreenRoomFrames', () => {
  it('passes on only greenRoom frames', async () => {
    const onGreenRoom = jest.fn()
    await readGreenRoomFrames(readerOf([
      { kind: 'content', text: 'ignored' },
      { kind: 'greenRoom', greenRoom: { event: 'done' } },
    ]), onGreenRoom)
    expect(onGreenRoom).toHaveBeenCalledTimes(1)
    expect(onGreenRoom).toHaveBeenCalledWith({ event: 'done' })
  })
})
