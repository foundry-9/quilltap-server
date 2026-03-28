'use client'

import { useCallback, useState } from 'react'
import type { Chat, ChatSettings, Message } from '../types'

export interface SwipeState {
  current: number
  total: number
  messages: Message[]
}

/**
 * Check if a TOOL message was initiated by the user
 */
function isUserInitiatedTool(msg: Message): boolean {
  try {
    const parsed = JSON.parse(msg.content)
    return parsed.initiatedBy === 'user'
  } catch {
    return false
  }
}

/**
 * Groups TOOL messages with their associated message (ASSISTANT or USER).
 * - Character-initiated TOOL messages are embedded in the PRECEDING ASSISTANT message
 * - User-initiated TOOL messages are embedded in the FOLLOWING USER message
 */
function groupToolsWithMessages(messages: Message[]): Message[] {
  const embeddedToolIds = new Set<string>()
  const toolCallsForMessage = new Map<string, Message[]>()

  // First pass: identify which tools should be embedded and where
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (msg.role === 'USER') {
      // Look backward to collect any immediately preceding user-initiated TOOL messages
      const userToolCalls: Message[] = []
      let j = i - 1
      while (j >= 0 && messages[j].role === 'TOOL') {
        if (isUserInitiatedTool(messages[j])) {
          userToolCalls.unshift(messages[j]) // unshift to maintain order
          embeddedToolIds.add(messages[j].id)
        }
        j--
      }
      if (userToolCalls.length > 0) {
        toolCallsForMessage.set(msg.id, userToolCalls)
      }
    } else if (msg.role === 'ASSISTANT') {
      // Look ahead to collect any immediately following character-initiated TOOL messages
      const characterToolCalls: Message[] = []
      let j = i + 1
      while (j < messages.length && messages[j].role === 'TOOL') {
        if (!isUserInitiatedTool(messages[j])) {
          characterToolCalls.push(messages[j])
          embeddedToolIds.add(messages[j].id)
        }
        j++
      }
      if (characterToolCalls.length > 0) {
        toolCallsForMessage.set(msg.id, characterToolCalls)
      }
    }
  }

  // Second pass: build result with embedded tools
  const result: Message[] = []
  for (const msg of messages) {
    if (msg.role === 'TOOL') {
      // Only include standalone TOOL messages (not embedded)
      if (!embeddedToolIds.has(msg.id)) {
        result.push(msg)
      }
    } else {
      // Check if this message has embedded tool calls
      const toolCalls = toolCallsForMessage.get(msg.id)
      if (toolCalls && toolCalls.length > 0) {
        result.push({
          ...msg,
          toolCalls,
        })
      } else {
        result.push(msg)
      }
    }
  }

  return result
}

export function useChatData(chatId: string) {
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null)
  const [swipeStates, setSwipeStates] = useState<Record<string, SwipeState>>({})
  const [chatPhotoCount, setChatPhotoCount] = useState(0)
  const [chatMemoryCount, setChatMemoryCount] = useState(0)

  const fetchChatSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/settings/chat')
      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'Unable to read response body')
        throw new Error(`Failed to fetch chat settings: ${res.status} ${res.statusText} - ${errorBody}`)
      }
      const data = await res.json()
      setChatSettings(data)
    } catch (err) {
      console.error('Failed to fetch chat settings', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      // Use default settings if fetch fails
      setChatSettings({ id: '', userId: '', avatarDisplayMode: 'ALWAYS', avatarDisplayStyle: 'CIRCULAR', tagStyles: {}, createdAt: '', updatedAt: '' })
    }
  }, [])

  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}`)
      if (!res.ok) throw new Error('Failed to fetch chat')
      const data = await res.json()
      setChat(data.chat)

      const allMessages = data.chat.messages.filter((m: Message) => m.role !== 'SYSTEM')

      // Organize swipe groups
      const swipeGroups: Record<string, Message[]> = {}
      const displayMessages: Message[] = []
      const newSwipeStates: Record<string, SwipeState> = {}

      allMessages.forEach((msg: Message) => {
        if (msg.swipeGroupId) {
          if (!swipeGroups[msg.swipeGroupId]) {
            swipeGroups[msg.swipeGroupId] = []
          }
          swipeGroups[msg.swipeGroupId].push(msg)
        } else {
          displayMessages.push(msg)
        }
      })

      // For each swipe group, show only the current swipe (index 0 by default)
      Object.entries(swipeGroups).forEach(([groupId, groupMessages]) => {
        const sorted = groupMessages.sort((a, b) => (a.swipeIndex || 0) - (b.swipeIndex || 0))
        displayMessages.push(sorted[0])
        newSwipeStates[groupId] = {
          current: 0,
          total: sorted.length,
          messages: sorted
        }
      })

      // Sort by creation time
      displayMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      // Group TOOL messages with their associated messages (ASSISTANT or USER)
      const groupedMessages = groupToolsWithMessages(displayMessages)

      setMessages(groupedMessages)
      setSwipeStates(newSwipeStates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [chatId])

  const fetchChatPhotoCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=files`)
      if (res.ok) {
        const data = await res.json()
        const imageCount = (data.files || []).filter((f: { mimeType: string }) => f.mimeType.startsWith('image/')).length
        setChatPhotoCount(imageCount)
      }
    } catch (err) {
      console.error('Failed to fetch chat photo count:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [chatId])

  const fetchChatMemoryCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/memories?chatId=${chatId}`)
      if (res.ok) {
        const data = await res.json()
        setChatMemoryCount(data.memoryCount || 0)
      }
    } catch (err) {
      console.error('Failed to fetch chat memory count:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [chatId])

  return {
    chat,
    setChat,
    messages,
    setMessages,
    loading,
    error,
    chatSettings,
    setChatSettings,
    swipeStates,
    setSwipeStates,
    chatPhotoCount,
    setChatPhotoCount,
    chatMemoryCount,
    setChatMemoryCount,
    fetchChat,
    fetchChatSettings,
    fetchChatPhotoCount,
    fetchChatMemoryCount,
  }
}
