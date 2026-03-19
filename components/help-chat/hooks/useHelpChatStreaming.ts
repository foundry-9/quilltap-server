'use client'

/**
 * useHelpChatStreaming
 *
 * Handles Server-Sent Events streaming for help chat messages.
 * Simplified from the Salon streaming hooks.
 */

import { useState, useCallback, useRef } from 'react'

interface StreamingState {
  isStreaming: boolean
  streamingContent: string
  streamingParticipantId: string | null
  error: string | null
}

interface UseHelpChatStreamingOptions {
  chatId: string | null
  onMessageComplete?: (messageId: string) => void
  onNavigate?: (url: string) => void
}

export function useHelpChatStreaming({ chatId, onMessageComplete, onNavigate }: UseHelpChatStreamingOptions) {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    streamingContent: '',
    streamingParticipantId: null,
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (content: string, fileIds?: string[]) => {
    if (!chatId) return

    // Abort any existing stream
    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    setState({
      isStreaming: true,
      streamingContent: '',
      streamingParticipantId: null,
      error: null,
    })

    try {
      const res = await fetch(`/api/v1/help-chats/${chatId}/messages`, {
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
                streamingContent: currentContent,
              }))
            }

            // Turn start (multi-character)
            if (event.turnStart) {
              currentContent = '' // Reset for new character
              setState(prev => ({
                ...prev,
                streamingContent: '',
                streamingParticipantId: event.turnStart.participantId,
              }))
            }

            // Done event
            if (event.done) {
              const messageId = event.messageId
              currentContent = '' // Reset for potential next character
              setState(prev => ({
                ...prev,
                streamingContent: '',
              }))
              if (messageId) {
                onMessageComplete?.(messageId)
              }
            }

            // Navigate event (from help_navigate tool)
            if (event.toolResult && event.toolResult.name === 'help_navigate' && event.toolResult.success) {
              try {
                const result = typeof event.toolResult.result === 'string'
                  ? JSON.parse(event.toolResult.result)
                  : event.toolResult.result
                if (result?.url) {
                  onNavigate?.(result.url)
                }
              } catch { /* ignore */ }
            }

            // Status events (tool execution)
            if (event.status) {
              setState(prev => ({
                ...prev,
                streamingParticipantId: event.status.participantId || prev.streamingParticipantId,
              }))
            }

            // Error
            if (event.error) {
              setState(prev => ({
                ...prev,
                error: event.error,
                isStreaming: false,
              }))
              return
            }

            // Chain complete
            if (event.chainComplete) {
              setState(prev => ({
                ...prev,
                isStreaming: false,
                streamingContent: '',
              }))
              return
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Stream ended normally
      setState(prev => ({
        ...prev,
        isStreaming: false,
        streamingContent: '',
      }))
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: error instanceof Error ? error.message : 'Failed to send message',
      }))
    }
  }, [chatId, onMessageComplete, onNavigate])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    setState(prev => ({
      ...prev,
      isStreaming: false,
      streamingContent: '',
    }))
  }, [])

  return {
    ...state,
    sendMessage,
    stopStreaming,
  }
}
