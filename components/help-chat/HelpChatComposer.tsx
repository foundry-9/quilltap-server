'use client'

/**
 * HelpChatComposer
 *
 * Simple message input for help chats — textarea + send button.
 * No formatting toolbar, no tool palette.
 */

import { useState, useCallback, useRef, type KeyboardEvent, type RefObject } from 'react'
import { Icon } from '@/components/ui/icon'

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- textareaRef is a stable ref
  }, [content, disabled, onSend])

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
        <Icon name="send" className="w-4 h-4" />
      </button>
    </div>
  )
}
