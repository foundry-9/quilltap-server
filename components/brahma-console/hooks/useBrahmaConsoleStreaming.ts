'use client'

/**
 * useBrahmaConsoleStreaming
 *
 * Server-Sent Events streaming for Brahma Console messages. A single,
 * character-less stream: content chunks, a tool-execution status indicator, a
 * `done` event, and errors. No turn/chain/navigation events (those belong to
 * the multi-character Help Chat loop).
 */

import { useState, useCallback, useRef, useEffect } from 'react'

interface StreamingState {
  isStreaming: boolean
  isExecutingTools: boolean
  streamingContent: string
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
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  const onMessageCompleteRef = useRef(onMessageComplete)
  useEffect(() => { onMessageCompleteRef.current = onMessageComplete }, [onMessageComplete])

  const sendMessage = useCallback(async (content: string, fileIds?: string[], overrideChatId?: string) => {
    const effectiveChatId = overrideChatId || chatId
    if (!effectiveChatId) return

    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    setState({
      isStreaming: true,
      isExecutingTools: false,
      streamingContent: '',
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

            // Tool execution status — clear stale streamed text, show "working"
            if (event.status) {
              currentContent = ''
              setState(prev => ({
                ...prev,
                isExecutingTools: true,
                streamingContent: '',
              }))
            }

            // Done — persisted message ready; reload the transcript
            if (event.done) {
              const messageId = event.messageId
              currentContent = ''
              setState(prev => ({ ...prev, streamingContent: '' }))
              if (messageId) {
                onMessageCompleteRef.current?.(messageId)
              }
            }

            // Error
            if (event.error) {
              setState(prev => ({ ...prev, error: event.error, isStreaming: false }))
              return
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Stream closed
      setState(prev => ({ ...prev, isStreaming: false, streamingContent: '' }))
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: error instanceof Error ? error.message : 'Failed to send message',
      }))
    }
  }, [chatId])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    setState(prev => ({ ...prev, isStreaming: false, streamingContent: '' }))
  }, [])

  return {
    ...state,
    sendMessage,
    stopStreaming,
  }
}
