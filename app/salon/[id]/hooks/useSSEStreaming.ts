'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { showSuccessToast, showErrorToast, showWarningToast, showInfoToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { ChatParticipantBase } from '@/lib/schemas/types'
import { findActiveUserParticipant, isAllLLMChat } from '@/lib/chat/turn-manager'
import type { Message, MessageAttachment, Chat, PendingToolResult } from '../types'
import type { RouteAttempt } from '@/lib/schemas/chat.types'
import type { ComposerEditorHandle } from '@/components/chat/lexical/types'
import { useToolExecutionStatus } from './useToolExecutionStatus'
import { splitSseBuffer } from '@/components/agent-stream/parse-agent-stream'
import type { StorytellerBid, StorytellerOrder, StorytellerRound } from '@/lib/schemas/storyteller.types'

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

// The tool-execution notice owns its own lifetime (bug 77); re-exported here
// because this hook's consumers import the type from it.
export type { ToolExecutionStatus } from './useToolExecutionStatus'

export interface ResponseStatus {
  stage: string
  message: string
  toolName?: string
  characterName?: string
  characterId?: string
}

/** Result of parsing a single SSE data line */
interface SSEEvent {
  content?: string
  /** Live cumulative reasoning ("thinking") text. DISPLAY ONLY — the client
   *  replaces (not appends) its buffer with each value. */
  reasoning?: string
  /** Full reasoning text on the done event (for the optimistic assistant push). */
  reasoningContent?: string | null
  /** Positioned reasoning blocks on the done event. DISPLAY ONLY. */
  reasoningSegments?: Array<{ anchorOffset: number; content: string; seq: number }> | null
  status?: ResponseStatus
  error?: string
  details?: string
  /**
   * Error frame only: whether the user's message row was saved before the
   * failure. Absent from older servers, in which case the client treats the
   * question as open and asks the post-error read instead (bug 241).
   */
  userMessagePersisted?: boolean
  /** Error frame only: whether the staged tool results were saved as rows. */
  pendingToolResultsPersisted?: boolean
  done?: boolean
  messageId?: string
  emptyResponse?: boolean
  emptyResponseReason?: string
  toolsDetected?: boolean
  toolNames?: string[]
  toolArguments?: Record<string, unknown>[]
  toolResult?: {
    index?: number
    name: string
    success: boolean
    result?: any
    /**
     * Human-readable failure text, set by the emitter only when `success` is
     * false (the `result` field is usually null on error). Sibling of `result`,
     * not nested inside it.
     */
    error?: string
  }
  provider?: string
  modelName?: string
  /** The turn's route trail on the done event — every profile tried, in order —
   *  so the optimistic assistant push carries the call sheet without a refetch.
   *  Absent/null (the common case) when nothing failed. */
  routeTrail?: RouteAttempt[] | null
  /**
   * What the provider plugin managed to put on the wire. `failed` entries are
   * attachments the model never received — surfaced as a warning toast on the
   * done event, because a silently dropped image is indistinguishable from a
   * model that saw it and said nothing (bug 94).
   */
  attachmentResults?: {
    sent?: string[]
    failed?: Array<{ id: string; error: string }>
  } | null
  // Turn/chain events are sent as flat JSON with boolean flags
  // e.g. { turnStart: true, participantId: "...", characterName: "...", chainDepth: 1 }
  turnStart?: boolean
  turnComplete?: boolean
  chainComplete?: boolean
  participantId?: string
  characterName?: string
  chainDepth?: number
  nextSpeakerId?: string | null
  reason?: string
  /** chainComplete: the chat is (or was just) marked paused as part of this stop (bug 123). */
  paused?: boolean
  /** chainComplete: the stop is the user's own message — a paused room recorded
   *  it and gave it to nobody (bug 137). */
  heldUserTurn?: boolean
  isSilentMessage?: boolean
  // The Courier: { pendingExternalTurn: true, messageId, participantId, characterName }
  pendingExternalTurn?: boolean
  // Carina: the full posted reference-answer message, surfaced the instant it
  // returns so the Salon renders the card without waiting for the post-turn
  // fetchChat(). Inserted optimistically and deduped by id; the end-of-turn
  // refresh reconciles it to the authoritative copy.
  carinaAnswer?: Message
  // "Nothing to add" turn-skipping. `hostAnnouncement` carries the full posted
  // Host turn-pass message (surfaced live like carinaAnswer, deduped by id).
  // On the done event, `skipped` marks that this turn was passed so the client
  // resets its streaming buffer without appending a phantom bubble.
  hostAnnouncement?: Message
  // Pascal: the full posted custom-tool outcome message, surfaced the instant
  // the dice fall so the Salon renders the bubble without waiting for the
  // post-turn fetchChat(). Inserted optimistically and deduped by id; the
  // end-of-turn refresh reconciles it to the authoritative copy.
  pascalResult?: Message
  skipped?: boolean
  skippedParticipantId?: string | null
  /** done: the operator hard-stopped the turn before any prose streamed. */
  stopped?: boolean
  /** done / handAnswered: the character yielded the floor to the raised hand. */
  yielded?: boolean
  /**
   * Storyteller: a frame from one of several turns sharing the stream ("all at
   * once"). Every such frame carries `participantId`; the Salon keeps one
   * streaming bubble per participant for them.
   */
  concurrent?: boolean
  /** Storyteller: the round's board as it opened. */
  storytellerRound?: StorytellerRound
  /** Storyteller: one seat's bid landed. */
  storytellerBid?: { roundId: string; bid: StorytellerBid }
  /** Storyteller: every bid is in (or the board timed out); the choice is the operator's. */
  roundOpen?: boolean
  roundId?: string
  /** The character asked about the operator's raised hand has answered it. */
  handAnswered?: boolean
  // Answer confirmation: the resolved state for a just-streamed message. On a
  // re-affirmation rewrite, `content` carries the replacement bubble text.
  confirmationResult?: {
    messageId: string
    confirmed: boolean | null
    revised: boolean
    notes: string | null
    content?: string
  }
}

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
 * Parse a raw SSE data string into a structured event, or null if it should be skipped.
 */
export function parseSSEData(rawData: string): SSEEvent | null {
  const trimmed = rawData.trim()
  if (!trimmed || trimmed === '[DONE]' || trimmed === '{}') {
    return null
  }
  try {
    return JSON.parse(trimmed) as SSEEvent
  } catch {
    // Ignore JSON parse errors (SSE chunking artifacts)
    return null
  }
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

interface UseSSEStreamingParams {
  chatId: string
  chat: Chat | null
  messages: Message[]
  setMessages: (fn: Message[] | ((prev: Message[]) => Message[])) => void
  isMultiChar: boolean
  hasActiveCharacters: boolean
  participantsAsBase: ChatParticipantBase[]
  isPaused: boolean
  respondingParticipantId: string | null
  setRespondingParticipantId: (id: string | null) => void
  /** The user-controlled participant the human is currently "Speaking As" (null = default) */
  activeTypingParticipantId: string | null
  /** Seats the human is impersonating this session (overlay; `controlledBy` stays `'llm'`) */
  impersonatingParticipantIds: string[]
  fetchChat: () => Promise<void>
  /**
   * Retire any optimistic bubble still on screen. Reconciliation drops one the
   * moment the authoritative read carries its persisted row; this is the turn
   * boundary's broom for the send that never persisted at all.
   */
  clearProvisionalMessages: () => void
  scrollOnUserMessage: () => void
  scrollOnStreamComplete: () => void
  setAttachedFiles: (files: any[]) => void
  inputRef: React.RefObject<ComposerEditorHandle | null>
  getFirstCharacterParticipant: () => import('../types').Participant | undefined
  setPauseState: (paused: boolean) => void
  /** Called when a tool result arrives, allowing the page to react to specific tools */
  onToolResult?: (name: string, success: boolean, result: unknown) => void
  /** Storyteller: the board's frames (round opened, bid landed, round open for choosing). */
  onStorytellerEvent?: (event: StorytellerStreamEvent) => void
}

/**
 * The Salon's live message transport, built on Fetch Streams (SSE-style events).
 *
 * TanStack Query boundary: this is deliberately NOT a TanStack Query concern.
 * Query is a server-state *cache*, not a streaming transport — stream chunks are
 * never written into the query cache, and the live message buffer is owned here
 * via `setMessages`. The query reads that surround
 * streaming (chat list, chat settings, LLM logs) live on TanStack Query and are
 * refreshed through their own hooks (e.g. `useLLMLogs.refreshLogs()` fires when a
 * turn completes); the authoritative post-turn message reconciliation goes
 * through the page's own `fetchChat()`. Keep that separation: do not move stream
 * handling onto `useQuery`, and do not push chunks into `queryClient`.
 */
export function useSSEStreaming({
  chatId,
  chat,
  messages,
  setMessages,
  isMultiChar,
  hasActiveCharacters,
  participantsAsBase,
  isPaused,
  respondingParticipantId,
  setRespondingParticipantId,
  activeTypingParticipantId,
  impersonatingParticipantIds,
  fetchChat,
  clearProvisionalMessages,
  scrollOnUserMessage,
  scrollOnStreamComplete,
  setAttachedFiles,
  inputRef,
  getFirstCharacterParticipant,
  setPauseState,
  onToolResult: onToolResultCallback,
  onStorytellerEvent,
}: UseSSEStreamingParams) {
  // Storyteller: live bubbles for concurrent turns, keyed by participant.
  const [concurrentStreams, setConcurrentStreams] = useState<ConcurrentStream[]>([])
  const onStorytellerEventRef = useRef(onStorytellerEvent)
  useEffect(() => {
    onStorytellerEventRef.current = onStorytellerEvent
  }, [onStorytellerEvent])
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  // The operator's interrupts (lib/chat/turn-control.ts on the server): a
  // raised hand waiting for the next speaker's answer, and a hard stop the
  // server is still putting away.
  const [handRaised, setHandRaised] = useState(false)
  const [stopping, setStopping] = useState(false)
  const stoppingRef = useRef(false)
  const [streamingContent, setStreamingContent] = useState('')
  // Mirror the live "Speaking As" selection into a ref so the send/continue
  // callbacks read the current value without re-creating on every selection.
  const activeTypingParticipantIdRef = useRef(activeTypingParticipantId)
  useEffect(() => {
    activeTypingParticipantIdRef.current = activeTypingParticipantId
  }, [activeTypingParticipantId])
  // Mirror the impersonation overlay and the participant roster so the optimistic
  // user bubble can resolve its author exactly the way the server will (Bug 45) —
  // the send callback deliberately does not re-create on every roster/overlay
  // change, so it reads these through refs rather than stale closure captures.
  const impersonatingParticipantIdsRef = useRef(impersonatingParticipantIds)
  useEffect(() => {
    impersonatingParticipantIdsRef.current = impersonatingParticipantIds
  }, [impersonatingParticipantIds])
  const participantsAsBaseRef = useRef(participantsAsBase)
  useEffect(() => {
    participantsAsBaseRef.current = participantsAsBase
  }, [participantsAsBase])
  // Live cumulative reasoning ("thinking") for the in-progress turn. DISPLAY ONLY.
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [waitingForResponse, setWaitingForResponse] = useState(false)
  // In-progress tool calls for the turn being streamed, grouped into batches by
  // the point in the prose where each fired (see StreamingToolBatch). Replaces a
  // single flat list so the streaming bubble can interleave them with the text.
  const [streamingToolBatches, setStreamingToolBatches] = useState<StreamingToolBatch[]>([])
  const [responseStatus, setResponseStatus] = useState<ResponseStatus | null>(null)
  // The tool-execution notice: raised, self-expiring, and dismissable from one
  // place. The banner used to be cleared only from the send path's onDone, so
  // any turn that finished by another route — a chain's intermediate done,
  // continue mode, an error, an autonomous turn — left it pinned above the
  // composer forever (bug 77).
  const {
    toolExecutionStatus,
    publishToolExecutionStatus,
    dismissToolExecutionStatus,
    clearPendingToolExecutionStatus,
  } = useToolExecutionStatus()

  const abortControllerRef = useRef<AbortController | null>(null)
  // Monotonic batch counter so tool-call React keys stay unique across batches.
  const toolBatchSeqRef = useRef(0)

  // rAF-coalesced streaming content updates. SSE chunks can arrive faster
  // than React can render them — in long multi-character chains that burst
  // of per-chunk state updates has tripped React's update-depth limit. We
  // buffer the latest accumulated content in a ref and flush at most once
  // per animation frame, capping the render rate at the display refresh
  // rate regardless of chunk cadence.
  const streamingContentBufferRef = useRef<string>('')
  const streamingContentRafRef = useRef<number | null>(null)
  // Reasoning shares the same rAF-coalescing treatment as content.
  const streamingReasoningBufferRef = useRef<string>('')
  const streamingReasoningRafRef = useRef<number | null>(null)

  const flushStreamingContent = useCallback(() => {
    streamingContentRafRef.current = null
    setStreamingContent(streamingContentBufferRef.current)
  }, [])

  const scheduleStreamingContent = useCallback((content: string) => {
    streamingContentBufferRef.current = content
    if (streamingContentRafRef.current === null) {
      streamingContentRafRef.current = requestAnimationFrame(flushStreamingContent)
    }
  }, [flushStreamingContent])

  const flushStreamingReasoning = useCallback(() => {
    streamingReasoningRafRef.current = null
    setStreamingReasoning(streamingReasoningBufferRef.current)
  }, [])

  // Reasoning arrives cumulatively, so we replace (not append) the buffer.
  const scheduleStreamingReasoning = useCallback((reasoning: string) => {
    streamingReasoningBufferRef.current = reasoning
    if (streamingReasoningRafRef.current === null) {
      streamingReasoningRafRef.current = requestAnimationFrame(flushStreamingReasoning)
    }
  }, [flushStreamingReasoning])

  const resetStreamingContent = useCallback(() => {
    if (streamingContentRafRef.current !== null) {
      cancelAnimationFrame(streamingContentRafRef.current)
      streamingContentRafRef.current = null
    }
    streamingContentBufferRef.current = ''
    setStreamingContent('')
    // Reasoning resets in lockstep with content so every turn-boundary cleanup
    // (turnStart, done, errors, stop) clears the live thinking block too.
    if (streamingReasoningRafRef.current !== null) {
      cancelAnimationFrame(streamingReasoningRafRef.current)
      streamingReasoningRafRef.current = null
    }
    streamingReasoningBufferRef.current = ''
    setStreamingReasoning('')
  }, [])

  /** Insert a mid-turn surfaced message (deduped by id) and keep the view pinned. */
  const surfaceMessage = useCallback((message: Message) => {
    setMessages(prev => appendMessageOnce(prev, message))
    scrollOnStreamComplete()
  }, [setMessages, scrollOnStreamComplete])

  /**
   * "Nothing to add" turn-pass: the Host note already surfaced via
   * `surfaceMessage`. Reset the streaming buffer without appending a phantom
   * bubble or toasting; the chain (or chainComplete) drives the rest.
   */
  const finishSkippedTurn = useCallback(() => {
    resetStreamingContent()
    setStreaming(false)
  }, [resetStreamingContent])

  // Mirrors `isPaused` so a callback closed over an earlier render can still ask
  // whether a pause is *news* — a stop the user did not cause themselves.
  const isPausedRef = useRef(isPaused)
  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  // Whether the "your remark was recorded, nobody answered it" notice has
  // already been given for the pause currently in force. Reset whenever the
  // pause lifts, so the first message into each new pause explains itself and
  // a long dictation into a paused room does not raise a toast a paragraph.
  const heldTurnAnnouncedRef = useRef(false)
  useEffect(() => {
    if (!isPaused) heldTurnAnnouncedRef.current = false
  }, [isPaused])

  /**
   * Bug 123: a chain that stops because the chat is paused used to do so in
   * silence — the room simply stopped answering, one reply per message, and the
   * sidebar's Pause button was the only place the state was visible (and, with
   * the sync drift the same bug fixed, not even there). Say so. Skipped when the
   * user pressed Pause themselves (they already got the toggle's toast) and in
   * an all-LLM room, where AllLLMPauseModal explains the stop.
   *
   * Bug 137 adds the other silence: a message typed into an already-paused room
   * is recorded and answered by nobody, which is the state the user asked for
   * and still looks exactly like a send that broke. Announced once per pause —
   * the user knows they are paused, they just need telling that this is why
   * nothing happened, and how to get a turn out of it.
   */
  const announceChainPause = useCallback((event: { reason: string; paused: boolean; heldUserTurn?: boolean }) => {
    if (!event.paused) return
    if (event.heldUserTurn) {
      if (heldTurnAnnouncedRef.current) return
      heldTurnAnnouncedRef.current = true
      showInfoToast('Your remark is in the record. The room stays paused — nudge a character for a single turn, or press Resume.')
      return
    }
    if (isPausedRef.current) return
    if (isAllLLMChat(participantsAsBase)) return
    if (event.reason === 'error') {
      showWarningToast('A character\'s turn failed, so auto-responses are paused. Press Resume in the sidebar to carry on.')
    } else {
      showInfoToast('Auto-responses are paused. Press Resume in the sidebar to let the others answer.')
    }
  }, [participantsAsBase])

  // Patch a message in place with its resolved answer-confirmation state. On a
  // re-affirmation rewrite (`content` present) the optimistic bubble text is
  // replaced with the corrected reply — a deliberate, visible transparency swap.
  const applyConfirmationResult = useCallback((result: {
    messageId: string
    confirmed: boolean | null
    revised: boolean
    notes: string | null
    content?: string
  }) => {
    setMessages(prev => prev.map(m => m.id === result.messageId ? {
      ...m,
      confirmed: result.confirmed,
      confirmationChecked: true,
      confirmationRevised: result.revised,
      confirmationNotes: result.notes,
      ...(typeof result.content === 'string' ? { content: result.content } : {}),
    } : m))
  }, [setMessages])

  // Cancel any pending rAF on unmount to avoid setting state after teardown.
  // (The tool-status auto-dismiss timer is cleaned up by its own hook.)
  useEffect(() => {
    return () => {
      if (streamingContentRafRef.current !== null) {
        cancelAnimationFrame(streamingContentRafRef.current)
      }
      if (streamingReasoningRafRef.current !== null) {
        cancelAnimationFrame(streamingReasoningRafRef.current)
      }
    }
  }, [])

  // Focus input after response completes
  const focusInput = useCallback(() => {
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true })
    }, 150)
  }, [inputRef])

  // Push a freshly-detected tool batch, tagged with the prose offset where it
  // fired, and surface image-generation status. Shared by the send and continue
  // streaming paths so both interleave tool calls into the live bubble.
  const trackToolsDetected = useCallback((data: SSEEvent, offset: number) => {
    const toolNames = (data.toolNames || []) as string[]
    const toolArgs = (data.toolArguments || []) as Record<string, unknown>[]
    const seq = toolBatchSeqRef.current++
    const calls: PendingToolCall[] = toolNames.map((name, idx) => ({
      id: `tool-${seq}-${idx}`,
      name,
      status: 'pending' as const,
      arguments: toolArgs[idx],
    }))
    setStreamingToolBatches(prev => [...prev, { offset, calls }])
    if (toolNames.includes('generate_image')) {
      publishToolExecutionStatus({
        tool: 'generate_image',
        status: 'pending',
        message: `Generating image...`,
      })
    }
  }, [publishToolExecutionStatus])

  // Mark a tool result on the most recent batch (results stream immediately
  // after their detection) and run per-tool side effects (navigation, image
  // toasts, page callback).
  const trackToolResult = useCallback((data: SSEEvent) => {
    const { index, name, success, result, error } = data.toolResult!

    setStreamingToolBatches(prev => {
      if (prev.length === 0) return prev
      const lastIdx = prev.length - 1
      const last = prev[lastIdx]
      const calls = last.calls.map((tc, idx) =>
        (index !== undefined && idx === index) || (index === undefined && tc.name === name)
          ? { ...tc, status: success ? ('success' as const) : ('error' as const), result }
          : tc
      )
      const next = prev.slice()
      next[lastIdx] = { ...last, calls }
      return next
    })

    // Handle help_navigate: navigate the current window to the target URL
    if (name === 'help_navigate' && success && result?.navigationUrl) {
      window.location.href = result.navigationUrl
    }

    if (name === 'generate_image') {
      if (success) {
        const imageCount = result?.images?.length || 1
        publishToolExecutionStatus({
          tool: name,
          status: 'success',
          message: `Successfully generated ${imageCount} image${imageCount > 1 ? 's' : ''}!`,
        })
        showSuccessToast(`Image generation complete! ${imageCount} image${imageCount > 1 ? 's' : ''} generated.`)
      } else {
        const detail = resolveToolResultErrorText({ result, error })
        publishToolExecutionStatus({
          tool: name,
          status: 'error',
          message: detail || 'Failed to generate image',
        })
        showErrorToast(`Image generation failed: ${detail || 'Unknown error'}`)
      }
    }

    // Notify the page about tool results (for Document Mode, etc.)
    onToolResultCallback?.(name, success, result)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onToolResultCallback is a stable page-level callback
  }, [publishToolExecutionStatus])

  /**
   * Shared SSE stream reader. Processes lines from a ReadableStreamDefaultReader.
   * Returns the accumulated full content string.
   *
   * `onDone` is called when data.done is received, allowing the caller to finalize.
   */
  const readSSEStream = useCallback(async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    opts: {
      participantId: string | null
      /** `offset` is the length of the response text streamed so far — where
       *  this batch of tool calls was invoked in the prose. */
      onToolsDetected?: (data: SSEEvent, offset: number) => void
      onToolResult?: (data: SSEEvent) => void
      onDone: (fullContent: string, data: SSEEvent) => void | Promise<void>
      /**
       * Called for each full message surfaced mid-turn — a Carina reference
       * answer, a Host announcement (e.g. a turn-pass note), or a Pascal
       * custom-tool outcome — so it lands in the flow immediately rather than
       * waiting for the post-turn fetchChat().
       */
      onSurfacedMessage?: (message: Message) => void
      /** Called when an answer-confirmation result resolves for a message */
      onConfirmationResult?: (result: NonNullable<SSEEvent['confirmationResult']>) => void
      /** Called for intermediate done events during a chain (not the final one) */
      onIntermediateDone?: (fullContent: string, data: SSEEvent) => void | Promise<void>
      onTurnStart?: (event: { participantId: string; characterName: string; chainDepth: number }) => void
      onTurnComplete?: (event: { participantId: string; messageId: string; chainDepth: number }) => void | Promise<void>
      onChainComplete?: (event: { reason: string; nextSpeakerId: string | null; chainDepth: number; paused: boolean; heldUserTurn: boolean }) => void | Promise<void>
    }
  ): Promise<string> => {
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

    const handleLine = async (line: string): Promise<void> => {
      if (!line.startsWith('data: ')) return
      const rawData = line.slice(6)
      const data = parseSSEData(rawData)
      if (!data) return

      // Storyteller board frames: handed to the board, nothing else to do.
      if (data.storytellerRound) {
        onStorytellerEventRef.current?.({ kind: 'round', round: data.storytellerRound })
        return
      }
      if (data.storytellerBid) {
        onStorytellerEventRef.current?.({ kind: 'bid', ...data.storytellerBid })
        return
      }
      if (data.roundOpen && data.roundId) {
        onStorytellerEventRef.current?.({ kind: 'open', roundId: data.roundId })
        return
      }

      // Storyteller "all at once": a frame from one of several concurrent
      // turns. Each participant gets its own bubble; the shared streaming
      // slot is left alone.
      if (data.concurrent && data.participantId) {
        const pid = data.participantId
        if (data.turnStart) {
          setWaitingForResponse(false)
          setConcurrentStreams((prev) => prev.some((c) => c.participantId === pid)
            ? prev
            : [...prev, { participantId: pid, content: '' }])
        } else if (data.content) {
          setConcurrentStreams((prev) => prev.some((c) => c.participantId === pid)
            ? prev.map((c) => c.participantId === pid ? { ...c, content: c.content + data.content } : c)
            : [...prev, { participantId: pid, content: data.content! }])
        } else if (data.done) {
          let finished = ''
          setConcurrentStreams((prev) => {
            finished = prev.find((c) => c.participantId === pid)?.content ?? ''
            return prev.filter((c) => c.participantId !== pid)
          })
          if (data.messageId && !data.skipped && !data.stopped) {
            const messageId = data.messageId
            setMessages((prev) => prev.some((m) => m.id === messageId) ? prev : [...prev, {
              id: messageId,
              role: 'ASSISTANT',
              content: finished,
              createdAt: new Date().toISOString(),
              participantId: pid,
              provider: data.provider || null,
              modelName: data.modelName || null,
              routeTrail: data.routeTrail ?? null,
              isSilentMessage: data.isSilentMessage || undefined,
              reasoningContent: data.reasoningContent ?? null,
              reasoningSegments: data.reasoningSegments ?? null,
            }])
          }
        } else if (data.carinaAnswer || data.hostAnnouncement || data.pascalResult) {
          surfaceMessage((data.carinaAnswer || data.hostAnnouncement || data.pascalResult)!)
        } else if (data.error) {
          showErrorToast(data.error)
        }
        return
      }

      // Handle status updates
      if (data.status) {
        setResponseStatus(data.status)
        // Show a warning toast when the turn is being rescued: `retrying`
        // is the same provider having another go after an empty response,
        // `failing-over` is an understudy from the profile's fallback chain
        // taking the turn. Both are moments where the reply the user gets is
        // not the one they configured, so both are worth saying out loud.
        if (data.status.stage === 'retrying' || data.status.stage === 'failing-over') {
          showWarningToast(data.status.message)
        }
      }

      // Handle content chunks
      if (data.content) {
        fullContent += data.content
        if (!hasStartedStreaming) {
          setWaitingForResponse(false)
          setStreaming(true)
          hasStartedStreaming = true
        }
        scheduleStreamingContent(fullContent)
      }

      // Handle live reasoning ("thinking") — cumulative, so replace the buffer.
      // DISPLAY ONLY; the StreamingMessage renders it as a leading block when
      // the chat's thinking-visibility is on.
      if (typeof data.reasoning === 'string') {
        scheduleStreamingReasoning(data.reasoning)
      }

      // Handle errors
      if (data.error) {
        setResponseStatus(null)
        const errorMsg = data.details
          ? `${data.error}: ${data.details}`
          : data.error
        throw new SalonSendError(errorMsg, {
          userMessagePersisted: typeof data.userMessagePersisted === 'boolean' ? data.userMessagePersisted : undefined,
          pendingToolResultsPersisted: typeof data.pendingToolResultsPersisted === 'boolean' ? data.pendingToolResultsPersisted : undefined,
        })
      }

      // Handle tool detection. `fullContent` is the prose streamed so far —
      // the offset at which this batch was invoked.
      if (data.toolsDetected && opts.onToolsDetected) {
        opts.onToolsDetected(data, fullContent.length)
      }

      // Handle tool results
      if (data.toolResult && opts.onToolResult) {
        opts.onToolResult(data)
      }

      // Messages surfaced mid-turn — a Carina reference answer, a Host
      // announcement (turn-pass note), a Pascal custom-tool outcome — are
      // inserted into the flow immediately (deduped by id) rather than
      // waiting for the post-turn fetchChat().
      if (opts.onSurfacedMessage) {
        for (const surfaced of [data.carinaAnswer, data.hostAnnouncement, data.pascalResult]) {
          if (surfaced) opts.onSurfacedMessage(surfaced)
        }
      }

      // The raised hand has been answered. A yield speaks for itself (the
      // Host's note, then the floor); a decline is said here, or the hand
      // would simply go down with no word of why.
      if (data.handAnswered) {
        setHandRaised(false)
        if (!data.yielded) {
          showInfoToast(`${data.characterName || 'The speaker'} carried on regardless. Your hand is lowered.`)
        }
      }

      // Handle an answer-confirmation result — update the badge and, on a
      // revision, swap in the corrected bubble text (a deliberate, visible
      // transparency swap).
      if (data.confirmationResult && opts.onConfirmationResult) {
        opts.onConfirmationResult(data.confirmationResult)
      }

      // Handle completion
      if (data.done) {
        turnClosed = true
        setResponseStatus(null)

        // Attachments the provider plugin could not put on the wire (bug 94).
        const attachmentWarning = buildFailedAttachmentWarning(data.attachmentResults?.failed)
        if (attachmentWarning) showWarningToast(attachmentWarning)

        if (inChain && opts.onIntermediateDone) {
          // Intermediate done during a chain — lighter cleanup, no state reset
          await opts.onIntermediateDone(fullContent, data)
        } else {
          await opts.onDone(fullContent, data)
        }
      }

      // The Courier: server placed a placeholder for a manual / clipboard
      // turn. Refetch so the bubble appears with the Markdown blob + paste
      // textarea. The accompanying `done` event closes the stream.
      if (data.pendingExternalTurn) {
        await fetchChat()
      }

      // Handle turn start (chained character about to respond)
      // Server sends flat: { turnStart: true, participantId, characterName, chainDepth }
      if (data.turnStart) {
        // Only a chained turn (depth > 0) enters a chain. The server also
        // sends a depth-0 turnStart before every first turn so the bubble
        // shows the right responder; that one must leave the turn's `done`
        // on the ordinary end-of-turn path (bug 242).
        if ((data.chainDepth || 0) > 0) inChain = true
        turnClosed = false
        fullContent = ''
        hasStartedStreaming = false
        resetStreamingContent()
        setStreaming(false)
        setWaitingForResponse(true)
        if (data.participantId) {
          opts.onTurnStart?.({
            participantId: data.participantId,
            characterName: data.characterName || 'Unknown',
            chainDepth: data.chainDepth || 0,
          })
        }
      }

      // Handle turn complete (chained character finished)
      // Server sends flat: { turnComplete: true, participantId, messageId, chainDepth }
      if (data.turnComplete) {
        await opts.onTurnComplete?.({
          participantId: data.participantId!,
          messageId: data.messageId || '',
          chainDepth: data.chainDepth || 0,
        })
      }

      // Handle chain complete (all chained turns done)
      // Server sends flat: { chainComplete: true, reason, nextSpeakerId, chainDepth }
      if (data.chainComplete) {
        inChain = false
        turnClosed = true
        await opts.onChainComplete?.({
          reason: data.reason || 'no_next_speaker',
          nextSpeakerId: data.nextSpeakerId ?? null,
          chainDepth: data.chainDepth || 0,
          paused: data.paused === true,
          heldUserTurn: data.heldUserTurn === true,
        })
      }
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
      setResponseStatus(null)
      throw new StreamClosedEarlyError()
    }

    return fullContent
  }, [scheduleStreamingContent, scheduleStreamingReasoning, resetStreamingContent, fetchChat, surfaceMessage, setMessages])

  // Handle common error extraction
  const extractErrorMessage = useCallback((err: unknown): string => {
    if (err instanceof Error) {
      return err.message || err.name || 'Unknown error'
    } else if (typeof err === 'string') {
      return err
    } else if (err && typeof err === 'object') {
      const errObj = err as Record<string, unknown>
      if (typeof errObj.error === 'string') return errObj.error
      if (typeof errObj.message === 'string') return errObj.message
    }
    return 'Unknown error'
  }, [])

  /**
   * After a failed send, put back whatever of the submission the server never
   * saved (bug 241). Returns true when the typed text or attachments went back
   * into the composer.
   *
   * What was saved is taken from the error frame when it says; otherwise it is
   * read off the transcript as it stands after the post-error `fetchChat()` —
   * reconciliation retires a temp bubble the moment the read carries its row,
   * so one still standing has no row behind it. A composer the operator has
   * already started typing into again is left alone, so a restore never
   * clobbers new words.
   */
  const restoreUnpersistedSubmission = useCallback((args: {
    err: unknown
    input: string
    setInput: (v: string) => void
    attachedFiles: Array<{ id: string; filename: string; filepath: string; mimeType: string }>
    toolResultsToSend: PendingToolResult[]
    setPendingToolResults: (results: PendingToolResult[]) => void
    persistDraft?: (text: string) => void
    tempUserMessageId: string
    tempToolMessageIds: string[]
  }): boolean => {
    const { err, input, setInput, attachedFiles, toolResultsToSend, setPendingToolResults, persistDraft } = args

    // Peek at the live transcript. The page's setter resolves updaters against
    // its own ref synchronously, and handing back the same array is a no-op.
    let current: Message[] = []
    setMessages((prev) => {
      current = prev
      return prev
    })
    const stillShowing = (id: string) => current.some((m) => m.id === id)

    const said = err instanceof SalonSendError ? err : null
    const userRowMissing = said?.userMessagePersisted !== undefined
      ? !said.userMessagePersisted
      : stillShowing(args.tempUserMessageId)
    const toolRowsMissing = toolResultsToSend.length > 0 && (
      said?.pendingToolResultsPersisted !== undefined
        ? !said.pendingToolResultsPersisted
        : args.tempToolMessageIds.some(stillShowing)
    )

    if (!userRowMissing && !toolRowsMissing) return false

    const composerNow = inputRef.current?.getMarkdown() ?? ''
    if (composerNow.trim()) return false

    let restored = false
    if (userRowMissing) {
      if (input.trim()) {
        setInput(input)
        // The page's value → editor sync only fires on a change of value; push
        // the text in directly too, so the editor shows it whatever React batched.
        inputRef.current?.setMarkdown(input)
        persistDraft?.(input)
        restored = true
      }
      if (attachedFiles.length > 0) {
        setAttachedFiles(attachedFiles)
        restored = true
      }
    }
    if (toolRowsMissing) {
      setPendingToolResults(toolResultsToSend)
      restored = true
    }
    return restored
  }, [setMessages, setAttachedFiles, inputRef])

  /**
   * Main send message function. Creates the user message, sends request, and streams response.
   */
  const sendMessage = useCallback(async (
    // Null when the send is re-dispatched programmatically — the In Their Own
    // Words dialog already called `preventDefault` on the original submit. The
    // event is used for nothing else here.
    e: React.FormEvent | null,
    input: string,
    setInput: (v: string) => void,
    attachedFiles: Array<{ id: string; filename: string; filepath: string; mimeType: string }>,
    pendingToolResults: PendingToolResult[],
    setPendingToolResults: (results: PendingToolResult[]) => void,
    clearDraft: () => void,
    /**
     * Re-saves the composer draft when a failed send hands the text back, so
     * the restored words survive a reload exactly as they did before Send.
     */
    persistDraft?: (text: string) => void,
    /** `establishedFact`: post this line as established fact (Deus Ex Machina). */
    opts?: { establishedFact?: boolean },
  ) => {
    e?.preventDefault()
    const establishedFact = !!opts?.establishedFact
    // Two refusals, deliberately told apart (bug 136). An empty composer is
    // the operator's own doing and wants no answer; a send declined because a
    // turn is still in flight is a real request refused, and silence there is
    // indistinguishable from a send that broke. The text stays in the composer
    // either way.
    if (!input.trim() && attachedFiles.length === 0 && pendingToolResults.length === 0) return
    if (sending) {
      showInfoToast('One moment — the room is still speaking. Your remark waits in the composer.')
      return
    }

    const userMessage = input.trim()
    const fileIds = attachedFiles.map((f) => f.id)
    const messageAttachments: MessageAttachment[] = attachedFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      filepath: f.filepath,
      mimeType: f.mimeType,
    }))
    const toolResultsToSend = [...pendingToolResults]
    setInput('')
    clearDraft()
    setAttachedFiles([])
    setPendingToolResults([])
    setSending(true)
    setWaitingForResponse(true)
    setStreaming(false)
    resetStreamingContent()
    setStreamingToolBatches([])
    const firstCharParticipant = getFirstCharacterParticipant()
    // Track the current responding participant across chained turns (mutable for closures)
    let currentParticipantId = firstCharParticipant?.id || null
    setRespondingParticipantId(currentParticipantId)
    // Build display content with file indicators
    const displayContent = messageAttachments.length > 0
      ? `${userMessage}${userMessage ? '\n' : ''}[Attached: ${messageAttachments.map(f => f.filename).join(', ')}]`
      : userMessage

    // Add pending tool result messages to UI
    const toolMessages: Message[] = toolResultsToSend.map((result, index) => ({
      id: `temp-tool-${Date.now()}-${index}`,
      role: 'TOOL',
      content: JSON.stringify({
        tool: result.tool,
        initiatedBy: 'user',
        success: result.success,
        result: result.formattedResult,
        prompt: result.requestPrompt,
        arguments: result.arguments,
      }),
      createdAt: result.createdAt,
    }))

    const tempToolMessageIds = toolMessages.map((m) => m.id)
    const tempUserMessageId = `temp-user-${Date.now()}`
    // Attribute the optimistic bubble to the seat the *server* will resolve this
    // message onto — `findActiveUserParticipant`, which honours the impersonation
    // overlay and falls back to the owner user seat when the active-typing id is
    // not itself a user-driven seat. Using the bare `activeTypingParticipantId`
    // here diverged from the persisted row and made the bubble flicker to the
    // wrong author on refetch (Bug 45).
    const optimisticAuthor = findActiveUserParticipant(
      participantsAsBaseRef.current,
      activeTypingParticipantIdRef.current,
      impersonatingParticipantIdsRef.current,
    )
    const tempUserMessage: Message = {
      id: tempUserMessageId,
      role: 'USER',
      content: displayContent,
      createdAt: new Date().toISOString(),
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
      // Renders with the chosen character's name/avatar immediately (not the
      // default user), matching what the server persists.
      participantId: optimisticAuthor?.id ?? activeTypingParticipantIdRef.current ?? undefined,
      // The ribbon shows at once, before the server's row replaces this one.
      ...(establishedFact ? { isEstablishedFact: true } : {}),
    }
    setMessages((prev) => [...prev, ...toolMessages, tempUserMessage])
    scrollOnUserMessage()

    const requestPayload = {
      content: userMessage || (attachedFiles.length > 0 ? 'Please look at the attached file(s).' : ''),
      fileIds,
      speakingAsParticipantId: activeTypingParticipantIdRef.current ?? undefined,
      ...(establishedFact ? { isEstablishedFact: true } : {}),
      pendingToolResults: toolResultsToSend.length > 0 ? toolResultsToSend.map(r => ({
        tool: r.tool,
        success: r.success,
        result: r.formattedResult,
        prompt: r.requestPrompt,
        arguments: r.arguments,
        createdAt: r.createdAt,
      })) : undefined,
    }

    try {
      abortControllerRef.current = new AbortController()
      const { signal } = abortControllerRef.current

      const res = await fetch(`/api/v1/messages?chatId=${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal,
      })

      if (!res.ok) {
        let errorMessage = 'Failed to send message'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorData.message || errorMessage
        } catch {
          errorMessage = res.statusText || errorMessage
        }
        // Refused before any stream opened: the orchestrator never ran, so
        // nothing of this submission was written.
        throw new SalonSendError(errorMessage, { userMessagePersisted: false, pendingToolResultsPersisted: false })
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      await readSSEStream(reader, {
        participantId: firstCharParticipant?.id || null,
        onToolsDetected: trackToolsDetected,
        onToolResult: trackToolResult,
        onSurfacedMessage: surfaceMessage,
        onConfirmationResult: applyConfirmationResult,
        onDone: async (fullContent, data) => {
          if (data.skipped || data.stopped) {
            finishSkippedTurn()
            return
          }

          if (data.emptyResponse) {
            showErrorToast(data.emptyResponseReason || 'The AI returned an empty response. Use the Resend button to try again.')
            resetStreamingContent()
            setStreaming(false)
            setWaitingForResponse(false)
            setSending(false)
            setRespondingParticipantId(null)
            return
          }

          // The Courier: the server parked a placeholder for a manual /
          // clipboard turn and already pushed an SSE pendingExternalTurn that
          // triggered fetchChat. The placeholder is now in the messages list
          // via that refresh — pushing another optimistic copy here would
          // create a duplicate React key.
          if (data.pendingExternalTurn) {
            resetStreamingContent()
            setStreaming(false)
            setWaitingForResponse(false)
            setRespondingParticipantId(null)
            scrollOnStreamComplete()
            await fetchChat()
            return
          }

          // Use server-provided participantId if available (authoritative)
          const resolvedParticipantId = data.participantId || currentParticipantId

          const assistantMessage: Message = {
            id: data.messageId!,
            role: 'ASSISTANT',
            content: fullContent,
            createdAt: new Date().toISOString(),
            participantId: resolvedParticipantId,
            provider: data.provider || null,
            modelName: data.modelName || null,
            routeTrail: data.routeTrail ?? null,
            isSilentMessage: data.isSilentMessage || undefined,
            reasoningContent: data.reasoningContent ?? null,
            reasoningSegments: data.reasoningSegments ?? null,
          }
          setMessages((prev) => [...prev, assistantMessage])
          resetStreamingContent()
          // Live tool batches are spent — the refetched message carries the
          // persisted, interspersed copy. Clearing now also avoids a stale
          // flash on the next turn's bubble.
          setStreamingToolBatches([])
          setStreaming(false)
          setWaitingForResponse(false)
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          notifyQueueChange()
          // A settled notice is already counting itself down; only a 'pending'
          // one that never got a result needs clearing at the turn boundary.
          clearPendingToolExecutionStatus()
        },
        onIntermediateDone: async (fullContent, data) => {
          // Intermediate done during a chain — add temp message but don't reset state
          if (data.skipped || data.stopped) {
            finishSkippedTurn()
            return
          }
          if (data.emptyResponse || !fullContent) return

          // Use server-provided participantId if available (authoritative)
          const resolvedParticipantId = data.participantId || currentParticipantId

          const assistantMessage: Message = {
            id: data.messageId!,
            role: 'ASSISTANT',
            content: fullContent,
            createdAt: new Date().toISOString(),
            participantId: resolvedParticipantId,
            provider: data.provider || null,
            modelName: data.modelName || null,
            routeTrail: data.routeTrail ?? null,
            isSilentMessage: data.isSilentMessage || undefined,
            reasoningContent: data.reasoningContent ?? null,
            reasoningSegments: data.reasoningSegments ?? null,
          }
          setMessages((prev) => [...prev, assistantMessage])
          resetStreamingContent()
          setStreaming(false)
        },
        onTurnStart: (event) => {
          currentParticipantId = event.participantId
          setRespondingParticipantId(event.participantId)
          resetStreamingContent()
          setStreamingToolBatches([])
          setWaitingForResponse(true)
          setStreaming(false)
        },
        onTurnComplete: async (event) => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          await fetchChat()
        },
        onChainComplete: async (event) => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          announceChainPause(event)
          notifyQueueChange()
          focusInput()
        },
      })
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'

      if (isAbort) {
        resetStreamingContent()
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
        setResponseStatus(null)
      } else {
        const errorMessage = extractErrorMessage(err)
        const displayMessage = errorMessage === 'Unknown error' || errorMessage === 'TypeError'
          ? 'Connection lost. Please try again.'
          : errorMessage

        // The failure may have come before or after the server saved the
        // user's message. Re-fetch so a persisted row replaces the temp
        // bubble; one that never landed is swept in `finally`.
        resetStreamingContent()
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
        setResponseStatus(null)
        await fetchChat()

        // Bug 241: a send that died before its row was written used to take
        // the operator's words with it — composer, draft and attachments were
        // all cleared up front and nothing put them back. Hand back whatever
        // has no row behind it. The error frame says so outright; when it
        // can't (a dropped connection, an older server) the read above
        // answers instead: a temp bubble still standing after it was not
        // reconciled to any persisted row.
        const restored = restoreUnpersistedSubmission({
          err,
          input,
          setInput,
          attachedFiles,
          toolResultsToSend,
          setPendingToolResults,
          persistDraft,
          tempUserMessageId,
          tempToolMessageIds,
        })

        const toastMessage = displayMessage || 'Failed to send message'
        showErrorToast(
          sendFailureToastText(toastMessage, restored),
          SEND_FAILURE_TOAST_MS,
        )
      }
    } finally {
      setSending(false)
      setWaitingForResponse(false)
      abortControllerRef.current = null
      setResponseStatus(null)
      // The stream is over: any hand still up has nobody left to ask, and a
      // stop has finished putting the reply away.
      setHandRaised(false)
      stoppingRef.current = false
      setStopping(false)
      // The turn is over, so every optimistic bubble has had its chance: the
      // reads above retire the ones the server persisted, and anything still
      // standing belongs to a send that never landed at all.
      clearProvisionalMessages()
      focusInput()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onToolResultCallback is a stable page-level callback
  }, [chatId, sending, chat, respondingParticipantId, setMessages, clearProvisionalMessages, scrollOnUserMessage, scrollOnStreamComplete, fetchChat, setAttachedFiles, setRespondingParticipantId, getFirstCharacterParticipant, readSSEStream, extractErrorMessage, restoreUnpersistedSubmission, focusInput, resetStreamingContent, surfaceMessage, finishSkippedTurn, announceChainPause, trackToolsDetected, trackToolResult, applyConfirmationResult, clearPendingToolExecutionStatus])

  /**
   * Trigger continue mode - request AI to generate a response from a specific participant.
   *
   * Deliberately works while the chat is paused: every caller is an explicit
   * summons by the human (Nudge, Skip, the all-LLM modal's Continue), and a
   * paused room grants exactly one turn for each. The pause is not lifted to
   * do it — the server declines to chain past the summoned turn for as long as
   * `isPaused` stands — so the room falls quiet again straight afterwards.
   */
  const triggerContinueMode = useCallback(async (participantId: string, nudge = false) => {
    if (streaming || waitingForResponse) {
      showInfoToast('One moment — the room is still speaking.')
      return
    }

    const participant = participantsAsBase.find(p => p.id === participantId && p.isActive)
    if (!participant) {
      showErrorToast('This participant is no longer available in the chat.')
      return
    }

    if (!hasActiveCharacters) {
      showErrorToast('No characters available. Add a character to continue the conversation.')
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setWaitingForResponse(true)
    setStreaming(false)
    resetStreamingContent()
    setStreamingToolBatches([])
    // Track the current responding participant across chained turns (mutable for closures)
    let currentParticipantId = participantId
    setRespondingParticipantId(participantId)

    try {
      abortControllerRef.current = new AbortController()
      const { signal } = abortControllerRef.current

      const res = await fetch(`/api/v1/messages?chatId=${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          continueMode: true,
          respondingParticipantId: participantId,
          speakingAsParticipantId: activeTypingParticipantIdRef.current ?? undefined,
          // Nudge (explicit summon) withholds the "nothing to add" skip option;
          // the algorithm-picked Continue button leaves it undefined so skip is offered.
          nudge: nudge || undefined,
        }),
        signal,
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to trigger response')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      await readSSEStream(reader, {
        participantId,
        onToolsDetected: trackToolsDetected,
        onToolResult: trackToolResult,
        onSurfacedMessage: surfaceMessage,
        onConfirmationResult: applyConfirmationResult,
        onDone: (fullContent, data) => {
          setResponseStatus(null)
          clearPendingToolExecutionStatus()

          if (data.skipped || data.stopped) {
            finishSkippedTurn()
            return
          }

          if (fullContent.trim()) {
            // Use server-provided participantId if available (authoritative)
            const resolvedParticipantId = data.participantId || currentParticipantId

            const newMessage: Message = {
              id: data.messageId || `continue-${Date.now()}`,
              role: 'ASSISTANT',
              content: fullContent,
              createdAt: new Date().toISOString(),
              participantId: resolvedParticipantId,
              provider: data.provider || null,
              modelName: data.modelName || null,
              routeTrail: data.routeTrail ?? null,
              isSilentMessage: data.isSilentMessage || undefined,
              reasoningContent: data.reasoningContent ?? null,
              reasoningSegments: data.reasoningSegments ?? null,
            }
            setMessages(prev => [...prev, newMessage])
          }
        },
        onIntermediateDone: async (fullContent, data) => {
          // Intermediate done during a chain — add temp message but don't reset state
          if (data.skipped || data.stopped) {
            finishSkippedTurn()
            return
          }
          if (!fullContent.trim()) return

          // Use server-provided participantId if available (authoritative)
          const resolvedParticipantId = data.participantId || currentParticipantId

          const newMessage: Message = {
            id: data.messageId || `continue-chain-${Date.now()}`,
            role: 'ASSISTANT',
            content: fullContent,
            createdAt: new Date().toISOString(),
            participantId: resolvedParticipantId,
            provider: data.provider || null,
            modelName: data.modelName || null,
            routeTrail: data.routeTrail ?? null,
            reasoningContent: data.reasoningContent ?? null,
            reasoningSegments: data.reasoningSegments ?? null,
          }
          setMessages(prev => [...prev, newMessage])
        },
        onTurnStart: (event) => {
          currentParticipantId = event.participantId
          setRespondingParticipantId(event.participantId)
          resetStreamingContent()
          setStreamingToolBatches([])
          setWaitingForResponse(true)
          setStreaming(false)
        },
        onTurnComplete: async (event) => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          await fetchChat()
        },
        onChainComplete: async (event) => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          announceChainPause(event)
          notifyQueueChange()
          focusInput()
        },
      })
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (!isAbort) {
        const errorMessage = extractErrorMessage(err)
        showErrorToast(errorMessage)
      }
    } finally {
      setStreaming(false)
      setWaitingForResponse(false)
      resetStreamingContent()
      setRespondingParticipantId(null)
      setResponseStatus(null)
      abortControllerRef.current = null
      setHandRaised(false)
      stoppingRef.current = false
      setStopping(false)
      scrollOnStreamComplete()
      // Re-fetch chat to pick up side-channel messages (e.g. whisper tool writes)
      await fetchChat()
      notifyQueueChange()
      focusInput()
    }
  }, [chatId, streaming, waitingForResponse, participantsAsBase, hasActiveCharacters, setMessages, scrollOnStreamComplete, setRespondingParticipantId, readSSEStream, extractErrorMessage, focusInput, fetchChat, resetStreamingContent, surfaceMessage, finishSkippedTurn, announceChainPause, trackToolsDetected, trackToolResult, applyConfirmationResult, clearPendingToolExecutionStatus])

  /**
   * Storyteller: run the operator's selection for an open round. The stream
   * speaks the chain dialect (turnStart / done / turnComplete, then one
   * chainComplete), so this reads it as a continue-mode chain does; "all at
   * once" turns arrive tagged `concurrent` and fill their own bubbles.
   */
  const runStorytellerSelection = useCallback(async (
    roundId: string,
    participantIds: string[],
    order: StorytellerOrder,
    keepOrder = false,
  ): Promise<boolean> => {
    if (streaming || waitingForResponse) {
      showInfoToast('One moment — the room is still speaking.')
      return false
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setWaitingForResponse(true)
    setStreaming(false)
    resetStreamingContent()
    setStreamingToolBatches([])
    setConcurrentStreams([])
    let currentParticipantId: string | null = null

    const pushReply = (fullContent: string, data: SSEEvent) => {
      if (data.skipped || data.stopped) {
        finishSkippedTurn()
        return
      }
      if (!fullContent.trim()) return
      const resolvedParticipantId = data.participantId || currentParticipantId
      setMessages(prev => [...prev, {
        id: data.messageId || `storyteller-${Date.now()}`,
        role: 'ASSISTANT',
        content: fullContent,
        createdAt: new Date().toISOString(),
        participantId: resolvedParticipantId,
        provider: data.provider || null,
        modelName: data.modelName || null,
        routeTrail: data.routeTrail ?? null,
        isSilentMessage: data.isSilentMessage || undefined,
        reasoningContent: data.reasoningContent ?? null,
        reasoningSegments: data.reasoningSegments ?? null,
      }])
    }

    try {
      abortControllerRef.current = new AbortController()
      const { signal } = abortControllerRef.current
      const res = await fetch(`/api/v1/chats/${chatId}?action=storyteller-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, participantIds, order, keepOrder }),
        signal,
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'The storyteller could not run that selection')
      }
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      await readSSEStream(reader, {
        participantId: null,
        onToolsDetected: trackToolsDetected,
        onToolResult: trackToolResult,
        onSurfacedMessage: surfaceMessage,
        onConfirmationResult: applyConfirmationResult,
        onDone: (fullContent, data) => {
          setResponseStatus(null)
          clearPendingToolExecutionStatus()
          pushReply(fullContent, data)
        },
        onIntermediateDone: (fullContent, data) => pushReply(fullContent, data),
        onTurnStart: (event) => {
          currentParticipantId = event.participantId
          setRespondingParticipantId(event.participantId)
          resetStreamingContent()
          setStreamingToolBatches([])
          setWaitingForResponse(true)
          setStreaming(false)
        },
        onTurnComplete: async () => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          await fetchChat()
        },
        onChainComplete: async (event) => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          setConcurrentStreams([])
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          announceChainPause(event)
          focusInput()
        },
      })
      return true
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (!isAbort) showErrorToast(extractErrorMessage(err))
      return false
    } finally {
      setStreaming(false)
      setWaitingForResponse(false)
      resetStreamingContent()
      setConcurrentStreams([])
      setRespondingParticipantId(null)
      setResponseStatus(null)
      abortControllerRef.current = null
      setHandRaised(false)
      stoppingRef.current = false
      setStopping(false)
      scrollOnStreamComplete()
      await fetchChat()
      notifyQueueChange()
      focusInput()
    }
  }, [chatId, streaming, waitingForResponse, setMessages, scrollOnStreamComplete, setRespondingParticipantId, readSSEStream, extractErrorMessage, focusInput, fetchChat, resetStreamingContent, surfaceMessage, finishSkippedTurn, announceChainPause, trackToolsDetected, trackToolResult, applyConfirmationResult, clearPendingToolExecutionStatus])

  /**
   * Abandon the local stream outright — the old Stop, now only the fallback
   * for when the server cannot be told (an old server, a dropped request) or
   * its stream never closes after it was.
   */
  const abandonLocalStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStreaming(false)
    setWaitingForResponse(false)
    setSending(false)
    setRespondingParticipantId(null)
    setStreamingToolBatches([])
    dismissToolExecutionStatus()
    resetStreamingContent()
    stoppingRef.current = false
    setStopping(false)
  }, [setRespondingParticipantId, resetStreamingContent, dismissToolExecutionStatus])

  /**
   * Hard stop. The server pauses a room with a rotation, abandons the provider
   * stream, keeps the prose that had streamed as the character's reply (tools
   * already run stay run, the thinking goes), and closes the stream — whose
   * own done / chainComplete events then settle this side as on any turn.
   */
  const stopStreaming = useCallback(async () => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    setHandRaised(false)
    // Reflect the pause at once; the server writes it before it aborts, so
    // the chain's next decision already reads it.
    if (isMultiChar) {
      void setPauseState(true)
    }

    let serverStopped = false
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=stop-turn`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json() as { stopped?: number; settled?: boolean }
        serverStopped = (data.stopped ?? 0) > 0
      }
    } catch (err) {
      console.error('[Salon] Stop request failed; abandoning the stream locally', getErrorMessage(err))
    }

    if (!serverStopped) {
      abandonLocalStream()
      await fetchChat()
    } else {
      // The server has put the reply away and closed its stream; give the
      // reader a moment to drain the closing events before letting go.
      window.setTimeout(() => {
        if (stoppingRef.current && abortControllerRef.current) {
          abandonLocalStream()
          void fetchChat()
        }
      }, 3000)
    }
    showInfoToast(isMultiChar ? 'Stopped. The floor is yours, and the room is paused.' : 'Stopped. The floor is yours.')
  }, [chatId, isMultiChar, setPauseState, abandonLocalStream, fetchChat])

  /**
   * Soft interrupt: raise (or lower) the operator's hand. The next character
   * built to speak is asked whether to yield; the answer arrives as a
   * `handAnswered` event, and the stream's end lowers any hand left up.
   */
  const toggleRaisedHand = useCallback(async () => {
    const raise = !handRaised
    setHandRaised(raise)
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=raise-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raised: raise }),
      })
      if (!res.ok) throw new Error(res.statusText || 'Request failed')
      const data = await res.json() as { raised?: boolean; active?: boolean }
      setHandRaised(data.raised === true)
      if (raise && data.active === false) {
        showInfoToast('Nobody is speaking just now. The floor is already yours.')
      }
    } catch (err) {
      setHandRaised(false)
      showErrorToast(`Could not raise your hand: ${getErrorMessage(err)}`)
    }
  }, [chatId, handRaised])

  return {
    sending,
    streaming,
    streamingContent,
    streamingReasoning,
    waitingForResponse,
    streamingToolBatches,
    toolExecutionStatus,
    dismissToolExecutionStatus,
    responseStatus,
    abortControllerRef,
    sendMessage,
    triggerContinueMode,
    runStorytellerSelection,
    concurrentStreams,
    stopStreaming,
    handRaised,
    toggleRaisedHand,
    stopping,
  }
}
