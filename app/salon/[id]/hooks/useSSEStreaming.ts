'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { showErrorToast, showInfoToast, showWarningToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { ChatParticipantBase } from '@/lib/schemas/types'
import { findActiveUserParticipant, isAllLLMChat } from '@/lib/chat/turn-manager'
import type { Message, MessageAttachment, Chat, PendingToolResult } from '../types'
import type { ComposerEditorHandle } from '@/components/chat/lexical/types'
import { useToolExecutionStatus } from './useToolExecutionStatus'
import { useStreamingBuffers } from './useStreamingBuffers'
import { useStreamingToolBatches } from './useStreamingToolBatches'
import { readGreenRoomFrames, readTurnStream, type TurnStreamCallbacks } from './read-turn-stream'
import type { StorytellerOrder } from '@/lib/schemas/storyteller.types'
import { doneLeavesNoReply, type DoneFrame, type GreenRoomEvent, type ResponseStatus } from '@/lib/chat/stream-frames'
import {
  appendMessageOnce,
  assistantMessageFromDone,
  isHandUp,
  SalonSendError,
  SEND_FAILURE_TOAST_MS,
  sendFailureToastText,
  settleHandAtStreamEnd,
  type ConcurrentStream,
  type RaisedHandStatus,
  type StorytellerStreamEvent,
} from './stream-helpers'

// The pure helpers and shared types moved to `stream-helpers.ts`; re-exported
// here because this hook's consumers (and their tests) import them from it.
export * from './stream-helpers'
// The tool-execution notice owns its own lifetime (bug 77).
export type { ToolExecutionStatus } from './useToolExecutionStatus'

/**
 * The four kinds of turn stream the Salon opens. Each is a request builder
 * over one `runTurnStream`, which owns the abort controller, the in-flight
 * claim, the shared frame handlers and the `finally`.
 */
export type StreamKind = 'send' | 'open' | 'continue' | 'storyteller'

/** The responder of the turn a stream is carrying, updated on each `turnStart`. */
interface TurnCursor {
  participantId: string | null
}

/** The "the room is still speaking" refusals (bug 136, #172). */
const STILL_SPEAKING = 'One moment — the room is still speaking.'
const STILL_SPEAKING_KEEP_TEXT = 'One moment — the room is still speaking. Your remark waits in the composer.'

/** The refusal message of a non-2xx turn request, or `fallback`. */
async function refusalMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({})) as { error?: unknown }
  return typeof data.error === 'string' && data.error ? data.error : fallback
}

interface RunTurnStreamOptions {
  kind: StreamKind
  /** Toast shown when another stream holds the floor; silent when absent. */
  refusal?: string
  /** First responder, before the stream's own `turnStart` says otherwise. */
  participantId?: string | null
  /**
   * Runs once the claim is held, before the request. Returning `false`
   * declines the run (the claim is released and nothing is fetched).
   */
  before?: () => boolean | void
  /** Open the stream. Throw to refuse (a non-2xx answer). */
  request: (signal: AbortSignal) => Promise<Response>
  /** The kind's own handlers, laid over the shared ones. `onDone` is required. */
  handlers: (turn: TurnCursor) => Partial<TurnStreamCallbacks> & Pick<TurnStreamCallbacks, 'onDone'>
  /** A non-abort failure. Defaults to a toast of the error's message. */
  onError?: (err: unknown) => void | Promise<void>
  /** The kind's own clean-up, after the shared `finally`. */
  after?: () => void | Promise<void>
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
  /** The Green Room narrating a chat's opening or a watched join (`greenRoom` frames). */
  onGreenRoom?: (event: GreenRoomEvent) => void
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
  setMessages,
  isMultiChar,
  hasActiveCharacters,
  participantsAsBase,
  isPaused,
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
  onToolResult,
  onStorytellerEvent,
  onGreenRoom,
}: UseSSEStreamingParams) {
  const onGreenRoomRef = useRef(onGreenRoom)
  useEffect(() => {
    onGreenRoomRef.current = onGreenRoom
  }, [onGreenRoom])
  const onStorytellerEventRef = useRef(onStorytellerEvent)
  useEffect(() => {
    onStorytellerEventRef.current = onStorytellerEvent
  }, [onStorytellerEvent])
  // Storyteller: live bubbles for concurrent turns, keyed by participant.
  const [concurrentStreams, setConcurrentStreams] = useState<ConcurrentStream[]>([])
  const [streaming, setStreaming] = useState(false)
  const [waitingForResponse, setWaitingForResponse] = useState(false)
  const [responseStatus, setResponseStatus] = useState<ResponseStatus | null>(null)
  // The operator's interrupts (lib/chat/turn-control.ts on the server): a
  // raised hand waiting for the next speaker's answer, and a hard stop the
  // server is still putting away.
  const [handStatus, setHandStatus] = useState<RaisedHandStatus | null>(null)
  const handRaised = isHandUp(handStatus)
  const [stopping, setStopping] = useState(false)
  const stoppingRef = useRef(false)
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
  const {
    streamingContent,
    streamingReasoning,
    scheduleStreamingContent,
    scheduleStreamingReasoning,
    resetStreamingContent,
  } = useStreamingBuffers()
  const {
    streamingToolBatches,
    trackToolsDetected,
    trackToolResult,
    clearStreamingToolBatches,
  } = useStreamingToolBatches({ publishToolExecutionStatus, onToolResult })

  // --- The one in-flight stream -------------------------------------------
  // Only `runTurnStream` assigns the controller (Stop's local abandon clears
  // it). #172: one claim for "a stream is in flight", whichever kind opened
  // it. The ref holds the owner's token and answers the guards synchronously,
  // so a stream abandoned by Stop cannot, in its late `finally`, release a
  // stream started after it; the state re-renders the composer.
  const abortControllerRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef<symbol | null>(null)
  const [streamKind, setStreamKind] = useState<StreamKind | null>(null)
  const isStreamInFlight = streamKind !== null
  // A user send holds the composer shut; the other kinds leave it open for
  // typing ahead (Enter is refused by the composer instead).
  const sending = streamKind === 'send'

  const releaseStream = useCallback((token?: symbol) => {
    if (token && inFlightRef.current !== token) return
    inFlightRef.current = null
    setStreamKind(null)
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

  // Turns mode: the first round to close in a visit says why the room went
  // quiet and how to carry on; later rounds close without a word.
  const roundCloseAnnouncedRef = useRef(false)

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
    if (event.reason === 'turn_complete') {
      if (roundCloseAnnouncedRef.current) return
      roundCloseAnnouncedRef.current = true
      showInfoToast('The round is complete — everyone has had their say. Post a line, or press Next Round in the sidebar.')
      return
    }
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

  // Focus input after response completes
  const focusInput = useCallback(() => {
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true })
    }, 150)
  }, [inputRef])

  /** The live bubble's display state, back to "nobody is speaking". */
  const resetLiveTurn = useCallback(() => {
    resetStreamingContent()
    setStreaming(false)
    setWaitingForResponse(false)
  }, [resetStreamingContent])

  /**
   * The one `finally` every turn stream shares: the live bubble, the
   * responder and the status line go; any hand still up has nobody left to
   * ask; a stop has finished putting the reply away; the claim is released;
   * then the kind's own clean-up runs.
   */
  const settleStream = useCallback(async (token: symbol, after?: () => void | Promise<void>) => {
    resetLiveTurn()
    setRespondingParticipantId(null)
    setResponseStatus(null)
    setHandStatus(settleHandAtStreamEnd)
    stoppingRef.current = false
    setStopping(false)
    releaseStream(token)
    await after?.()
    focusInput()
  }, [resetLiveTurn, setRespondingParticipantId, releaseStream, focusInput])

  /**
   * Run one turn stream. Refuses (returning `false`, with `refusal` as a toast
   * when given) while another stream is in flight; otherwise claims the floor,
   * creates the one abort controller, reads the stream with the shared frame
   * handlers under the kind's own, and settles everything in one `finally`.
   * Resolves `true` when the stream ran to its end.
   */
  const runTurnStream = useCallback(async ({
    kind,
    refusal,
    participantId = null,
    before,
    request,
    handlers,
    onError,
    after,
  }: RunTurnStreamOptions): Promise<boolean> => {
    if (inFlightRef.current) {
      if (refusal) showInfoToast(refusal)
      return false
    }
    const token = Symbol(kind)
    inFlightRef.current = token
    setStreamKind(kind)
    if (before?.() === false) {
      releaseStream(token)
      return false
    }

    setWaitingForResponse(true)
    setStreaming(false)
    resetStreamingContent()
    clearStreamingToolBatches()
    const turn: TurnCursor = { participantId }
    setRespondingParticipantId(participantId)

    const controller = new AbortController()
    abortControllerRef.current = controller
    try {
      const res = await request(controller.signal)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      await readTurnStream(reader, {
        // Where the reader writes.
        setResponseStatus,
        setWaitingForResponse,
        setStreaming,
        scheduleStreamingContent,
        scheduleStreamingReasoning,
        resetStreamingContent,
        setHandStatus,
        setConcurrentStreams,
        setMessages,
        surfaceMessage,
        fetchChat,
        onStorytellerEvent: (event) => onStorytellerEventRef.current?.(event),
        onGreenRoom: (event) => onGreenRoomRef.current?.(event),
        // What every kind shares.
        onToolsDetected: trackToolsDetected,
        onToolResult: trackToolResult,
        onSurfacedMessage: surfaceMessage,
        onConfirmationResult: applyConfirmationResult,
        onTurnStart: (event) => {
          turn.participantId = event.participantId
          setRespondingParticipantId(event.participantId)
          resetStreamingContent()
          clearStreamingToolBatches()
          setWaitingForResponse(true)
          setStreaming(false)
        },
        onTurnComplete: async () => {
          resetLiveTurn()
          await fetchChat()
        },
        onChainComplete: async (event) => {
          resetLiveTurn()
          if (kind === 'storyteller') setConcurrentStreams([])
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          if (kind !== 'open') {
            announceChainPause(event)
            notifyQueueChange()
          }
          focusInput()
        },
        // The kind's own, over the shared.
        ...handlers(turn),
      })
      return true
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (!isAbort) {
        if (onError) await onError(err)
        else showErrorToast(extractErrorMessage(err))
      }
      return false
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      // Stop abandoned this stream and another has the floor since: its
      // display state, its hand and its optimistic bubbles are not ours.
      const superseded = inFlightRef.current !== null && inFlightRef.current !== token
      if (!superseded) await settleStream(token, after)
    }
  }, [releaseStream, resetStreamingContent, clearStreamingToolBatches, setRespondingParticipantId, scheduleStreamingContent, scheduleStreamingReasoning, setMessages, surfaceMessage, fetchChat, trackToolsDetected, trackToolResult, applyConfirmationResult, resetLiveTurn, scrollOnStreamComplete, announceChainPause, focusInput, extractErrorMessage, settleStream])

  /**
   * The optimistic bubble for a non-send kind's `done`: nothing for a
   * turn-pass or an empty reply, otherwise the reply under a placeholder id
   * (`<prefix>-<now>`) the post-turn read replaces.
   */
  const pushReply = useCallback((turn: TurnCursor, fullContent: string, data: DoneFrame, idPrefix: string) => {
    if (doneLeavesNoReply(data.outcome)) {
      finishSkippedTurn()
      return
    }
    if (!fullContent.trim()) return
    setMessages(prev => [...prev, assistantMessageFromDone(data, fullContent, {
      participantId: turn.participantId,
      id: `${idPrefix}-${Date.now()}`,
    })])
  }, [finishSkippedTurn, setMessages])

  /** A non-send kind's final `done`: the status line goes, then the reply. */
  const settleFinalDone = useCallback((turn: TurnCursor, fullContent: string, data: DoneFrame, idPrefix: string) => {
    setResponseStatus(null)
    clearPendingToolExecutionStatus()
    pushReply(turn, fullContent, data, idPrefix)
  }, [clearPendingToolExecutionStatus, pushReply])

  /** After a continue or storyteller run: pick up side-channel writes (e.g. whisper tools). */
  const refreshAfterRun = useCallback(async () => {
    scrollOnStreamComplete()
    await fetchChat()
    notifyQueueChange()
  }, [scrollOnStreamComplete, fetchChat])

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
    // turn is still in flight — any kind of turn (#172) — is a real request
    // refused, and silence there is indistinguishable from a send that broke.
    // The text stays in the composer either way.
    if (!input.trim() && attachedFiles.length === 0 && pendingToolResults.length === 0) return

    const userMessage = input.trim()
    const fileIds = attachedFiles.map((f) => f.id)
    const messageAttachments: MessageAttachment[] = attachedFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      filepath: f.filepath,
      mimeType: f.mimeType,
    }))
    const toolResultsToSend = [...pendingToolResults]
    // Build display content with file indicators
    const displayContent = messageAttachments.length > 0
      ? `${userMessage}${userMessage ? '\n' : ''}[Attached: ${messageAttachments.map(f => f.filename).join(', ')}]`
      : userMessage

    // Pending tool result messages, shown at once
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

    await runTurnStream({
      kind: 'send',
      refusal: STILL_SPEAKING_KEEP_TEXT,
      participantId: getFirstCharacterParticipant()?.id || null,
      before: () => {
        // The operator has the floor now; the last hand's outcome is spent.
        setHandStatus(null)
        setInput('')
        clearDraft()
        setAttachedFiles([])
        setPendingToolResults([])
        // Attribute the optimistic bubble to the seat the *server* will resolve
        // this message onto — `findActiveUserParticipant`, which honours the
        // impersonation overlay and falls back to the owner user seat when the
        // active-typing id is not itself a user-driven seat. Using the bare
        // `activeTypingParticipantId` here diverged from the persisted row and
        // made the bubble flicker to the wrong author on refetch (Bug 45).
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
      },
      request: async (signal) => {
        const res = await fetch(`/api/v1/messages?chatId=${chatId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          }),
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
        return res
      },
      handlers: (turn) => ({
        onDone: async (fullContent, data) => {
          if (doneLeavesNoReply(data.outcome)) {
            finishSkippedTurn()
            return
          }

          if (data.outcome === 'empty') {
            showErrorToast(data.emptyResponseReason || 'The AI returned an empty response. Use the Resend button to try again.')
            resetLiveTurn()
            setRespondingParticipantId(null)
            return
          }

          // The Courier: the server parked a placeholder for a manual /
          // clipboard turn and already pushed an SSE pendingExternalTurn that
          // triggered fetchChat. The placeholder is now in the messages list
          // via that refresh — pushing another optimistic copy here would
          // create a duplicate React key.
          if (data.pendingExternalTurn) {
            resetLiveTurn()
            setRespondingParticipantId(null)
            scrollOnStreamComplete()
            await fetchChat()
            return
          }

          const assistantMessage = assistantMessageFromDone(data, fullContent, { participantId: turn.participantId })
          setMessages((prev) => [...prev, assistantMessage])
          resetStreamingContent()
          // Live tool batches are spent — the refetched message carries the
          // persisted, interspersed copy. Clearing now also avoids a stale
          // flash on the next turn's bubble.
          clearStreamingToolBatches()
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
          if (doneLeavesNoReply(data.outcome)) {
            finishSkippedTurn()
            return
          }
          if (data.outcome === 'empty' || !fullContent) return

          const assistantMessage = assistantMessageFromDone(data, fullContent, { participantId: turn.participantId })
          setMessages((prev) => [...prev, assistantMessage])
          resetStreamingContent()
          setStreaming(false)
        },
      }),
      onError: async (err) => {
        const errorMessage = extractErrorMessage(err)
        const displayMessage = errorMessage === 'Unknown error' || errorMessage === 'TypeError'
          ? 'Connection lost. Please try again.'
          : errorMessage

        // The failure may have come before or after the server saved the
        // user's message. Re-fetch so a persisted row replaces the temp
        // bubble; one that never landed is swept in `after`.
        resetLiveTurn()
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

        showErrorToast(
          sendFailureToastText(displayMessage || 'Failed to send message', restored),
          SEND_FAILURE_TOAST_MS,
        )
      },
      // The turn is over, so every optimistic bubble has had its chance: the
      // reads above retire the ones the server persisted, and anything still
      // standing belongs to a send that never landed at all.
      after: clearProvisionalMessages,
    })
  }, [chatId, runTurnStream, setMessages, clearProvisionalMessages, scrollOnUserMessage, scrollOnStreamComplete, fetchChat, setAttachedFiles, setRespondingParticipantId, getFirstCharacterParticipant, extractErrorMessage, restoreUnpersistedSubmission, resetStreamingContent, resetLiveTurn, clearStreamingToolBatches, finishSkippedTurn, clearPendingToolExecutionStatus])

  /**
   * Open a chat that was cast but not yet opened: the server runs the opening
   * on this stream — the Green Room's `greenRoom` frames, then (for a Salon
   * chat) the greeting as an ordinary turn, which streams like any other. The
   * Salon's Stop reaches it; a chat already opened answers with an empty,
   * closed stream.
   */
  const openChat = useCallback(async () => {
    await runTurnStream({
      kind: 'open',
      request: async (signal) => {
        const res = await fetch(`/api/v1/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            continueMode: true,
            opening: true,
            speakingAsParticipantId: activeTypingParticipantIdRef.current ?? undefined,
          }),
          signal,
        })
        if (!res.ok) throw new Error(await refusalMessage(res, 'The curtain would not rise'))
        return res
      },
      handlers: (turn) => ({
        // The opening's greeting is one turn; it has no chain bookkeeping.
        onTurnComplete: undefined,
        // A greeting with no responder named has no bubble to put it in.
        onDone: (fullContent, data) =>
          settleFinalDone(turn, turn.participantId ? fullContent : '', data, 'opening'),
      }),
      after: fetchChat,
    })
  }, [chatId, runTurnStream, settleFinalDone, fetchChat])

  /**
   * Read a narration-only stream — a join the operator is watching
   * (`?action=add-participant` with `narrate: true`) — into the Green Room,
   * then refresh the chat. Never throws.
   */
  const readGreenRoomStream = useCallback(async (res: Response) => {
    try {
      const reader = res.body?.getReader()
      if (!reader) return
      await readGreenRoomFrames(reader, (event) => onGreenRoomRef.current?.(event))
    } catch (err) {
      showErrorToast(`The arrival went quiet: ${getErrorMessage(err)}`)
    } finally {
      onGreenRoomRef.current?.({ event: 'done' })
      await fetchChat()
    }
  }, [fetchChat])

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
    await runTurnStream({
      kind: 'continue',
      refusal: STILL_SPEAKING,
      participantId,
      before: () => {
        if (!participantsAsBase.some(p => p.id === participantId && p.isActive)) {
          showErrorToast('This participant is no longer available in the chat.')
          return false
        }
        if (!hasActiveCharacters) {
          showErrorToast('No characters available. Add a character to continue the conversation.')
          return false
        }
        setHandStatus(null)
      },
      request: async (signal) => {
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
        if (!res.ok) throw new Error(await refusalMessage(res, 'Failed to trigger response'))
        return res
      },
      handlers: (turn) => ({
        onDone: (fullContent, data) => settleFinalDone(turn, fullContent, data, 'continue'),
        // Intermediate done during a chain — add temp message but don't reset state
        onIntermediateDone: (fullContent, data) => pushReply(turn, fullContent, data, 'continue-chain'),
      }),
      after: refreshAfterRun,
    })
  }, [chatId, runTurnStream, participantsAsBase, hasActiveCharacters, settleFinalDone, pushReply, refreshAfterRun])

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
    return runTurnStream({
      kind: 'storyteller',
      refusal: STILL_SPEAKING,
      before: () => {
        setConcurrentStreams([])
      },
      request: async (signal) => {
        const res = await fetch(`/api/v1/chats/${chatId}?action=storyteller-run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roundId, participantIds, order, keepOrder }),
          signal,
        })
        if (!res.ok) throw new Error(await refusalMessage(res, 'The storyteller could not run that selection'))
        return res
      },
      handlers: (turn) => ({
        onDone: (fullContent, data) => settleFinalDone(turn, fullContent, data, 'storyteller'),
        onIntermediateDone: (fullContent, data) => pushReply(turn, fullContent, data, 'storyteller'),
      }),
      after: async () => {
        setConcurrentStreams([])
        await refreshAfterRun()
      },
    })
  }, [chatId, runTurnStream, settleFinalDone, pushReply, refreshAfterRun])

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
    setRespondingParticipantId(null)
    clearStreamingToolBatches()
    dismissToolExecutionStatus()
    resetStreamingContent()
    stoppingRef.current = false
    setStopping(false)
    releaseStream()
  }, [setRespondingParticipantId, resetStreamingContent, dismissToolExecutionStatus, clearStreamingToolBatches, releaseStream])

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
    setHandStatus(null)
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
   * built to speak is asked whether to yield (`handAsked`), the answer arrives
   * as `handAnswered`, and the stream's end settles any hand left up. The
   * server's reply never overwrites a `handAsked` that beat it here.
   */
  const toggleRaisedHand = useCallback(async () => {
    const raise = !handRaised
    setHandStatus(raise ? { kind: 'raised' } : null)
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=raise-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raised: raise }),
      })
      if (!res.ok) throw new Error(res.statusText || 'Request failed')
      const data = await res.json() as { raised?: boolean; active?: boolean }
      // The stream owns the hand from here (`handAsked` / `handAnswered`, then
      // the stream's end). The one thing the reply settles is that there is no
      // stream: nobody will ever be asked, so the hand comes straight down.
      if (raise && data.active === false) {
        setHandStatus((prev) => (prev?.kind === 'raised' ? null : prev))
        showInfoToast('Nobody is speaking just now. The floor is already yours.')
      }
    } catch (err) {
      setHandStatus((prev) => (prev?.kind === 'raised' ? null : prev))
      showErrorToast(`Could not raise your hand: ${getErrorMessage(err)}`)
    }
  }, [chatId, handRaised])

  /** Put away the raised hand's outcome note. */
  const dismissHandStatus = useCallback(() => {
    setHandStatus((prev) => (isHandUp(prev) ? prev : null))
  }, [])

  return {
    sending,
    isStreamInFlight,
    streaming,
    streamingContent,
    streamingReasoning,
    waitingForResponse,
    streamingToolBatches,
    toolExecutionStatus,
    dismissToolExecutionStatus,
    responseStatus,
    sendMessage,
    triggerContinueMode,
    openChat,
    readGreenRoomStream,
    runStorytellerSelection,
    concurrentStreams,
    stopStreaming,
    handRaised,
    handStatus,
    toggleRaisedHand,
    dismissHandStatus,
    stopping,
  }
}
