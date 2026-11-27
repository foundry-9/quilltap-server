'use client'

/**
 * The "Try it" box beside a typing setting (text replacement, smart
 * typography): a controlled textarea whose key handler may rewrite the text,
 * with the cursor put back where the rewrite left it after the re-render — a
 * plain state change otherwise leaves the cursor at the end of the textarea.
 *
 * @module components/settings/chat-settings/hooks/useTryItTextarea
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export function useTryItTextarea() {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  /** Pending cursor position to set after a rewrite-triggered re-render. */
  const pendingCursor = useRef<number | null>(null)

  useEffect(() => {
    if (pendingCursor.current === null) return
    const pos = pendingCursor.current
    pendingCursor.current = null
    const ta = ref.current
    if (!ta) return
    ta.selectionStart = pos
    ta.selectionEnd = pos
  }, [text])

  /** Replace the text and place the cursor at `cursor` once it renders. */
  const rewrite = useCallback((value: string, cursor: number) => {
    pendingCursor.current = cursor
    setText(value)
  }, [])

  return { text, setText, ref, rewrite }
}
