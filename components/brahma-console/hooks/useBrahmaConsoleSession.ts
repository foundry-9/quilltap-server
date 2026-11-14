'use client'

/**
 * useBrahmaConsoleSession
 *
 * One Brahma Console "seat": which conversation it is looking at and which
 * connection profile (model) that conversation talks to. Each surface that
 * shows the console — the workspace tab and the always-on floating dialog —
 * owns its own session, so the two can sit on different conversations at once
 * without fighting over a shared current-chat pointer.
 *
 * @module components/brahma-console/hooks/useBrahmaConsoleSession
 */

import { useState, useCallback } from 'react'
import type { ConsoleContextRef } from '@/lib/schemas/chat.types'

/**
 * A source chosen on the launcher before the conversation exists: the ref the
 * server will store, and the label and detail the dialog already knew (so the
 * chip needs no read of its own).
 */
export interface PendingContextItem {
  ref: ConsoleContextRef
  label: string
  /** Secondary line, e.g. a conversation's cast. */
  detail?: string
}

export interface BrahmaConsoleSession {
  /** Currently active console chat ID (null = the launcher / past-chats view) */
  currentChatId: string | null
  /** Set the current chat ID (persists to localStorage under the session's key) */
  setCurrentChatId: (id: string | null) => void
  /** The connection profile (model) the open chat is currently talking to */
  activeConnectionProfileId: string | null
  /** Set the active model locally (e.g. when a chat loads) — does NOT PATCH */
  setActiveConnectionProfileId: (id: string | null) => void
  /**
   * Switch the model. With a chat open, PATCHes `?action=set-model` so the same
   * chat continues with the new engine; on the launcher it only chooses the
   * engine the next new conversation will start with.
   */
  setModel: (connectionProfileId: string) => Promise<void>
  /**
   * The launcher's Writing Assistant switch. Off every time the launcher is
   * shown; sent with the first message, then the conversation keeps it.
   */
  pendingWriting: boolean
  setPendingWriting: (on: boolean) => void
  /** The launcher's context, sent with the first message of a Writing Assistant conversation. */
  pendingContext: PendingContextItem[]
  setPendingContext: (items: PendingContextItem[]) => void
  /** Clear the launcher's mode and context (back to the launcher, or after a create). */
  clearPending: () => void
}

/**
 * @param storageKey localStorage key remembering this seat's last conversation.
 */
export function useBrahmaConsoleSession(storageKey: string): BrahmaConsoleSession {
  const [currentChatId, setCurrentChatIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey) || null
    } catch {
      return null
    }
  })
  const [activeConnectionProfileId, setActiveConnectionProfileId] = useState<string | null>(null)
  const [pendingWriting, setPendingWriting] = useState(false)
  const [pendingContext, setPendingContext] = useState<PendingContextItem[]>([])
  const clearPending = useCallback(() => {
    setPendingWriting(false)
    setPendingContext([])
  }, [])

  const setCurrentChatId = useCallback((id: string | null) => {
    setCurrentChatIdState(id)
    try {
      if (id) localStorage.setItem(storageKey, id)
      else localStorage.removeItem(storageKey)
    } catch { /* ignore */ }
  }, [storageKey])

  const setModel = useCallback(async (connectionProfileId: string) => {
    // Optimistically reflect the switch; the same chat continues.
    setActiveConnectionProfileId(connectionProfileId)
    if (!currentChatId) return
    try {
      await fetch(`/api/v1/brahma-console/${currentChatId}?action=set-model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionProfileId }),
      })
    } catch (error) {
      console.error('Failed to switch Brahma Console model:', error)
    }
  }, [currentChatId])

  return {
    currentChatId,
    setCurrentChatId,
    activeConnectionProfileId,
    setActiveConnectionProfileId,
    setModel,
    pendingWriting,
    setPendingWriting,
    pendingContext,
    setPendingContext,
    clearPending,
  }
}
