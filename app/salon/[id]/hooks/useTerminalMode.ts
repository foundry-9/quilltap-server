'use client'

/**
 * useTerminalMode — state management for Terminal Mode in the salon.
 *
 * Mirrors useDocumentMode's shape: the layout state (`terminalMode`),
 * the bound session id (`activeTerminalSessionId`), and the vertical
 * divider position (`rightPaneVerticalSplit`) all live on the chat record.
 *
 * The hook owns the picker visibility flag because the picker is a UX detail
 * of "open terminal", not an externally-driven modal.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { showErrorToast } from '@/lib/toast'
import type { Chat } from '../types'
import {
  type TerminalMode,
  type TerminalSessionMeta,
  getTerminalSession,
  isLiveSession,
  killTerminalSessionApi,
  listTerminalSessions,
  persistChatTerminalState,
  spawnTerminalSession,
} from './terminalModeApi'

export type { TerminalMode } from './terminalModeApi'

interface UseTerminalModeParams {
  chatId: string
  chat: Chat | null
  /** Refetch the chat after spawning a session (so the Ariel announcement appears). */
  fetchChat?: () => Promise<void> | void
}

export interface UseTerminalModeReturn {
  terminalMode: TerminalMode
  activeTerminalSessionId: string | null
  rightPaneVerticalSplit: number

  showTerminalPicker: boolean
  pickerSessions: TerminalSessionMeta[]
  closeTerminalPicker: () => void

  /** Smart entry: re-attach if a live session is bound, else picker if other live sessions exist, else spawn-and-enter. */
  requestOpen: () => Promise<void>

  attachExistingSession: (sessionId: string) => Promise<void>
  spawnNewSession: () => Promise<void>

  /** Hide pane: terminalMode → 'normal', keep PTY + sessionId. */
  hidePane: () => Promise<void>

  /** Kill PTY and exit Terminal Mode. */
  killTerminal: () => Promise<void>

  toggleFocusMode: () => void
  setRightPaneVerticalSplit: (position: number) => void
}

interface TerminalModeContextValue {
  terminalMode: TerminalMode
  activeTerminalSessionId: string | null
}

export const TerminalModeContext = createContext<TerminalModeContextValue>({
  terminalMode: 'normal',
  activeTerminalSessionId: null,
})

export function useTerminalModeContext(): TerminalModeContextValue {
  return useContext(TerminalModeContext)
}

export function useTerminalMode({ chatId, chat, fetchChat }: UseTerminalModeParams): UseTerminalModeReturn {
  const [terminalMode, setTerminalModeState] = useState<TerminalMode>('normal')
  const [activeTerminalSessionId, setActiveTerminalSessionIdState] = useState<string | null>(null)
  const [rightPaneVerticalSplit, setRightPaneVerticalSplitState] = useState<number>(50)

  const [showTerminalPicker, setShowTerminalPicker] = useState(false)
  const [pickerSessions, setPickerSessions] = useState<TerminalSessionMeta[]>([])

  const fetchChatRef = useRef(fetchChat)
  useEffect(() => {
    fetchChatRef.current = fetchChat
  }, [fetchChat])

  const persist = useCallback(async (updates: Parameters<typeof persistChatTerminalState>[1]) => {
    try {
      await persistChatTerminalState(chatId, updates)
    } catch (error) {
      console.error('[TerminalMode] Failed to persist chat terminal state', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [chatId])

  // Hydrate from chat on first load + when the chat record changes from beneath us.
  useEffect(() => {
    if (!chat) return
    const incomingMode = (chat.terminalMode ?? 'normal') as TerminalMode
    const incomingSessionId = chat.activeTerminalSessionId ?? null
    const incomingSplit = chat.rightPaneVerticalSplit ?? 50

    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local mirror of chat record on mount/refresh, mirrors useDocumentMode pattern
    setRightPaneVerticalSplitState(incomingSplit)

    // If a session was bound but has since died, fall back to normal so the
    // user doesn't return into a dead pane.
    if (incomingMode !== 'normal' && incomingSessionId) {
      let cancelled = false
      void (async () => {
        const meta = await getTerminalSession(incomingSessionId).catch(() => null)
        if (cancelled) return
        if (!isLiveSession(meta)) {
          setTerminalModeState('normal')
          setActiveTerminalSessionIdState(null)
          await persist({ terminalMode: 'normal', activeTerminalSessionId: null })
          console.debug('[TerminalMode] Bound session is dead; reset to normal', {
            chatId,
            sessionId: incomingSessionId,
          })
          return
        }
        setTerminalModeState(incomingMode)
        setActiveTerminalSessionIdState(incomingSessionId)
      })()
      return () => {
        cancelled = true
      }
    }

    setTerminalModeState(incomingMode)
    setActiveTerminalSessionIdState(incomingSessionId)
  }, [chat, chatId, persist])

  // Listen for the in-page terminal-exited custom event so a Hide-pane → Kill
  // happening from the message embed cleans the pane up too.
  useEffect(() => {
    function onTerminalExited(event: Event) {
      const detail = (event as CustomEvent<{ chatId?: string; sessionId?: string }>).detail
      if (!detail || detail.chatId !== chatId) return
      if (!detail.sessionId) return
      if (detail.sessionId !== activeTerminalSessionId) return

      console.debug('[TerminalMode] Bound session exited; resetting Terminal Mode', {
        chatId,
        sessionId: detail.sessionId,
      })
      setTerminalModeState('normal')
      setActiveTerminalSessionIdState(null)
      void persist({ terminalMode: 'normal', activeTerminalSessionId: null })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('quilltap:terminal-exited', onTerminalExited)
      return () => {
        window.removeEventListener('quilltap:terminal-exited', onTerminalExited)
      }
    }
    return undefined
  }, [chatId, activeTerminalSessionId, persist])

  const closeTerminalPicker = useCallback(() => {
    setShowTerminalPicker(false)
    setPickerSessions([])
  }, [])

  const enterModeWithSession = useCallback(async (sessionId: string) => {
    setActiveTerminalSessionIdState(sessionId)
    setTerminalModeState('split')
    await persist({ terminalMode: 'split', activeTerminalSessionId: sessionId })
  }, [persist])

  const spawnNewSession = useCallback(async () => {
    closeTerminalPicker()
    try {
      const session = await spawnTerminalSession(chatId)
      console.debug('[TerminalMode] Spawned session', {
        chatId,
        sessionId: session.id,
      })
      await enterModeWithSession(session.id)
      const fc = fetchChatRef.current
      if (fc) await fc()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to spawn terminal'
      showErrorToast(message)
      console.error('[TerminalMode] Failed to spawn session', { chatId, error: message })
    }
  }, [chatId, enterModeWithSession, closeTerminalPicker])

  const attachExistingSession = useCallback(async (sessionId: string) => {
    closeTerminalPicker()
    try {
      const meta = await getTerminalSession(sessionId)
      if (!isLiveSession(meta)) {
        showErrorToast('That terminal session has already exited.')
        return
      }
      await enterModeWithSession(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to attach session'
      showErrorToast(message)
      console.error('[TerminalMode] Failed to attach session', { chatId, sessionId, error: message })
    }
  }, [chatId, enterModeWithSession, closeTerminalPicker])

  const requestOpen = useCallback(async () => {
    // 1. If a live session is already bound, just re-enter mode without a new spawn.
    if (activeTerminalSessionId) {
      const meta = await getTerminalSession(activeTerminalSessionId).catch(() => null)
      if (isLiveSession(meta)) {
        await enterModeWithSession(activeTerminalSessionId)
        return
      }
    }

    // 2. Otherwise, look at other live sessions in this chat. If any, show the picker.
    let liveSessions: TerminalSessionMeta[] = []
    try {
      const all = await listTerminalSessions(chatId)
      liveSessions = all.filter(isLiveSession)
    } catch (error) {
      console.warn('[TerminalMode] Failed to list sessions; falling through to spawn', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (liveSessions.length > 0) {
      setPickerSessions(liveSessions)
      setShowTerminalPicker(true)
      return
    }

    // 3. No live sessions — spawn a new one and enter mode.
    await spawnNewSession()
  }, [activeTerminalSessionId, chatId, enterModeWithSession, spawnNewSession])

  const hidePane = useCallback(async () => {
    setTerminalModeState('normal')
    await persist({ terminalMode: 'normal' })
    console.debug('[TerminalMode] Hid pane (session preserved)', {
      chatId,
      sessionId: activeTerminalSessionId,
    })
  }, [chatId, activeTerminalSessionId, persist])

  const killTerminal = useCallback(async () => {
    const sessionId = activeTerminalSessionId
    setTerminalModeState('normal')
    setActiveTerminalSessionIdState(null)
    await persist({ terminalMode: 'normal', activeTerminalSessionId: null })
    if (sessionId) {
      try {
        await killTerminalSessionApi(sessionId)
        console.debug('[TerminalMode] Killed session', { chatId, sessionId })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to terminate session'
        showErrorToast(message)
        console.error('[TerminalMode] Failed to kill session', { chatId, sessionId, error: message })
      }
    }
  }, [chatId, activeTerminalSessionId, persist])

  const toggleFocusMode = useCallback(() => {
    const nextMode: TerminalMode = terminalMode === 'focus' ? 'split' : 'focus'
    setTerminalModeState(nextMode)
    void persist({ terminalMode: nextMode })
  }, [terminalMode, persist])

  const setRightPaneVerticalSplit = useCallback((position: number) => {
    const clamped = Math.max(20, Math.min(80, Math.round(position)))
    setRightPaneVerticalSplitState(clamped)
    void persist({ rightPaneVerticalSplit: clamped })
  }, [persist])

  return {
    terminalMode,
    activeTerminalSessionId,
    rightPaneVerticalSplit,

    showTerminalPicker,
    pickerSessions,
    closeTerminalPicker,

    requestOpen,
    attachExistingSession,
    spawnNewSession,

    hidePane,
    killTerminal,

    toggleFocusMode,
    setRightPaneVerticalSplit,
  }
}
