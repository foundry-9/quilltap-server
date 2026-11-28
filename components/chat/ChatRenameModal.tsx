'use client'

import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { usePatchChat } from '@/lib/chat/use-patch-chat'
import { Spinner } from '@/components/ui/Spinner'

interface ChatRenameModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  currentTitle: string
  isManuallyRenamed: boolean
  onSuccess?: (newTitle: string, isManuallyRenamed: boolean) => void
}

export default function ChatRenameModal({
  isOpen,
  onClose,
  chatId,
  currentTitle,
  isManuallyRenamed: initialIsManuallyRenamed,
  onSuccess,
}: Readonly<ChatRenameModalProps>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(currentTitle)
  const [useAutoRename, setUseAutoRename] = useState(!initialIsManuallyRenamed)
  const { patch, isSaving } = usePatchChat(chatId)
  const saving = isSaving('title')
  const [regenerating, setRegenerating] = useState(false)

  // Re-seed from the chat only as the dialog opens (#275): cancelled edits do
  // not linger, and a retitle while it is open never replaces what is typed.
  const latestProps = useRef({ currentTitle, initialIsManuallyRenamed })
  useLayoutEffect(() => {
    latestProps.current = { currentTitle, initialIsManuallyRenamed }
  }, [currentTitle, initialIsManuallyRenamed])
  useEffect(() => {
    if (!isOpen) return
     
    setTitle(latestProps.current.currentTitle)
    setUseAutoRename(!latestProps.current.initialIsManuallyRenamed)
  }, [isOpen])

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current && !useAutoRename) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen, useAutoRename])

  const handleAutoRenameToggle = async (enabled: boolean) => {
    setUseAutoRename(enabled)

    if (enabled) {
      // User is switching to auto-rename - regenerate title immediately
      try {
        setRegenerating(true)
        const res = await fetch(`/api/v1/chats/${chatId}?action=regenerate-title`, {
          method: 'POST',
        })

        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || 'Failed to regenerate title')
        }

        const data = await res.json()
        setTitle(data.title)
        showSuccessToast('Title regenerated')

        // Notify parent of the change
        onSuccess?.(data.title, false)
        onClose()
      } catch (error) {
        console.error('[ChatRenameModal] Failed to regenerate title', {
          error: error instanceof Error ? error.message : String(error),
        })
        showErrorToast(
          error instanceof Error ? error.message : 'Failed to regenerate title'
        )
        // Revert toggle on error
        setUseAutoRename(false)
      } finally {
        setRegenerating(false)
      }
    }
  }

  const handleSave = async () => {
    const trimmedTitle = title.trim()

    if (!trimmedTitle) {
      showErrorToast('Title cannot be empty')
      return
    }

    if (trimmedTitle === currentTitle && !useAutoRename === initialIsManuallyRenamed) {
      // No changes
      onClose()
      return
    }

    const ok = await patch(
      { title: trimmedTitle, isManuallyRenamed: !useAutoRename },
      { success: 'Chat renamed', failure: 'Failed to rename chat' },
    )
    if (ok) {
      onSuccess?.(trimmedTitle, !useAutoRename)
      onClose()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !useAutoRename) {
      e.preventDefault()
      handleSave()
    }
  }

  const isLoading = saving || regenerating

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={onClose}
        disabled={isLoading}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      {!useAutoRename && (
        <button
          onClick={handleSave}
          disabled={isLoading || !title.trim()}
          className="qt-button qt-button-primary"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      )}
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Rename Chat"
      maxWidth="md"
      footer={footer}
    >
      <div className="mb-4">
        <label htmlFor="chat-title" className="qt-label mb-1">
          Chat Title
        </label>
        <input
          ref={inputRef}
          id="chat-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading || useAutoRename}
          placeholder="Enter a title for this chat..."
          className="qt-input"
        />
      </div>

      <div className="mb-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useAutoRename}
            onChange={(e) => handleAutoRenameToggle(e.target.checked)}
            disabled={isLoading}
            className="qt-checkbox"
          />
          <span className="qt-text-small">
            Use automatic naming
          </span>
        </label>
        <p className="qt-text-xs mt-1 ml-6">
          {useAutoRename
            ? 'The chat title will be updated automatically based on the conversation.'
            : 'The chat will keep the title you set and won\'t be renamed automatically.'}
        </p>
      </div>

      {regenerating && (
        <div className="qt-text-small flex items-center gap-2 mt-3">
          <Spinner className="h-4 w-4" />
          Generating title...
        </div>
      )}
    </BaseModal>
  )
}
