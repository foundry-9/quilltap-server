'use client'

/**
 * BrahmaConsolePanel
 *
 * The Brahma Console itself — launcher (past conversations + opening composer),
 * transcript, composer and the header chrome (Writing Assistant control, model
 * picker, past conversations, new conversation) — independent of where it is
 * shown. The workspace tab ({@link BrahmaConsoleView}) and the always-on
 * floating dialog ({@link BrahmaConsoleDialog}) both render it, each with its
 * own {@link BrahmaConsoleSession}, and place the two pieces it hands back
 * (`headerActions`, `body`) in their own frames.
 *
 * Writing Assistant is chosen on the launcher (a switch, off every time the
 * launcher shows) and fixed for the conversation's life; in a conversation it
 * is a badge. Its context bar sits under the header whenever it is on.
 * Attachments (attach, paste, drop) work in both modes.
 *
 * @module components/brahma-console/BrahmaConsolePanel
 */

import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'
import { BaseModal } from '@/components/ui/BaseModal'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useBrahmaConsole } from '@/components/providers/brahma-console-provider'
import { HelpChatComposer } from '@/components/help-chat/HelpChatComposer'
import { BrahmaConsoleMessageList } from './BrahmaConsoleMessageList'
import { ModelPicker } from './ModelPicker'
import { ConsoleContextBar } from './ConsoleContextBar'
import { chipsFromPending, chipsFromResolved, contextItemKey, type ContextChip } from './console-context-chips'
import { useBrahmaConsoleStreaming } from './hooks/useBrahmaConsoleStreaming'
import { useConsoleAttachments } from './hooks/useConsoleAttachments'
import type { BrahmaConsoleSession, PendingContextItem } from './hooks/useBrahmaConsoleSession'
import type { ConsoleAttachmentView } from './ConsoleMessageAttachments'
import type { ConsoleContextRef } from '@/lib/schemas/chat.types'
import type { ResolvedConsoleContext } from '@/lib/brahma-console/writing-context'

interface PastChat {
  id: string
  title: string
  updatedAt: string
  lastMessageAt: string | null
  messageCount: number
  consoleConnectionProfileId: string | null
  consoleMode: 'writing' | null
  attachmentCount: number
}

interface ConsoleMessage {
  id: string
  role: string
  content: string
  createdAt: string
  provider?: string | null
  modelName?: string | null
  reasoningContent?: string | null
  systemKind?: string | null
  attachments?: ConsoleAttachmentView[] | string[] | null
}

interface ChatDetail {
  id: string
  title: string
  consoleConnectionProfileId: string | null
  consoleMode: 'writing' | null
  context: ResolvedConsoleContext | null
  contextRefs: ConsoleContextRef[] | null
}

export interface BrahmaConsolePanelParts {
  /** Title-bar chrome: Writing Assistant control, model picker, past conversations, new conversation */
  headerActions: ReactNode
  /** Launcher or transcript + composer; fills its container */
  body: ReactNode
}

interface BrahmaConsolePanelProps {
  /** Which conversation / model this surface is on */
  session: BrahmaConsoleSession
  /** Whether the surface is showing (gates the past-chats fetch) */
  active: boolean
  /** Places the header chrome and body in the surface's own frame */
  children: (parts: BrahmaConsolePanelParts) => ReactNode
}

export function BrahmaConsolePanel({ session, active, children }: BrahmaConsolePanelProps) {
  const { profiles, isEligible } = useBrahmaConsole()
  const {
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
  } = session

  const queryClient = useQueryClient()
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const [pastChats, setPastChats] = useState<PastChat[]>([])
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [chatDetail, setChatDetail] = useState<ChatDetail | null>(null)
  const [contextSaving, setContextSaving] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PastChat | null>(null)
  const [deleting, setDeleting] = useState(false)
  const attachments = useConsoleAttachments()

  const loadMessages = useCallback(async (chatId: string) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/v1/brahma-console/${chatId}/messages`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
      } else if (res.status === 404) {
        // The remembered conversation was deleted elsewhere — fall back to the launcher.
        setCurrentChatId(null)
        return
      }
      // Sync the active model, mode and context from the chat record.
      const chatRes = await fetch(`/api/v1/brahma-console/${chatId}`)
      if (chatRes.ok) {
        const chatData = await chatRes.json()
        const chat = chatData.chat as ChatDetail | undefined
        setActiveConnectionProfileId(chat?.consoleConnectionProfileId ?? null)
        setChatDetail(chat ?? null)
      }
    } catch (error) {
      console.error('Failed to load Brahma Console messages:', error)
    } finally {
      setLoadingMessages(false)
    }
  }, [setActiveConnectionProfileId, setCurrentChatId])

  const handleMessageComplete = useCallback(() => {
    if (currentChatId) {
      loadMessages(currentChatId)
      queryClient.invalidateQueries({ queryKey: queryKeys.brahmaConsole.pastChats })
    }
  }, [currentChatId, loadMessages, queryClient])

  const {
    isStreaming,
    streamingContent,
    streamingReasoning,
    streamingToolCalls,
    streamingToolBatchMarks,
    isExecutingTools,
    error: streamError,
    sendMessage,
  } = useBrahmaConsoleStreaming({
    chatId: currentChatId,
    onMessageComplete: handleMessageComplete,
  })

  const { data: pastChatsData, refetch: refetchPastChats } = useQuery({
    queryKey: queryKeys.brahmaConsole.pastChats,
    queryFn: ({ signal }) => apiFetch<{ chats: PastChat[] }>('/api/v1/brahma-console', { signal }),
    enabled: active && !currentChatId,
  })

  useEffect(() => {
    if (pastChatsData?.chats) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Query data syncs to local state that delete/select handlers also mutate
      setPastChats(pastChatsData.chats)
    }
  }, [pastChatsData])

  // Load messages when the active chat changes
  useEffect(() => {
    if (currentChatId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror loaded transcript into local state mutated by send handlers
      loadMessages(currentChatId)
    } else {
      setMessages([])
      setChatDetail(null)
    }
  }, [currentChatId, loadMessages])

  // Re-focus the composer when streaming finishes
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setTimeout(() => composerInputRef.current?.focus({ preventScroll: true }), 100)
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  const handleCreateChat = useCallback(async (question: string, fileIds?: string[]) => {
    try {
      const body: Record<string, unknown> = {}
      if (activeConnectionProfileId) body.connectionProfileId = activeConnectionProfileId
      if (pendingWriting) {
        body.mode = 'writing'
        body.context = pendingContext.map(item => item.ref)
      }
      const res = await fetch('/api/v1/brahma-console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        const chatId = data.chat?.id
        if (chatId) {
          setActiveConnectionProfileId(data.chat?.consoleConnectionProfileId ?? null)
          clearPending()
          setCurrentChatId(chatId)
          sendMessage(question, fileIds, chatId)
          queryClient.invalidateQueries({ queryKey: queryKeys.brahmaConsole.pastChats })
        }
      } else {
        const data = await res.json().catch(() => ({}))
        setContextError(typeof data.error === 'string' ? data.error : 'The Console could not open a conversation.')
      }
    } catch (error) {
      console.error('Failed to create Brahma Console chat:', error)
    }
  }, [activeConnectionProfileId, pendingWriting, pendingContext, setActiveConnectionProfileId, clearPending, setCurrentChatId, sendMessage, queryClient])

  const handleSend = useCallback((content: string, fileIds?: string[]) => {
    const sentAttachments: ConsoleAttachmentView[] = attachments.pending
      .filter(p => p.status === 'ready' && p.id && fileIds?.includes(p.id))
      .map(p => ({
        id: p.id as string,
        filename: p.filename,
        mimeType: p.mimeType,
        isImage: false,
        path: null,
        mountPointId: null,
        missing: false,
      }))
    const optimisticMessage: ConsoleMessage = {
      id: `optimistic-${Date.now()}`,
      role: 'USER',
      content,
      createdAt: new Date().toISOString(),
      attachments: sentAttachments,
    }
    setMessages(prev => [...prev, optimisticMessage])

    if (!currentChatId) {
      handleCreateChat(content, fileIds)
    } else {
      sendMessage(content, fileIds)
    }
  }, [currentChatId, sendMessage, handleCreateChat, attachments.pending])

  /** Back to the launcher: the past-conversations roster plus a fresh composer. */
  const handleShowLauncher = useCallback(() => {
    setCurrentChatId(null)
    setMessages([])
    setChatDetail(null)
    setActiveConnectionProfileId(null)
    clearPending()
    setContextError(null)
    refetchPastChats()
    setTimeout(() => composerInputRef.current?.focus({ preventScroll: true }), 50)
  }, [setCurrentChatId, setActiveConnectionProfileId, clearPending, refetchPastChats])

  const deleteChat = useCallback(async (chatId: string) => {
    try {
      await fetch(`/api/v1/brahma-console/${chatId}`, { method: 'DELETE' })
      setPastChats(prev => prev.filter(c => c.id !== chatId))
      await refetchPastChats()
      if (currentChatId === chatId) {
        setCurrentChatId(null)
        setMessages([])
      }
    } catch (error) {
      console.error('Failed to delete Brahma Console chat:', error)
    }
  }, [currentChatId, setCurrentChatId, refetchPastChats])

  /** A conversation with attachments asks first; one without deletes at once. */
  const handleDeleteChat = useCallback((chat: PastChat) => {
    if (chat.attachmentCount > 0) {
      setPendingDelete(chat)
      return
    }
    void deleteChat(chat.id)
  }, [deleteChat])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteChat(pendingDelete.id)
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }, [pendingDelete, deleteChat])

  // ---------------------------------------------------------------------
  // Writing Assistant context
  // ---------------------------------------------------------------------

  const inConversation = !!currentChatId
  const writingOn = inConversation ? chatDetail?.consoleMode === 'writing' : pendingWriting

  const chips: ContextChip[] = useMemo(() => {
    if (!writingOn) return []
    if (!inConversation) return chipsFromPending(pendingContext)
    return chipsFromResolved(chatDetail?.contextRefs ?? [], chatDetail?.context ?? null)
  }, [writingOn, inConversation, pendingContext, chatDetail])

  /** Replace a conversation's context (optimistic; rolled back on failure). */
  const saveContext = useCallback(async (refs: ConsoleContextRef[]) => {
    if (!currentChatId || !chatDetail) return
    const previous = chatDetail
    setChatDetail({ ...chatDetail, contextRefs: refs })
    setContextSaving(true)
    setContextError(null)
    try {
      const result = await apiFetch<{ contextRefs: ConsoleContextRef[]; context: ResolvedConsoleContext }>(
        `/api/v1/brahma-console/${currentChatId}?action=set-context`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: refs }),
        },
      )
      setChatDetail(prev => (prev ? { ...prev, contextRefs: result.contextRefs, context: result.context } : prev))
    } catch (error) {
      setChatDetail(previous)
      setContextError(error instanceof Error ? error.message : 'The context could not be changed.')
    } finally {
      setContextSaving(false)
    }
  }, [currentChatId, chatDetail])

  const handleRemoveChip = useCallback((chip: ContextChip) => {
    if (!inConversation) {
      setPendingContext(pendingContext.filter(item => contextItemKey(item.ref) !== chip.key))
      return
    }
    const refs = (chatDetail?.contextRefs ?? []).filter(ref => contextItemKey(ref) !== chip.key)
    void saveContext(refs)
  }, [inConversation, pendingContext, setPendingContext, chatDetail, saveContext])

  const handleAddContext = useCallback((items: PendingContextItem[]) => {
    if (items.length === 0) return
    if (!inConversation) {
      const have = new Set(pendingContext.map(item => contextItemKey(item.ref)))
      setPendingContext([...pendingContext, ...items.filter(item => !have.has(contextItemKey(item.ref)))])
      return
    }
    const current = chatDetail?.contextRefs ?? []
    const have = new Set(current.map(contextItemKey))
    void saveContext([...current, ...items.map(item => item.ref).filter(ref => !have.has(contextItemKey(ref)))])
  }, [inConversation, pendingContext, setPendingContext, chatDetail, saveContext])

  // On the launcher the picker chooses the engine the next conversation opens
  // on; until the operator picks one, that is the default profile.
  const pickerActiveId = activeConnectionProfileId
    ?? (currentChatId ? null : profiles.find(p => p.isDefault)?.id ?? null)

  const writingControl = !inConversation ? (
    <button
      type="button"
      role="switch"
      aria-checked={pendingWriting}
      onClick={() => setPendingWriting(!pendingWriting)}
      className={`qt-console-writing-switch${pendingWriting ? ' qt-console-writing-switch-on' : ''}`}
      title="Writing Assistant: every answer is a finished piece, ready to copy, download or file"
    >
      <Icon name="pencil" className="w-3.5 h-3.5" />
      <span className="qt-console-writing-switch-label">Writing Assistant</span>
      <span className="qt-console-writing-switch-track" aria-hidden="true"><span /></span>
    </button>
  ) : chatDetail?.consoleMode === 'writing' ? (
    <span
      className="qt-console-writing-badge"
      title="The mode is settled when a conversation opens; this one is a writing desk for good."
    >
      <Icon name="pencil" className="w-3.5 h-3.5" />
      <span className="qt-console-writing-switch-label">Writing Assistant</span>
    </span>
  ) : null

  const headerActions = isEligible ? (
    <div className="flex items-center gap-1">
      {writingControl}
      <ModelPicker
        profiles={profiles}
        activeId={pickerActiveId}
        onSelect={setModel}
      />
      {currentChatId && (
        <>
          <button
            type="button"
            onClick={handleShowLauncher}
            className="p-1 rounded qt-hover-accent qt-text-secondary transition-colors"
            title="Past conversations"
            aria-label="Past conversations"
          >
            <Icon name="clock" className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleShowLauncher}
            className="p-1 rounded qt-hover-accent qt-text-secondary transition-colors"
            title="New conversation"
            aria-label="New conversation"
          >
            <Icon name="plus" className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  ) : null

  const contextBar = writingOn && isEligible ? (
    <>
      <ConsoleContextBar
        chips={chips}
        disabled={isStreaming || contextSaving}
        onRemove={handleRemoveChip}
        onAdd={handleAddContext}
      />
      {contextError && <div className="qt-help-error">{contextError}</div>}
    </>
  ) : null

  const body = (
    <div className="flex-1 min-h-0">
      {!currentChatId ? (
        /* Launcher: past chats + opening composer */
        <div className="flex flex-col h-full">
          {contextBar}
          <div className="flex-1 overflow-y-auto">
            {!isEligible ? (
              <div className="p-4 text-sm qt-text-secondary">
                The Console wants for an engine. Establish a connection profile first,
                then return to confer.
              </div>
            ) : pastChats.length > 0 ? (
              <div className="p-3">
                <div className="qt-help-section-label">Recent Console Conversations</div>
                <div className="flex flex-col gap-1">
                  {pastChats.map(chat => (
                    <div key={chat.id} className="qt-help-past-chat group">
                      {chat.consoleMode === 'writing' && (
                        <span className="qt-text-secondary" role="img" aria-label="Writing Assistant conversation" title="Writing Assistant">
                          <Icon name="pencil" className="w-3.5 h-3.5" />
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setCurrentChatId(chat.id)}
                        className="flex-1 text-left truncate text-sm"
                      >
                        {chat.title || 'Untitled'}
                      </button>
                      {chat.attachmentCount > 0 && (
                        <span className="text-xs qt-text-secondary" title={`${chat.attachmentCount} attachment${chat.attachmentCount === 1 ? '' : 's'}`}>
                          <Icon name="paperclip" className="w-3 h-3 inline" /> {chat.attachmentCount}
                        </span>
                      )}
                      <span className="text-xs qt-text-secondary">{chat.messageCount}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat) }}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded qt-text-secondary transition-all"
                        title="Delete"
                        aria-label={`Delete ${chat.title || 'this conversation'}`}
                      >
                        <Icon name="close" className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 text-sm qt-text-secondary">
                No prior conversations. Pose a question below to open a fresh line to the engine.
              </div>
            )}
          </div>

          <HelpChatComposer
            onSend={handleSend}
            disabled={!isEligible}
            inputRef={composerInputRef}
            placeholder={pendingWriting ? 'Describe the piece you need…' : 'What shall we put to the engine?'}
            attachments={attachments}
          />
        </div>
      ) : (
        /* Conversation view */
        <div className="flex flex-col h-full">
          {contextBar}
          {streamError && (
            <div className="qt-help-error">{streamError}</div>
          )}

          <BrahmaConsoleMessageList
            messages={messages}
            streamingContent={streamingContent}
            streamingReasoning={streamingReasoning}
            streamingToolCalls={streamingToolCalls}
            streamingToolBatchMarks={streamingToolBatchMarks}
            isStreaming={isStreaming}
            isExecutingTools={isExecutingTools}
            writing={chatDetail?.consoleMode === 'writing'}
            chatId={currentChatId}
            chatTitle={chatDetail?.title ?? null}
          />

          <HelpChatComposer
            onSend={handleSend}
            disabled={isStreaming || loadingMessages}
            inputRef={composerInputRef}
            placeholder={chatDetail?.consoleMode === 'writing' ? 'Ask for a revision, or a new piece…' : 'Speak to the engine…'}
            attachments={attachments}
          />
        </div>
      )}

      <BaseModal
        isOpen={pendingDelete !== null}
        onClose={() => { if (!deleting) setPendingDelete(null) }}
        role="alertdialog"
        title="Delete this conversation?"
        busy={deleting}
        maxWidth="md"
        overlayClassName="qt-console-modal-layer"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="qt-button-secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Keep it
            </button>
            <button type="button" className="qt-button-destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        <p className="text-sm">
          “{pendingDelete?.title || 'Untitled'}” carries {pendingDelete?.attachmentCount ?? 0} attached file
          {pendingDelete?.attachmentCount === 1 ? '' : 's'}, kept in the Brahma folder of Quilltap General. They
          leave with the conversation. A file you have since moved elsewhere stays where you put it.
        </p>
      </BaseModal>
    </div>
  )

  return <>{children({ headerActions, body })}</>
}
