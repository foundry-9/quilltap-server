'use client'

/**
 * HelpChatComposer
 *
 * Simple message input for help chats — textarea + send button.
 * No formatting toolbar, no tool palette.
 */

import { useState, useCallback, useRef, type KeyboardEvent, type RefObject } from 'react'

interface HelpChatComposerProps {
  onSend: (content: string) => void
  disabled?: boolean
  placeholder?: string
  inputRef?: RefObject<HTMLTextAreaElement | null>
}

export function HelpChatComposer({ onSend, disabled, placeholder = 'Ask a question...', inputRef }: HelpChatComposerProps) {
  const [content, setContent] = useState('')
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = inputRef || internalRef

  const handleSend = useCallback(() => {
    const trimmed = content.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setContent('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [content, disabled, onSend, textareaRef])

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
  }, [textareaRef])

  return (
    <div className="qt-help-composer">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={e => { setContent(e.target.value); handleInput() }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="qt-help-composer-input"
        style={{ minHeight: '38px', maxHeight: '120px' }}
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || !content.trim()}
        className="qt-help-composer-send"
        title="Send"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m22 2-7 20-4-9-9-4 20-7Z" />
          <path d="M22 2 11 13" />
        </svg>
      </button>
    </div>
  )
}
