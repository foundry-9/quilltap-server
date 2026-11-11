/**
 * The Salon's turn-stream reader — a plain async function, no React.
 *
 * Every Salon stream (a send, a continue, an opening, a storyteller round)
 * carries `StreamFrame`s. This reads them off a `ReadableStreamDefaultReader`,
 * dispatches each with an exhaustive `switch (frame.kind)`, and writes what it
 * learns through the handler object it is given. Being React-free, it can be
 * driven in a test with a fake reader and a handler object of `jest.fn()`s.
 *
 * Returns the prose streamed by the last turn. Throws `SalonSendError` on an
 * error frame and `StreamClosedEarlyError` when the stream ends with its turn
 * still open.
 */

import { showErrorToast, showWarningToast } from '@/lib/toast'
import { splitSseBuffer } from '@/components/agent-stream/parse-agent-stream'
import {
  assertNever,
  doneLeavesNoReply,
  parseFrame,
  type ConfirmationResultFrame,
  type DoneFrame,
  type FrameOf,
  type GreenRoomEvent,
  type ResponseStatus,
  type StreamFrame,
  type ToolResultFrame,
  type ToolsDetectedFrame,
} from '@/lib/chat/stream-frames'
import type { Message } from '../types'
import {
  assistantMessageFromDone,
  buildFailedAttachmentWarning,
  postedAsMessage,
  SalonSendError,
  StreamClosedEarlyError,
  type ConcurrentStream,
  type RaisedHandStatus,
  type StorytellerStreamEvent,
} from './stream-helpers'

/** Where the reader writes the stream's shared state — the hook's setters. */
export interface TurnStreamSinks {
  setResponseStatus: (status: ResponseStatus | null) => void
  setWaitingForResponse: (waiting: boolean) => void
  setStreaming: (streaming: boolean) => void
  /** The prose streamed so far in this turn (cumulative). */
  scheduleStreamingContent: (content: string) => void
  /** The reasoning streamed so far in this turn (cumulative). */
  scheduleStreamingReasoning: (reasoning: string) => void
  resetStreamingContent: () => void
  setHandStatus: (status: RaisedHandStatus) => void
  setConcurrentStreams: (update: (prev: ConcurrentStream[]) => ConcurrentStream[]) => void
  setMessages: (update: (prev: Message[]) => Message[]) => void
  /** Insert a message the server posted mid-turn (deduped by id). */
  surfaceMessage: (message: Message) => void
  fetchChat: () => Promise<void>
  onStorytellerEvent?: (event: StorytellerStreamEvent) => void
  onGreenRoom?: (event: GreenRoomEvent) => void
}

/** What the caller wants told about the stream's turns. */
export interface TurnStreamCallbacks {
  /** `offset` is the length of the response text streamed so far — where
   *  this batch of tool calls was invoked in the prose. */
  onToolsDetected?: (frame: ToolsDetectedFrame, offset: number) => void
  onToolResult?: (frame: ToolResultFrame) => void
  /** The stream's last (or only) `done`. */
  onDone: (fullContent: string, frame: DoneFrame) => void | Promise<void>
  /**
   * Called for each full message surfaced mid-turn — a Carina reference
   * answer, a Host announcement (e.g. a turn-pass note), or a Pascal
   * custom-tool outcome — so it lands in the flow immediately rather than
   * waiting for the post-turn fetchChat().
   */
  onSurfacedMessage?: (message: Message) => void
  /** Called when an answer-confirmation result resolves for a message */
  onConfirmationResult?: (result: ConfirmationResultFrame) => void
  /** Called for intermediate done events during a chain (not the final one) */
  onIntermediateDone?: (fullContent: string, frame: DoneFrame) => void | Promise<void>
  onTurnStart?: (event: { participantId: string; characterName: string; chainDepth: number }) => void
  onTurnComplete?: (event: { participantId: string; messageId: string; chainDepth: number }) => void | Promise<void>
  onChainComplete?: (event: { reason: string; nextSpeakerId: string | null; chainDepth: number; paused: boolean; heldUserTurn: boolean }) => void | Promise<void>
}

export type TurnStreamHandlers = TurnStreamSinks & TurnStreamCallbacks

export async function readTurnStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  h: TurnStreamHandlers,
): Promise<string> {
  const decoder = new TextDecoder()
  let fullContent = ''
  let inChain = false
  // Tracks whether the "streaming started" flags have been flipped for the
  // current turn. The flags are idempotent after the first content chunk,
  // so re-firing them on every chunk just pressures the reconciler — in
  // long multi-character chains, that pressure has tipped React past its
  // update-depth limit. Reset on turnStart so each chained turn transitions
  // cleanly.
  let hasStartedStreaming = false
  // Whether the turn has been closed by a terminal event. `done` and
  // `chainComplete` close it; a chained `turnStart` reopens it, because a
  // connection lost mid-way through the next speaker's turn is just as
  // truncated as one lost before the first.
  let turnClosed = false
  // Each concurrent seat's prose so far, kept here as well as in
  // `concurrentStreams`: the seat's `done` needs the finished text now, and
  // React need not run a state updater before the next line executes, so
  // reading it back out of one left the reply bubble empty.
  const seatText = new Map<string, string>()

  /** The raised hand and the Storyteller board: the same whoever's seat sent them. */
  const applyFloorFrame = (
    frame: FrameOf<'handAsked' | 'handAnswered' | 'storytellerRound' | 'storytellerBid' | 'roundOpen'>,
  ): void => {
    switch (frame.kind) {
      // The chip beside the composer says each step, so neither the asking
      // nor a decline passes without a word.
      case 'handAsked':
        h.setHandStatus({ kind: 'asked', characterName: frame.characterName || 'The next speaker' })
        return
      case 'handAnswered':
        h.setHandStatus({
          kind: frame.yielded ? 'yielded' : 'declined',
          characterName: frame.characterName || 'The speaker',
        })
        return
      case 'storytellerRound':
        h.onStorytellerEvent?.({ kind: 'round', round: frame.round })
        return
      case 'storytellerBid':
        h.onStorytellerEvent?.({ kind: 'bid', roundId: frame.roundId, bid: frame.bid })
        return
      case 'roundOpen':
        h.onStorytellerEvent?.({ kind: 'open', roundId: frame.roundId })
        return
      default:
        assertNever(frame)
    }
  }

  /**
   * Storyteller "all at once": a frame from one of several concurrent turns.
   * Each seat gets its own bubble; the shared streaming slot is left alone.
   */
  const handleSeatFrame = (frame: StreamFrame, pid: string): void => {
    switch (frame.kind) {
      case 'handAsked':
      case 'handAnswered':
      case 'storytellerRound':
      case 'storytellerBid':
      case 'roundOpen':
        applyFloorFrame(frame)
        return
      case 'turnStart':
        if (!seatText.has(pid)) seatText.set(pid, '')
        h.setWaitingForResponse(false)
        h.setConcurrentStreams((prev) => prev.some((c) => c.participantId === pid)
          ? prev
          : [...prev, { participantId: pid, content: '' }])
        return
      case 'content': {
        if (!frame.text) return
        const text = frame.text
        seatText.set(pid, (seatText.get(pid) ?? '') + text)
        h.setConcurrentStreams((prev) => prev.some((c) => c.participantId === pid)
          ? prev.map((c) => c.participantId === pid ? { ...c, content: c.content + text } : c)
          : [...prev, { participantId: pid, content: text }])
        return
      }
      case 'done': {
        const finished = seatText.get(pid) ?? ''
        seatText.delete(pid)
        h.setConcurrentStreams((prev) => prev.filter((c) => c.participantId !== pid))
        if (frame.messageId && !doneLeavesNoReply(frame.outcome)) {
          const messageId = frame.messageId
          h.setMessages((prev) => prev.some((m) => m.id === messageId)
            ? prev
            : [...prev, assistantMessageFromDone(frame, finished, { participantId: pid })])
        }
        return
      }
      case 'posted':
        h.surfaceMessage(postedAsMessage(frame))
        return
      case 'error':
        showErrorToast(frame.message)
        return
      // A concurrent turn's status, thinking, tools and chain bookkeeping
      // have no bubble of their own; the round's own frames carry the rest.
      case 'reasoning':
      case 'status':
      case 'fileProcessing':
      case 'toolsDetected':
      case 'toolResult':
      case 'turnComplete':
      case 'chainComplete':
      case 'pendingExternalTurn':
      case 'confirmationResult':
      case 'swipeDone':
      case 'greenRoom':
        return
      default:
        assertNever(frame)
    }
  }

  const handleFrame = async (frame: StreamFrame): Promise<void> => {
    switch (frame.kind) {
      case 'handAsked':
      case 'handAnswered':
      case 'storytellerRound':
      case 'storytellerBid':
      case 'roundOpen':
        applyFloorFrame(frame)
        return

      case 'status':
        h.setResponseStatus(frame.status)
        // A turn being rescued: `retrying` is the same provider having
        // another go after an empty response, `failing-over` an understudy
        // from the fallback chain. Either way the reply is not the one the
        // user configured, so say so out loud.
        if (frame.status.stage === 'retrying' || frame.status.stage === 'failing-over') {
          showWarningToast(frame.status.message)
        }
        return

      case 'content':
        if (!frame.text) return
        fullContent += frame.text
        if (!hasStartedStreaming) {
          h.setWaitingForResponse(false)
          h.setStreaming(true)
          hasStartedStreaming = true
        }
        h.scheduleStreamingContent(fullContent)
        return

      // Live reasoning ("thinking") — cumulative, so replace the buffer.
      // DISPLAY ONLY; the StreamingMessage renders it as a leading block when
      // the chat's thinking-visibility is on.
      case 'reasoning':
        h.scheduleStreamingReasoning(frame.text)
        return

      case 'error':
        h.setResponseStatus(null)
        throw new SalonSendError(frame.details ? `${frame.message}: ${frame.details}` : frame.message, {
          userMessagePersisted: frame.userMessagePersisted,
          pendingToolResultsPersisted: frame.pendingToolResultsPersisted,
        })

      // `fullContent` is the prose streamed so far — the offset at which
      // this batch was invoked.
      case 'toolsDetected':
        h.onToolsDetected?.(frame, fullContent.length)
        return

      case 'toolResult':
        h.onToolResult?.(frame)
        return

      // A Carina answer, a Host announcement (turn-pass note) or a Pascal
      // outcome, inserted at once (deduped by id) rather than waiting for
      // the post-turn fetchChat().
      case 'posted':
        h.onSurfacedMessage?.(postedAsMessage(frame))
        return

      // Update the badge and, on a revision, swap in the corrected bubble
      // text (a deliberate, visible transparency swap).
      case 'confirmationResult':
        h.onConfirmationResult?.(frame)
        return

      case 'done': {
        turnClosed = true
        h.setResponseStatus(null)
        // Attachments the provider plugin could not put on the wire (bug 94).
        const attachmentWarning = buildFailedAttachmentWarning(frame.attachmentResults?.failed)
        if (attachmentWarning) showWarningToast(attachmentWarning)
        if (inChain && h.onIntermediateDone) {
          // Intermediate done during a chain — lighter cleanup, no state reset
          await h.onIntermediateDone(fullContent, frame)
        } else {
          await h.onDone(fullContent, frame)
        }
        // The Courier's parked turn: the placeholder arrives with the refetch.
        if (frame.pendingExternalTurn) await h.fetchChat()
        return
      }

      // The Courier placed a placeholder for a manual / clipboard turn.
      // Refetch so the bubble appears with the Markdown blob + paste
      // textarea. The accompanying `done` closes the turn.
      case 'pendingExternalTurn':
        await h.fetchChat()
        return

      case 'turnStart':
        // Only a chained turn (depth > 0) enters a chain. The server also
        // sends a depth-0 turnStart before every first turn so the bubble
        // shows the right responder; that one must leave the turn's `done`
        // on the ordinary end-of-turn path (bug 242).
        if (frame.chainDepth > 0) inChain = true
        turnClosed = false
        fullContent = ''
        hasStartedStreaming = false
        h.resetStreamingContent()
        h.setStreaming(false)
        h.setWaitingForResponse(true)
        h.onTurnStart?.({
          participantId: frame.participantId,
          characterName: frame.characterName || 'Unknown',
          chainDepth: frame.chainDepth,
        })
        return

      case 'turnComplete':
        await h.onTurnComplete?.({
          participantId: frame.participantId,
          messageId: frame.messageId,
          chainDepth: frame.chainDepth,
        })
        return

      case 'chainComplete':
        inChain = false
        turnClosed = true
        await h.onChainComplete?.({
          reason: frame.reason,
          nextSpeakerId: frame.nextSpeakerId,
          chainDepth: frame.chainDepth,
          paused: frame.paused === true,
          heldUserTurn: frame.heldUserTurn === true,
        })
        return

      case 'greenRoom':
        h.onGreenRoom?.(frame.greenRoom)
        return

      // Not frames a Salon send carries.
      case 'fileProcessing':
      case 'swipeDone':
        return

      default:
        assertNever(frame)
    }
  }

  const handleLine = async (line: string): Promise<void> => {
    if (!line.startsWith('data: ')) return
    const frame = parseFrame(line.slice(6))
    if (!frame) return
    // A frame is a concurrent seat's or the stream's own, and then exactly
    // one kind — no order of tests decides what it means.
    if (frame.seat) handleSeatFrame(frame, frame.seat.participantId)
    else await handleFrame(frame)
  }

  // Lines are carried across reads: a frame split between two chunks used to
  // be cut in half, fail to parse, and vanish — taking an error frame with it.
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const split = splitSseBuffer(buffer, decoder.decode(value, { stream: true }))
    buffer = split.rest
    for (const line of split.lines) {
      await handleLine(line)
    }
  }

  // Whatever the decoder and the buffer still hold is the stream's last line.
  const tail = buffer + decoder.decode()
  for (const line of tail.split('\n')) {
    await handleLine(line)
  }

  if (!turnClosed) {
    h.setResponseStatus(null)
    throw new StreamClosedEarlyError()
  }

  return fullContent
}

/**
 * Read a narration-only stream — a join the operator is watching
 * (`?action=add-participant` with `narrate: true`) — passing each `greenRoom`
 * frame on. Everything else on it is ignored.
 */
export async function readGreenRoomFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onGreenRoom: (event: GreenRoomEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  const handle = (line: string) => {
    if (!line.startsWith('data: ')) return
    const frame = parseFrame(line.slice(6))
    if (frame?.kind === 'greenRoom') onGreenRoom(frame.greenRoom)
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const split = splitSseBuffer(buffer, decoder.decode(value, { stream: true }))
    buffer = split.rest
    split.lines.forEach(handle)
  }
  (buffer + decoder.decode()).split('\n').forEach(handle)
}
