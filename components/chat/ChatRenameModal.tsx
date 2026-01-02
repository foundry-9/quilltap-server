'use client'

import { useState, useEffect, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'

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
  const [saving, setSaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  // Update local state when props change
  useEffect(() => {
    setTitle(currentTitle)
    setUseAutoRename(!initialIsManuallyRenamed)
  }, [currentTitle, initialIsManuallyRenamed])

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current && !useAutoRename) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen, useAutoRename])

  const handleAutoRenameToggle = async (enabled: boolean) => {
    clientLogger.debug('[ChatRenameModal] Auto-rename toggle', {
      chatId,
      enabled,
    })

    setUseAutoRename(enabled)

    if (enabled) {
      // User is switching to auto-rename - regenerate title immediately
      try {
        setRegenerating(true)
        const res = await fetch(`/api/chats/${chatId}/regenerate-title`, {
          method: 'POST',
        })

        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || 'Failed to regenerate title')
        }

        const data = await res.json()
        setTitle(data.title)
        showSuccessToast('Title regenerated')
        clientLogger.info('[ChatRenameModal] Title regenerated', {
          chatId,
          newTitle: data.title,
        })

        // Notify parent of the change
        onSuccess?.(data.title, false)
        onClose()
      } catch (error) {
        clientLogger.error('[ChatRenameModal] Failed to regenerate title', {
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

    try {
      setSaving(true)
      clientLogger.debug('[ChatRenameModal] Saving title', {
        chatId,
        title: trimmedTitle,
        isManuallyRenamed: !useAutoRename,
      })

      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat: {
            title: trimmedTitle,
            isManuallyRenamed: !useAutoRename,
          },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to rename chat')
      }

      showSuccessToast('Chat renamed')
      clientLogger.info('[ChatRenameModal] Chat renamed', {
        chatId,
        newTitle: trimmedTitle,
        isManuallyRenamed: !useAutoRename,
      })

      onSuccess?.(trimmedTitle, !useAutoRename)
      onClose()
    } catch (error) {
      clientLogger.error('[ChatRenameModal] Failed to rename chat', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to rename chat')
    } finally {
      setSaving(false)
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
            className="rounded border-input"
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
          <svg
            className="animate-spin h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Generating title...
        </div>
      )}
    </BaseModal>
  )
}
