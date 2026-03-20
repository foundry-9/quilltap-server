'use client'

/**
 * useHelpChatStreaming
 *
 * Handles Server-Sent Events streaming for help chat messages.
 * Simplified from the Salon streaming hooks.
 */

import { useState, useCallback, useRef, useEffect } from 'react'

export interface NavigationLink {
  url: string
  label: string
}

interface StreamingState {
  isStreaming: boolean
  isExecutingTools: boolean
  streamingContent: string
  streamingParticipantId: string | null
  streamingNavigationLinks: NavigationLink[]
  error: string | null
}

interface UseHelpChatStreamingOptions {
  chatId: string | null
  onMessageComplete?: (messageId: string) => void
}

/**
 * Generate a human-readable label from a Quilltap internal URL.
 * e.g., "/settings?tab=chat&section=dangerous-content" → "Settings → Chat → Dangerous Content"
 */
function labelFromUrl(url: string): string {
  const [path, query] = url.split('?')

  const pathNames: Record<string, string> = {
    '/settings': 'Settings',
    '/aurora': 'Characters',
    '/salon': 'Chats',
    '/prospero': 'Projects',
    '/profile': 'Profile',
    '/files': 'Files',
    '/setup': 'Setup',
  }

  const basePath = Object.keys(pathNames).find(p => path.startsWith(p))
  let label = basePath ? pathNames[basePath] : path

  if (query) {
    const params = new URLSearchParams(query)
    const tab = params.get('tab')
    const section = params.get('section')
    if (tab) {
      label += ` → ${tab.charAt(0).toUpperCase() + tab.slice(1).replace(/-/g, ' ')}`
    }
    if (section) {
      label += ` → ${section.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`
    }
  }

  return label
}

export function useHelpChatStreaming({ chatId, onMessageComplete }: UseHelpChatStreamingOptions) {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    isExecutingTools: false,
    streamingContent: '',
    streamingParticipantId: null,
    streamingNavigationLinks: [],
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  // Use refs for callbacks so the streaming loop always calls the latest version,
  // even if the component re-renders with new closures during streaming
  const onMessageCompleteRef = useRef(onMessageComplete)
  useEffect(() => { onMessageCompleteRef.current = onMessageComplete }, [onMessageComplete])

  const sendMessage = useCallback(async (content: string, fileIds?: string[], overrideChatId?: string) => {
    const effectiveChatId = overrideChatId || chatId
    if (!effectiveChatId) return

    // Abort any existing stream
    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    setState({
      isStreaming: true,
      isExecutingTools: false,
      streamingContent: '',
      streamingParticipantId: null,
      streamingNavigationLinks: [],
      error: null,
    })

    try {
      const res = await fetch(`/api/v1/help-chats/${effectiveChatId}/messages`, {
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
      const collectedLinks: NavigationLink[] = []

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
                onMessageCompleteRef.current?.(messageId)
              }
            }

            // Navigate event (from help_navigate tool) — collect as a link
            if (event.toolResult && event.toolResult.name === 'help_navigate' && event.toolResult.success) {
              try {
                const result = typeof event.toolResult.result === 'string'
                  ? JSON.parse(event.toolResult.result)
                  : event.toolResult.result
                const navUrl = result?.url || result?.navigationUrl
                if (navUrl) {
                  const link: NavigationLink = {
                    url: navUrl,
                    label: labelFromUrl(navUrl),
                  }
                  // Avoid duplicates
                  if (!collectedLinks.some(l => l.url === link.url)) {
                    collectedLinks.push(link)
                    setState(prev => ({
                      ...prev,
                      streamingNavigationLinks: [...collectedLinks],
                    }))
                  }
                }
              } catch { /* ignore */ }
            }

            // Status events (tool execution) — clear intermediate content
            // so the user sees a "working" indicator instead of stale text
            if (event.status) {
              currentContent = ''
              setState(prev => ({
                ...prev,
                isExecutingTools: true,
                streamingContent: '',
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
  }, [chatId])

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
