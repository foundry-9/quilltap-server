'use client'

import { useState, useRef, useCallback } from 'react'
import { showSuccessToast, showErrorToast, showWarningToast, showInfoToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { ChatParticipantBase } from '@/lib/schemas/types'
import type { Message, MessageAttachment, Chat, PendingToolResult } from '../types'
import type { FileWriteApprovalState, SudoApprovalState, WorkspaceAcknowledgementState } from './useModalState'

export interface PendingToolCall {
  id: string
  name: string
  status: 'pending' | 'success' | 'error'
  result?: unknown
  arguments?: Record<string, unknown>
}

export interface ToolExecutionStatus {
  tool: string
  status: 'pending' | 'success' | 'error'
  message: string
}

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
  status?: ResponseStatus
  error?: string
  details?: string
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
    requiresPermission?: boolean
    pendingWrite?: {
      filename?: string
      content?: string
      mimeType?: string
      folderPath?: string
      projectId?: string | null
    }
    requiresSudoApproval?: boolean
    pendingSudoCommand?: {
      command: string
      parameters?: string[]
      timeout_ms?: number
    }
    requiresWorkspaceAcknowledgement?: boolean
  }
  provider?: string
  modelName?: string
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
}

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

interface UseSSEStreamingParams {
  chatId: string
  chat: Chat | null
  messages: Message[]
  setMessages: (fn: Message[] | ((prev: Message[]) => Message[])) => void
  setEphemeralMessages: React.Dispatch<React.SetStateAction<import('@/components/chat/EphemeralMessage').EphemeralMessageData[]>>
  isMultiChar: boolean
  hasActiveCharacters: boolean
  participantsAsBase: ChatParticipantBase[]
  isPaused: boolean
  respondingParticipantId: string | null
  setRespondingParticipantId: (id: string | null) => void
  fetchChat: () => Promise<void>
  scrollOnUserMessage: () => void
  scrollOnStreamComplete: () => void
  setAttachedFiles: (files: any[]) => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  setFileWriteApprovalState: (state: FileWriteApprovalState | null) => void
  setSudoApprovalState: (state: SudoApprovalState | null) => void
  setWorkspaceAcknowledgementState: (state: WorkspaceAcknowledgementState | null) => void
  getFirstCharacterParticipant: () => import('../types').Participant | undefined
  setPauseState: (paused: boolean) => void
}

export function useSSEStreaming({
  chatId,
  chat,
  messages,
  setMessages,
  setEphemeralMessages,
  isMultiChar,
  hasActiveCharacters,
  participantsAsBase,
  isPaused,
  respondingParticipantId,
  setRespondingParticipantId,
  fetchChat,
  scrollOnUserMessage,
  scrollOnStreamComplete,
  setAttachedFiles,
  inputRef,
  setFileWriteApprovalState,
  setSudoApprovalState,
  setWorkspaceAcknowledgementState,
  getFirstCharacterParticipant,
  setPauseState,
}: UseSSEStreamingParams) {
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [waitingForResponse, setWaitingForResponse] = useState(false)
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([])
  const [toolExecutionStatus, setToolExecutionStatus] = useState<ToolExecutionStatus | null>(null)
  const [responseStatus, setResponseStatus] = useState<ResponseStatus | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  // Focus input after response completes
  const focusInput = useCallback(() => {
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true })
    }, 150)
  }, [inputRef])

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
      onToolsDetected?: (data: SSEEvent) => void
      onToolResult?: (data: SSEEvent) => void
      onDone: (fullContent: string, data: SSEEvent) => void | Promise<void>
      /** Called for intermediate done events during a chain (not the final one) */
      onIntermediateDone?: (fullContent: string, data: SSEEvent) => void | Promise<void>
      onTurnStart?: (event: { participantId: string; characterName: string; chainDepth: number }) => void
      onTurnComplete?: (event: { participantId: string; messageId: string; chainDepth: number }) => void | Promise<void>
      onChainComplete?: (event: { reason: string; nextSpeakerId: string | null; chainDepth: number }) => void | Promise<void>
    }
  ): Promise<string> => {
    const decoder = new TextDecoder()
    let fullContent = ''
    let inChain = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const rawData = line.slice(6)
        const data = parseSSEData(rawData)
        if (!data) continue

        // Handle status updates
        if (data.status) {
          setResponseStatus(data.status)
          // Show warning toast when retrying due to empty response
          if (data.status.stage === 'retrying') {
            showWarningToast(data.status.message)
          }
        }

        // Handle content chunks
        if (data.content) {
          fullContent += data.content
          setWaitingForResponse(false)
          setStreaming(true)
          setStreamingContent(fullContent)
        }

        // Handle errors
        if (data.error) {
          setResponseStatus(null)
          const errorMsg = data.details
            ? `${data.error}: ${data.details}`
            : data.error
          throw new Error(errorMsg)
        }

        // Handle tool detection
        if (data.toolsDetected && opts.onToolsDetected) {
          opts.onToolsDetected(data)
        }

        // Handle tool results
        if (data.toolResult && opts.onToolResult) {
          opts.onToolResult(data)
        }

        // Handle completion
        if (data.done) {
          setResponseStatus(null)
          if (inChain && opts.onIntermediateDone) {
            // Intermediate done during a chain — lighter cleanup, no state reset
            await opts.onIntermediateDone(fullContent, data)
          } else {
            await opts.onDone(fullContent, data)
          }
        }

        // Handle turn start (chained character about to respond)
        // Server sends flat: { turnStart: true, participantId, characterName, chainDepth }
        if (data.turnStart) {
          inChain = true
          fullContent = ''
          setStreamingContent('')
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
          await opts.onChainComplete?.({
            reason: data.reason || 'no_next_speaker',
            nextSpeakerId: data.nextSpeakerId ?? null,
            chainDepth: data.chainDepth || 0,
          })
        }
      }
    }

    return fullContent
  }, [])

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
   * Main send message function. Creates the user message, sends request, and streams response.
   */
  const sendMessage = useCallback(async (
    e: React.FormEvent,
    input: string,
    setInput: (v: string) => void,
    attachedFiles: Array<{ id: string; filename: string; filepath: string; mimeType: string }>,
    pendingToolResults: PendingToolResult[],
    setPendingToolResults: (results: PendingToolResult[]) => void,
    clearDraft: () => void,
    userStoppedStreamRef: React.MutableRefObject<boolean>,
  ) => {
    e.preventDefault()
    if ((!input.trim() && attachedFiles.length === 0 && pendingToolResults.length === 0) || sending) return

    // Reset user-stopped flag when user sends a message
    if (!isPaused) {
      userStoppedStreamRef.current = false
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
    setStreamingContent('')
    const firstCharParticipant = getFirstCharacterParticipant()
    // Track the current responding participant across chained turns (mutable for closures)
    let currentParticipantId = firstCharParticipant?.id || null
    setRespondingParticipantId(currentParticipantId)
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

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

    const tempUserMessageId = `temp-user-${Date.now()}`
    const tempUserMessage: Message = {
      id: tempUserMessageId,
      role: 'USER',
      content: displayContent,
      createdAt: new Date().toISOString(),
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    }
    setMessages((prev) => [...prev, ...toolMessages, tempUserMessage])
    scrollOnUserMessage()

    const requestPayload = {
      content: userMessage || (attachedFiles.length > 0 ? 'Please look at the attached file(s).' : ''),
      fileIds,
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
        throw new Error(errorMessage)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      await readSSEStream(reader, {
        participantId: firstCharParticipant?.id || null,
        onToolsDetected: (data) => {
          const toolNames = data.toolNames as string[]
          const toolArgs = (data.toolArguments || []) as Record<string, unknown>[]
          setPendingToolCalls(toolNames.map((name, idx) => ({
            id: `tool-${idx}`,
            name,
            status: 'pending' as const,
            arguments: toolArgs[idx],
          })))
          if (toolNames.includes('generate_image')) {
            setToolExecutionStatus({
              tool: 'generate_image',
              status: 'pending',
              message: `Generating image...`,
            })
          }
        },
        onToolResult: (data) => {
          const { index, name, success, result, requiresPermission, pendingWrite, requiresSudoApproval, pendingSudoCommand, requiresWorkspaceAcknowledgement } = data.toolResult!

          setPendingToolCalls(prev => prev.map((tc, idx) =>
            (index !== undefined && idx === index) || (index === undefined && tc.name === name)
              ? { ...tc, status: success ? 'success' : 'error', result }
              : tc
          ))

          if (requiresPermission && pendingWrite) {
            setFileWriteApprovalState({
              isOpen: false,
              pendingWrite: {
                filename: pendingWrite.filename || 'unknown',
                content: pendingWrite.content,
                mimeType: pendingWrite.mimeType || 'text/plain',
                folderPath: pendingWrite.folderPath || '/',
                projectId: pendingWrite.projectId ?? chat?.projectId ?? null,
              },
              projectName: chat?.projectName ?? undefined,
              respondingParticipantId: respondingParticipantId ?? undefined,
            })
          }

          if (requiresSudoApproval && pendingSudoCommand) {
            setSudoApprovalState({
              isOpen: true,
              pendingSudoCommand: {
                command: pendingSudoCommand.command,
                parameters: pendingSudoCommand.parameters,
                timeout_ms: pendingSudoCommand.timeout_ms,
              },
              respondingParticipantId: respondingParticipantId ?? undefined,
            })
          }

          if (requiresWorkspaceAcknowledgement) {
            setWorkspaceAcknowledgementState({
              isOpen: true,
              toolName: name,
              respondingParticipantId: respondingParticipantId ?? undefined,
            })
          }

          if (name === 'generate_image') {
            if (success) {
              const imageCount = result?.images?.length || 1
              setToolExecutionStatus({
                tool: name,
                status: 'success',
                message: `Successfully generated ${imageCount} image${imageCount > 1 ? 's' : ''}!`,
              })
              showSuccessToast(`Image generation complete! ${imageCount} image${imageCount > 1 ? 's' : ''} generated.`)
            } else {
              setToolExecutionStatus({
                tool: name,
                status: 'error',
                message: result?.error || 'Failed to generate image',
              })
              showErrorToast(`Image generation failed: ${result?.error || 'Unknown error'}`)
            }
          }
        },
        onDone: async (fullContent, data) => {
          if (data.emptyResponse) {
            showErrorToast(data.emptyResponseReason || 'The AI returned an empty response. Use the Resend button to try again.')
            setStreamingContent('')
            setStreaming(false)
            setWaitingForResponse(false)
            setSending(false)
            setRespondingParticipantId(null)
            return
          }

          const assistantMessage: Message = {
            id: data.messageId!,
            role: 'ASSISTANT',
            content: fullContent,
            createdAt: new Date().toISOString(),
            participantId: currentParticipantId,
            provider: data.provider || null,
            modelName: data.modelName || null,
          }
          setMessages((prev) => [...prev, assistantMessage])
          setStreamingContent('')
          setStreaming(false)
          setWaitingForResponse(false)
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          notifyQueueChange()
          setTimeout(() => {
            setToolExecutionStatus(null)
            setPendingToolCalls([])
          }, 3000)
        },
        onIntermediateDone: async (fullContent, data) => {
          // Intermediate done during a chain — add temp message but don't reset state
          if (data.emptyResponse || !fullContent) return

          const assistantMessage: Message = {
            id: data.messageId!,
            role: 'ASSISTANT',
            content: fullContent,
            createdAt: new Date().toISOString(),
            participantId: currentParticipantId,
            provider: data.provider || null,
            modelName: data.modelName || null,
          }
          setMessages((prev) => [...prev, assistantMessage])
          setStreamingContent('')
          setStreaming(false)
        },
        onTurnStart: (event) => {
          currentParticipantId = event.participantId
          setRespondingParticipantId(event.participantId)
          setStreamingContent('')
          setWaitingForResponse(true)
          setStreaming(false)
        },
        onTurnComplete: async (event) => {
          setStreamingContent('')
          setStreaming(false)
          setWaitingForResponse(false)
          await fetchChat()
        },
        onChainComplete: async (event) => {
          setStreamingContent('')
          setStreaming(false)
          setWaitingForResponse(false)
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          notifyQueueChange()
          focusInput()
        },
      })
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'

      if (isAbort) {
        setStreamingContent('')
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
        setResponseStatus(null)
      } else {
        const errorMessage = extractErrorMessage(err)
        const displayMessage = errorMessage === 'Unknown error' || errorMessage === 'TypeError'
          ? 'Connection lost. Please try again.'
          : errorMessage
        showErrorToast(displayMessage || 'Failed to send message')

        // Don't remove the user message — the backend already saved it.
        // Re-fetch the chat to replace the temp message with the real one.
        setStreamingContent('')
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
        setResponseStatus(null)
        await fetchChat()
      }
    } finally {
      setSending(false)
      setWaitingForResponse(false)
      abortControllerRef.current = null
      setResponseStatus(null)
      focusInput()
    }
  }, [chatId, sending, isPaused, chat, respondingParticipantId, setMessages, scrollOnUserMessage, scrollOnStreamComplete, fetchChat, setAttachedFiles, setRespondingParticipantId, getFirstCharacterParticipant, inputRef, setFileWriteApprovalState, setSudoApprovalState, setWorkspaceAcknowledgementState, readSSEStream, extractErrorMessage, focusInput])

  /**
   * Trigger continue mode - request AI to generate a response from a specific participant.
   */
  const triggerContinueMode = useCallback(async (participantId: string) => {
    if (streaming || waitingForResponse) return
    if (isPaused) return

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
    setStreamingContent('')
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
        onDone: (fullContent, data) => {
          setResponseStatus(null)

          if (fullContent.trim()) {
            const newMessage: Message = {
              id: data.messageId || `continue-${Date.now()}`,
              role: 'ASSISTANT',
              content: fullContent,
              createdAt: new Date().toISOString(),
              participantId: currentParticipantId,
              provider: data.provider || null,
              modelName: data.modelName || null,
            }
            setMessages(prev => [...prev, newMessage])
          }

          setEphemeralMessages(prev =>
            prev.filter(em => em.participantId !== participantId)
          )
        },
        onIntermediateDone: async (fullContent, data) => {
          // Intermediate done during a chain — add temp message but don't reset state
          if (!fullContent.trim()) return

          const newMessage: Message = {
            id: data.messageId || `continue-chain-${Date.now()}`,
            role: 'ASSISTANT',
            content: fullContent,
            createdAt: new Date().toISOString(),
            participantId: currentParticipantId,
            provider: data.provider || null,
            modelName: data.modelName || null,
          }
          setMessages(prev => [...prev, newMessage])
        },
        onTurnStart: (event) => {
          currentParticipantId = event.participantId
          setRespondingParticipantId(event.participantId)
          setStreamingContent('')
          setWaitingForResponse(true)
          setStreaming(false)
        },
        onTurnComplete: async (event) => {
          setStreamingContent('')
          setStreaming(false)
          setWaitingForResponse(false)
          await fetchChat()
        },
        onChainComplete: async (event) => {
          setStreamingContent('')
          setStreaming(false)
          setWaitingForResponse(false)
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
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
      setStreamingContent('')
      setRespondingParticipantId(null)
      setResponseStatus(null)
      abortControllerRef.current = null
      scrollOnStreamComplete()
      // Re-fetch chat to pick up side-channel messages (e.g. whisper tool writes)
      await fetchChat()
      notifyQueueChange()
      focusInput()
    }
  }, [chatId, streaming, waitingForResponse, isPaused, participantsAsBase, hasActiveCharacters, setMessages, setEphemeralMessages, scrollOnStreamComplete, setRespondingParticipantId, readSSEStream, extractErrorMessage, focusInput, fetchChat])

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStreaming(false)
    setWaitingForResponse(false)
    setSending(false)
    setRespondingParticipantId(null)
    setPendingToolCalls([])
    setToolExecutionStatus(null)
    if (isMultiChar) {
      setPauseState(true)
    }
    if (streamingContent) {
      showInfoToast('Response stopped - chat paused')
    }
    setStreamingContent('')
  }, [streamingContent, isMultiChar, setPauseState, setRespondingParticipantId])

  return {
    sending,
    streaming,
    streamingContent,
    waitingForResponse,
    pendingToolCalls,
    toolExecutionStatus,
    responseStatus,
    abortControllerRef,
    sendMessage,
    triggerContinueMode,
    stopStreaming,
  }
}
