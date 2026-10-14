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
import {
  applyAgentStreamEvent,
  EMPTY_AGENT_TOOL_CALL_STATE,
  parseAgentSseLine,
  splitSseBuffer,
  type AgentStreamToolCall,
  type AgentToolCallState,
} from '@/components/agent-stream/parse-agent-stream'

/**
 * A tool call observed live on the stream this turn. Accumulates across the
 * whole agent run (not reset per turn) so the operator watches each query land;
 * cleared when the turn settles and the persisted transcript reloads.
 */
export type StreamingToolCall = AgentStreamToolCall

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
  // Live tool-call accumulator (calls + the current batch's base offset; see
  // parse-agent-stream). A ref avoids stale-closure races as events arrive
  // faster than React can flush state.
  const toolStateRef = useRef<AgentToolCallState>(EMPTY_AGENT_TOOL_CALL_STATE)

  const onMessageCompleteRef = useRef(onMessageComplete)
  useEffect(() => { onMessageCompleteRef.current = onMessageComplete }, [onMessageComplete])

  const sendMessage = useCallback(async (content: string, fileIds?: string[], overrideChatId?: string) => {
    const effectiveChatId = overrideChatId || chatId
    if (!effectiveChatId) return

    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    toolStateRef.current = EMPTY_AGENT_TOOL_CALL_STATE

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

        const split = splitSseBuffer(buffer, decoder.decode(value, { stream: true }))
        buffer = split.rest

        for (const line of split.lines) {
          const event = parseAgentSseLine(line)
          if (!event) continue

          // Content chunk
          if (typeof event.content === 'string' && event.content) {
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
            const reasoning = event.reasoning
            setState(prev => ({ ...prev, streamingReasoning: reasoning }))
          }

          // Tool batch detected / tool result — pending entries appear so the
          // operator sees the query before its rows land, then settle.
          const nextToolState = applyAgentStreamEvent(toolStateRef.current, event)
          if (nextToolState !== toolStateRef.current) {
            toolStateRef.current = nextToolState
            setState(prev => ({ ...prev, streamingToolCalls: nextToolState.toolCalls }))
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
            const messageId = typeof event.messageId === 'string' ? event.messageId : null
            currentContent = ''
            toolStateRef.current = EMPTY_AGENT_TOOL_CALL_STATE
            setState(prev => ({ ...prev, streamingContent: '', streamingReasoning: '', streamingToolCalls: [] }))
            if (messageId) {
              onMessageCompleteRef.current?.(messageId)
            }
          }

          // Error
          if (event.error) {
            const message = String(event.error)
            setState(prev => ({ ...prev, error: message, isStreaming: false, streamingReasoning: '', streamingToolCalls: [] }))
            return
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
    toolStateRef.current = EMPTY_AGENT_TOOL_CALL_STATE
    setState(prev => ({ ...prev, isStreaming: false, streamingContent: '', streamingReasoning: '', streamingToolCalls: [] }))
  }, [])

  return {
    ...state,
    sendMessage,
    stopStreaming,
  }
}
