'use client'

/**
 * Calliope's panel in the theme editor (Spec J Stage 3): her conversations
 * about this draft, the model picker, the messages with a card for each
 * proposal, and a composer with attachments. Try and Keep are the editor's
 * (they touch the preview and the edit path), passed in; Discard and the
 * conversation itself are the panel's.
 *
 * Streams through the console engine's frames (the Brahma Console's streaming
 * and attachment hooks, pointed at her route).
 *
 * @module components/theme-editor/calliope/CalliopePanel
 */

import { useCallback, useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { BaseModal } from '@/components/ui/BaseModal'
import { queryKeys } from '@/lib/query/keys'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { showErrorToast } from '@/lib/toast'
import { HelpChatComposer } from '@/components/help-chat/HelpChatComposer'
import { ModelPicker } from '@/components/brahma-console/ModelPicker'
import { useBrahmaConsoleStreaming } from '@/components/brahma-console/hooks/useBrahmaConsoleStreaming'
import { useConsoleAttachments } from '@/components/brahma-console/hooks/useConsoleAttachments'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import {
  CALLIOPE_API,
  createCalliopeChat,
  deleteCalliopeChat,
  discardProposal,
  setCalliopeModel,
  useCalliopeChats,
  useCalliopeMessages,
  type CalliopeChatSummary,
  type ProposalView,
} from './api'
import { CalliopeMessages } from './CalliopeMessages'
import { CalliopeAvatar } from './CalliopeAvatar'
import { ProposalCard } from './ProposalCard'

export interface CalliopeProposalActions {
  /** The proposal the preview is wearing, if any. */
  tryingId: string | null
  onTry: (chatId: string, proposal: ProposalView) => Promise<void>
  onStopTrying: () => void
  /** Apply a proposal through the editor; resolves once it is applied (or refused). */
  onKeep: (chatId: string, proposal: ProposalView) => Promise<void>
}

export interface CalliopePanelProps {
  draftId: string
  draftName: string
  /** Text handed over from elsewhere in the Atelier, for the composer. */
  seed: { text: string; nonce: number } | null
  actions: CalliopeProposalActions
  onClose: () => void
}

function askAgainText(p: ProposalView): string {
  return `Your proposal "${p.title}" no longer applies to the draft as it is now (${p.staleReason ?? 'it has changed'}). Please read the draft again and propose it afresh.`
}

export function CalliopePanel({ draftId, draftName, seed, actions, onClose }: CalliopePanelProps) {
  const headingId = useId()
  const conversationId = useId()
  const queryClient = useQueryClient()
  const { profiles } = useConnectionProfiles()
  const chats = useCalliopeChats(draftId)
  const chatList = chats.data ?? []
  const [chatId, setChatId] = useState<string | null>(null)
  const [chosen, setChosen] = useState(false)
  // Open on the most recent conversation, once, unless the author chose otherwise.
  if (!chosen && chatId === null && chatList.length > 0) setChatId(chatList[0].id)
  const chat: CalliopeChatSummary | null = chatList.find((c) => c.id === chatId) ?? null

  const messages = useCalliopeMessages(chatId)
  const attachments = useConsoleAttachments(CALLIOPE_API)
  const [localSeed, setLocalSeed] = useState<{ text: string; nonce: number } | null>(null)
  const composerSeed = !seed ? localSeed : !localSeed ? seed : seed.nonce > localSeed.nonce ? seed : localSeed
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CalliopeChatSummary | null>(null)
  const [deleting, setDeleting] = useState(false)

  const refresh = useCallback(
    (id: string | null) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.calliope.byDraft(draftId) })
      if (id) void queryClient.invalidateQueries({ queryKey: queryKeys.calliope.messages(id) })
    },
    [queryClient, draftId],
  )

  const streaming = useBrahmaConsoleStreaming({
    chatId,
    apiBase: CALLIOPE_API,
    onMessageComplete: () => refresh(chatId),
  })
  const { sendMessage, isStreaming, error: streamError } = streaming

  // The transcript reloads when a turn closes, however it closed.
  const [wasStreaming, setWasStreaming] = useState(false)
  if (wasStreaming !== isStreaming) {
    setWasStreaming(isStreaming)
    if (!isStreaming) refresh(chatId)
  }

  const handleSend = useCallback(
    async (content: string, fileIds?: string[]) => {
      let id = chatId
      if (!id) {
        try {
          id = (await createCalliopeChat(draftId)).chat.id
          setChosen(true)
          setChatId(id)
          refresh(null)
        } catch (err) {
          showErrorToast(apiErrorMessage(err, 'Calliope could not be summoned.'))
          return
        }
      }
      await sendMessage(content, fileIds, id)
    },
    [chatId, draftId, refresh, sendMessage],
  )

  const startNew = () => {
    setChosen(true)
    setChatId(null)
  }

  const selectModel = async (profileId: string) => {
    if (!chatId) return
    try {
      await setCalliopeModel(chatId, profileId)
      refresh(null)
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'The engine could not be changed.'))
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteCalliopeChat(pendingDelete.id)
      if (pendingDelete.id === chatId) startNew()
      refresh(null)
      setPendingDelete(null)
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'The conversation could not be deleted.'))
    } finally {
      setDeleting(false)
    }
  }

  const run = async (proposal: ProposalView, task: () => Promise<unknown>) => {
    setBusyId(proposal.id)
    try {
      await task()
    } finally {
      setBusyId(null)
      refresh(chatId)
    }
  }

  const renderProposal = (proposal: ProposalView) => (
    <ProposalCard
      proposal={proposal}
      trying={actions.tryingId === proposal.id}
      busy={busyId === proposal.id || isStreaming}
      onTry={() => chatId && void run(proposal, () => actions.onTry(chatId, proposal))}
      onStopTrying={actions.onStopTrying}
      onKeep={() => chatId && void run(proposal, () => actions.onKeep(chatId, proposal))}
      onDiscard={() =>
        chatId &&
        void run(proposal, async () => {
          if (actions.tryingId === proposal.id) actions.onStopTrying()
          try {
            await discardProposal(chatId, proposal.id)
          } catch (err) {
            showErrorToast(apiErrorMessage(err, 'The proposal could not be discarded.'))
          }
        })
      }
      onAskAgain={() => setLocalSeed({ text: askAgainText(proposal), nonce: Date.now() })}
    />
  )

  // Leaving the panel lets the preview wear the draft again.
  const { onStopTrying } = actions
  useEffect(() => () => onStopTrying(), [onStopTrying])

  const data = messages.data
  return (
    <section aria-labelledby={headingId} className="qt-card flex flex-col min-h-0 h-[calc(100vh-8rem)] @4xl:sticky @4xl:top-20">
      <header className="flex items-center gap-2 p-3 border-b qt-border-default">
        <CalliopeAvatar className="w-9 h-9" />
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="qt-heading-4 leading-tight">Calliope</h2>
          <p className="qt-text-xs qt-text-secondary truncate">On &ldquo;{draftName}&rdquo;</p>
        </div>
        {chat && (
          <ModelPicker
            profiles={profiles}
            activeId={chat.consoleConnectionProfileId}
            onSelect={(id) => void selectModel(id)}
            disabled={isStreaming}
            icon="themes"
          />
        )}
        <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={onClose} aria-label="Close Calliope's panel">
          <Icon name="close" className="w-4 h-4" />
        </button>
      </header>

      <div className="flex items-center gap-2 px-3 py-2 border-b qt-border-default">
        <label htmlFor={conversationId} className="sr-only">Conversation</label>
        <select
          id={conversationId}
          className="qt-select qt-select-sm min-w-0 flex-1"
          value={chatId ?? ''}
          onChange={(e) => {
            setChosen(true)
            setChatId(e.target.value || null)
          }}
          disabled={isStreaming}
        >
          <option value="">A new conversation</option>
          {chatList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({c.messageCount})
            </option>
          ))}
        </select>
        <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={startNew} disabled={isStreaming || !chatId} aria-label="Start a new conversation">
          <Icon name="plus" className="w-4 h-4" />
        </button>
        {chat && (
          <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={() => setPendingDelete(chat)} disabled={isStreaming} aria-label={`Delete ${chat.title}`}>
            <Icon name="trash" className="w-4 h-4" />
          </button>
        )}
      </div>

      {streamError && <div className="qt-help-error" role="alert">{streamError}</div>}
      {data?.draftMissing && <div className="qt-help-error" role="alert">This draft is no longer there.</div>}

      <CalliopeMessages
        messages={data?.messages ?? []}
        proposals={data?.proposals ?? []}
        renderProposal={renderProposal}
        isStreaming={isStreaming}
        isExecutingTools={streaming.isExecutingTools}
        streamingContent={streaming.streamingContent}
        streamingReasoning={streaming.streamingReasoning}
        streamingToolCalls={streaming.streamingToolCalls}
      />

      <HelpChatComposer
        onSend={(content, fileIds) => void handleSend(content, fileIds)}
        disabled={isStreaming || messages.isFetching && !data}
        placeholder="Describe the look you are after…"
        attachments={attachments}
        seed={composerSeed}
      />

      <BaseModal
        isOpen={pendingDelete !== null}
        onClose={() => {
          if (!deleting) setPendingDelete(null)
        }}
        role="alertdialog"
        title="Delete this conversation?"
        busy={deleting}
        maxWidth="md"
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
        <p className="qt-text-small">
          &ldquo;{pendingDelete?.title}&rdquo; and its proposals will go, with any pictures attached to it that still sit in
          the Calliope folder of Quilltap General. What you have kept stays in the draft.
        </p>
      </BaseModal>
    </section>
  )
}
