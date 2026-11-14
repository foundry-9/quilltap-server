/**
 * Pure helpers and shared types for the Salon's turn streams.
 *
 * No React here: everything is a plain function or a type, so the stream
 * reader (`read-turn-stream.ts`), the streaming hooks and their tests can share
 * it without rendering anything.
 */

import type { Message } from '../types'
import type { StorytellerBid, StorytellerRound } from '@/lib/schemas/storyteller.types'
import type { DoneFrame, PostedFrame } from '@/lib/chat/stream-frames'

/** Storyteller frames the Salon's board reads off a send's stream. */
export type StorytellerStreamEvent =
  | { kind: 'round'; round: StorytellerRound }
  | { kind: 'bid'; roundId: string; bid: StorytellerBid }
  | { kind: 'open'; roundId: string }

/** One live bubble for a concurrent ("all at once") storyteller turn. */
export interface ConcurrentStream {
  participantId: string
  content: string
}

export interface PendingToolCall {
  id: string
  name: string
  status: 'pending' | 'success' | 'error'
  result?: unknown
  arguments?: Record<string, unknown>
}

/**
 * A batch of in-progress tool calls plus the offset into the streamed response
 * text at which they were invoked. Lets the streaming bubble splice each batch
 * back into the live prose at the point the model paused to call it — the live
 * analogue of the persisted `anchorOffset` carried on saved tool messages.
 */
export interface StreamingToolBatch {
  offset: number
  calls: PendingToolCall[]
}


export type { ResponseStatus } from '@/lib/chat/stream-frames'

/**
 * Pull the human-readable failure sentence out of a `toolResult` frame.
 *
 * The emitter (`lib/services/chat-message/tool-execution.service.ts`) puts the
 * text in `error`, a **sibling** of `result`, because `result` itself is null on
 * failure. The nested `result.error` read is kept only as a fallback in case a
 * provider ever puts it there. The executor wraps the sentence in its own
 * `Error: ` prefix, which is stripped so display sites don't read
 * "Image generation failed: Error: ..." (Bug 84).
 */
export function resolveToolResultErrorText(
  toolResult: { result?: unknown; error?: string } | undefined
): string | undefined {
  const raw = toolResult?.error || (toolResult?.result as { error?: string } | null | undefined)?.error
  return raw?.replace(/^Error:\s*/, '').trim() || undefined
}

/**
 * Compose the warning for attachments the provider plugin could not put on the
 * wire. The `attachmentResults` ledger has always been emitted and was never
 * displayed (bug 94), so an image that silently failed to reach a vision model
 * looked exactly like a model that had seen it and ignored it.
 *
 * Returns null when there is nothing to warn about, so the caller can raise the
 * toast unconditionally on a non-null result.
 */
export function buildFailedAttachmentWarning(
  failed: Array<{ id: string; error: string }> | null | undefined
): string | null {
  if (!Array.isArray(failed) || failed.length === 0) return null
  const first = failed[0]?.error ?? 'unknown reason'
  const more = failed.length > 1 ? ` (and ${failed.length - 1} more)` : ''
  const subject = failed.length === 1 ? 'An attachment was' : `${failed.length} attachments were`
  return `${subject} not sent to the model${more}: ${first}`
}

/**
 * A send that failed with a server-side error frame (or an HTTP refusal before
 * any stream opened). Carries what the server said about whether the user's
 * submission reached the database, so the send path can decide whether to hand
 * the typed text back to the composer (bug 241). `undefined` means the server
 * did not say.
 */
export class SalonSendError extends Error {
  readonly userMessagePersisted: boolean | undefined
  readonly pendingToolResultsPersisted: boolean | undefined

  constructor(
    message: string,
    persisted: { userMessagePersisted?: boolean; pendingToolResultsPersisted?: boolean } = {},
  ) {
    super(message)
    this.name = 'SalonSendError'
    this.userMessagePersisted = persisted.userMessagePersisted
    this.pendingToolResultsPersisted = persisted.pendingToolResultsPersisted
  }
}

/** The toast text for a stream that ended without a done, chainComplete or error. */
export const STREAM_CLOSED_EARLY_MESSAGE = 'The connection closed before the reply was finished. Please try again.'

/**
 * The stream ended without any terminal event. Every server path closes a turn
 * with `done`, `chainComplete` or an error frame, so a bare EOF is a dropped
 * connection — once read as a quiet success (bug 241). Whether the user's
 * message was saved is unknown here.
 */
export class StreamClosedEarlyError extends Error {
  constructor() {
    super(STREAM_CLOSED_EARLY_MESSAGE)
    this.name = 'StreamClosedEarlyError'
  }
}

/** Appended to the failure toast when the typed text was put back in the composer. */
export const SUBMISSION_RESTORED_NOTE = 'Your message is back in the composer.'

/** The failure toast's text, with the restored note as its own sentence. */
export function sendFailureToastText(message: string, restored: boolean): string {
  if (!restored) return message
  const trimmed = message.trimEnd()
  const sentence = /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
  return `${sentence} ${SUBMISSION_RESTORED_NOTE}`
}

/** How long a failed-send toast stays up — long enough to actually read it. */
export const SEND_FAILURE_TOAST_MS = 8000

/**
 * The optimistic assistant bubble a `done` frame closes, shown until the
 * post-turn `fetchChat()` replaces it with the authoritative row (same id).
 * The server's `participantId` is authoritative; `fallback` covers a frame
 * that omits it, and a placeholder id for one with no `messageId`.
 */
export function assistantMessageFromDone(
  frame: DoneFrame,
  content: string,
  fallback: { participantId: string | null; id?: string },
): Message {
  return {
    id: frame.messageId || fallback.id || '',
    role: 'ASSISTANT',
    content,
    createdAt: new Date().toISOString(),
    participantId: frame.participantId || fallback.participantId,
    provider: frame.provider || null,
    modelName: frame.modelName || null,
    routeTrail: frame.routeTrail ?? null,
    isSilentMessage: frame.isSilentMessage || undefined,
    reasoningContent: frame.reasoningContent ?? null,
    reasoningSegments: frame.reasoningSegments ?? null,
  }
}

/** A message the server already saved, as the Salon's message list holds it. */
export function postedAsMessage(frame: PostedFrame): Message {
  return frame.message as unknown as Message
}

/**
 * Append a server-posted message to the live list unless it is already there.
 * Messages surfaced mid-turn (Carina answers, Host turn-pass notes, Pascal
 * outcomes, Librarian announcements) are inserted optimistically and later
 * reconciled by the post-turn `fetchChat()`, so the same id can arrive twice.
 */
export function appendMessageOnce(messages: Message[], message: Message): Message[] {
  return messages.some(m => m.id === message.id) ? messages : [...messages, message]
}

/**
 * Where the operator's raised hand stands, shown beside the composer
 * (`RaisedHandChip`). `raised` is up and nobody asked yet; `asked` names the
 * speaker weighing it; the last three are the outcome, kept until the
 * operator dismisses it or speaks again.
 */
export type RaisedHandStatus =
  | { kind: 'raised' }
  | { kind: 'asked'; characterName: string }
  | { kind: 'yielded'; characterName: string }
  | { kind: 'declined'; characterName: string }
  | { kind: 'unasked' }

/** Is the hand still up — raised, or being weighed by a speaker? */
export function isHandUp(status: RaisedHandStatus | null): boolean {
  return status?.kind === 'raised' || status?.kind === 'asked'
}

/**
 * The stream has ended. A hand nobody was asked about is said so; one whose
 * speaker never answered (a stop, an error) simply goes down; an outcome
 * stays where it is.
 */
export function settleHandAtStreamEnd(prev: RaisedHandStatus | null): RaisedHandStatus | null {
  if (prev?.kind === 'raised') return { kind: 'unasked' }
  if (prev?.kind === 'asked') return null
  return prev
}
