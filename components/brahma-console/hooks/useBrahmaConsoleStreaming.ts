'use client'

/**
 * useBrahmaConsoleStreaming
 *
 * Server-Sent Events streaming for Brahma Console messages. A single,
 * character-less stream: content chunks, live reasoning ("thinking") chunks, a
 * tool-execution status indicator, a `done` event, and errors. No turn/chain/
 * navigation events (those belong to the multi-character Help Chat loop).
 */

import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * A tool call observed live on the stream this turn. Built up from the
 * `toolsDetected` event (name + arguments) and completed by the matching
 * `toolResult` event (success + result). Accumulates across the whole agent run
 * (not reset per turn) so the operator watches each query land; cleared when the
 * turn settles and the persisted transcript reloads.
 */
export interface StreamingToolCall {
  name: string
  arguments: Record<string, unknown>
  /** Result payload once it arrives (the run_sql envelope object, or null). */
  result?: unknown
  success?: boolean
  /** True until the matching toolResult event fills this in. */
  pending: boolean
}

interface StreamingState {
  isStreaming: boolean
  isExecutingTools: boolean
  streamingContent: string
  /** Cumulative reasoning ("thinking") so far this turn — DISPLAY ONLY. The
   *  server sends the full chain on each chunk, so this is replaced, not
   *  appended. */
  streamingReasoning: string
  /** Tool calls observed live this turn (chiefly run_sql), in emission order. */
  streamingToolCalls: StreamingToolCall[]
  error: string | null
}

interface UseBrahmaConsoleStreamingOptions {
  chatId: string | null
  onMessageComplete?: (messageId: string) => void
}

export function useBrahmaConsoleStreaming({ chatId, onMessageComplete }: UseBrahmaConsoleStreamingOptions) {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    isExecutingTools: false,
    streamingContent: '',
    streamingReasoning: '',
    streamingToolCalls: [],
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)
  // Live tool-call accumulator + the base offset of the current detection batch,
  // so a `toolResult` event (indexed within its batch) maps back to the right
  // entry even across multiple agent turns. Refs avoid stale-closure races as
  // events arrive faster than React can flush state.
  const toolCallsRef = useRef<StreamingToolCall[]>([])
  const batchBaseRef = useRef(0)

  const onMessageCompleteRef = useRef(onMessageComplete)
  useEffect(() => { onMessageCompleteRef.current = onMessageComplete }, [onMessageComplete])

  const sendMessage = useCallback(async (content: string, fileIds?: string[], overrideChatId?: string) => {
    const effectiveChatId = overrideChatId || chatId
    if (!effectiveChatId) return

    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    toolCallsRef.current = []
    batchBaseRef.current = 0

    setState({
      isStreaming: true,
      isExecutingTools: false,
      streamingContent: '',
      streamingReasoning: '',
      streamingToolCalls: [],
      error: null,
    })

    try {
      const res = await fetch(`/api/v1/brahma-console/${effectiveChatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, fileIds }),
        signal: abortController.signal,
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Failed to send message' }))
        throw new Error(errorData.error || `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let currentContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue

          try {
            const event = JSON.parse(jsonStr)

            // Content chunk
            if (event.content) {
              currentContent += event.content
              setState(prev => ({
                ...prev,
                isExecutingTools: false,
                streamingContent: currentContent,
              }))
            }

            // Reasoning ("thinking") chunk — cumulative chain so far; replace,
            // not append. Left intact across tool-execution status so the
            // chain stays visible between turns. DISPLAY ONLY.
            if (typeof event.reasoning === 'string') {
              setState(prev => ({ ...prev, streamingReasoning: event.reasoning }))
            }

            // Tool batch detected — record each call (pending) so the operator
            // sees the query before its rows land. Remember this batch's base
            // offset so the indexed toolResult events that follow map back here.
            if (typeof event.toolsDetected === 'number') {
              const names: string[] = Array.isArray(event.toolNames) ? event.toolNames : []
              const argsArr: Record<string, unknown>[] = Array.isArray(event.toolArguments) ? event.toolArguments : []
              batchBaseRef.current = toolCallsRef.current.length
              for (let i = 0; i < event.toolsDetected; i++) {
                const a = argsArr[i]
                toolCallsRef.current.push({
                  name: names[i] ?? 'unknown',
                  arguments: (a && typeof a === 'object') ? a : {},
                  pending: true,
                })
              }
              setState(prev => ({ ...prev, streamingToolCalls: [...toolCallsRef.current] }))
            }

            // Tool result — complete the matching pending entry by batch + index.
            if (event.toolResult && typeof event.toolResult === 'object') {
              const tr = event.toolResult as { index?: number; success?: boolean; result?: unknown }
              const gi = batchBaseRef.current + (typeof tr.index === 'number' ? tr.index : 0)
              const entry = toolCallsRef.current[gi]
              if (entry) {
                toolCallsRef.current[gi] = { ...entry, result: tr.result, success: tr.success, pending: false }
                setState(prev => ({ ...prev, streamingToolCalls: [...toolCallsRef.current] }))
              }
            }

            // Tool execution status — clear stale streamed text, show "working"
            if (event.status) {
              currentContent = ''
              setState(prev => ({
                ...prev,
                isExecutingTools: true,
                streamingContent: '',
              }))
            }

            // Done — persisted message ready; reload the transcript. The reloaded
            // transcript carries the settled tool cards, so the live ones clear.
            if (event.done) {
              const messageId = event.messageId
              currentContent = ''
              toolCallsRef.current = []
              batchBaseRef.current = 0
              setState(prev => ({ ...prev, streamingContent: '', streamingReasoning: '', streamingToolCalls: [] }))
              if (messageId) {
                onMessageCompleteRef.current?.(messageId)
              }
            }

            // Error
            if (event.error) {
              setState(prev => ({ ...prev, error: event.error, isStreaming: false, streamingReasoning: '', streamingToolCalls: [] }))
              return
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Stream closed
      setState(prev => ({ ...prev, isStreaming: false, streamingContent: '', streamingReasoning: '', streamingToolCalls: [] }))
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      setState(prev => ({
        ...prev,
        isStreaming: false,
        streamingToolCalls: [],
        error: error instanceof Error ? error.message : 'Failed to send message',
      }))
    }
  }, [chatId])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    toolCallsRef.current = []
    batchBaseRef.current = 0
    setState(prev => ({ ...prev, isStreaming: false, streamingContent: '', streamingReasoning: '', streamingToolCalls: [] }))
  }, [])

  return {
    ...state,
    sendMessage,
    stopStreaming,
  }
}
