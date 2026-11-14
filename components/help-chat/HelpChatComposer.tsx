'use client'

/**
 * HelpChatComposer
 *
 * Simple message input for help chats — textarea + send button.
 * No formatting toolbar, no tool palette.
 *
 * Opt-in `attachments` (the Brahma Console): an attach button, paste of files
 * and images, drag and drop, and a row of pending chips above the input. Send
 * waits for every upload, and a message of attachments alone may be sent.
 * Without the prop the composer is exactly the Help Chat's.
 */

import { useState, useCallback, useRef, type KeyboardEvent, type RefObject, type ClipboardEvent, type DragEvent } from 'react'
import { Icon } from '@/components/ui/icon'
import type { ConsoleAttachmentsApi } from '@/components/brahma-console/hooks/useConsoleAttachments'

interface HelpChatComposerProps {
  /** `fileIds` is passed only when attachments are enabled and any are ready. */
  onSend: (content: string, fileIds?: string[]) => void
  disabled?: boolean
  placeholder?: string
  inputRef?: RefObject<HTMLTextAreaElement | null>
  /** Enable attachments (attach, paste, drop, chips). Absent → no attachments. */
  attachments?: ConsoleAttachmentsApi
}

export function HelpChatComposer({ onSend, disabled, placeholder = 'Ask a question...', inputRef, attachments }: HelpChatComposerProps) {
  const [content, setContent] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = inputRef || internalRef

  const readyIds = attachments?.readyIds ?? []
  const uploading = attachments?.uploading ?? false
  const canSend = !disabled && !uploading && (content.trim().length > 0 || readyIds.length > 0)

  const handleSend = useCallback(() => {
    const trimmed = content.trim()
    if (!canSend) return
    if (attachments && readyIds.length > 0) {
      onSend(trimmed, readyIds)
      attachments.clearAfterSend()
    } else {
      onSend(trimmed)
    }
    setContent('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- textareaRef is a stable ref
  }, [content, canSend, onSend, attachments, readyIds])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  // eslint-disable-next-line react-hooks/exhaustive-deps -- textareaRef is a stable ref
  }, [])

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!attachments) return
    const files = Array.from(e.clipboardData?.files ?? [])
    if (files.length === 0) return
    e.preventDefault()
    attachments.addFiles(files)
  }, [attachments])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!attachments) return
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) attachments.addFiles(files)
  }, [attachments])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!attachments) return
    if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
      e.preventDefault()
      setDragOver(true)
    }
  }, [attachments])

  const textarea = (
    <textarea
      ref={textareaRef}
      value={content}
      onChange={e => { setContent(e.target.value); handleInput() }}
      onKeyDown={handleKeyDown}
      onPaste={attachments ? handlePaste : undefined}
      placeholder={placeholder}
      aria-label="Message"
      disabled={disabled}
      rows={1}
      className="qt-help-composer-input"
      style={{ minHeight: '38px', maxHeight: '120px' }}
    />
  )

  const sendButton = (
    <button
      type="button"
      onClick={handleSend}
      disabled={!canSend}
      className="qt-help-composer-send"
      title={uploading ? 'Waiting for the attachments to finish uploading' : 'Send'}
      aria-label="Send"
    >
      <Icon name="send" className="w-4 h-4" />
    </button>
  )

  if (!attachments) {
    return (
      <div className="qt-help-composer">
        {textarea}
        {sendButton}
      </div>
    )
  }

  return (
    <div
      className={`qt-console-composer${dragOver ? ' qt-console-composer-dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {attachments.pending.length > 0 && (
        <ul className="qt-console-attachment-row" aria-label="Attachments to send">
          {attachments.pending.map(p => (
            <li
              key={p.key}
              className={`qt-console-attachment-chip${p.status === 'error' ? ' qt-console-attachment-chip-error' : ''}`}
            >
              {p.previewUrl ? (
                <img src={p.previewUrl} alt="" className="qt-console-attachment-thumb" />
              ) : (
                <Icon name="file" className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate" title={p.filename}>{p.filename}</span>
              {p.status === 'uploading' && <span className="text-xs qt-text-secondary" aria-live="polite">Uploading…</span>}
              {p.status === 'error' && <span className="text-xs qt-text-destructive" role="alert">{p.error}</span>}
              <button
                type="button"
                onClick={() => attachments.remove(p.key)}
                className="qt-console-attachment-remove"
                aria-label={`Remove ${p.filename}`}
              >
                <Icon name="close" className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="qt-help-composer">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="qt-console-composer-attach"
          aria-label="Attach files"
          title="Attach files"
        >
          <Icon name="paperclip" className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={e => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) attachments.addFiles(files)
            e.target.value = ''
          }}
        />
        {textarea}
        {sendButton}
      </div>
    </div>
  )
}
