'use client'

import { useEffect, useRef, useState } from 'react'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface PromptDialogProps {
  message: string
  defaultValue?: string
  onClose: (value: string | undefined) => void
  confirmLabel?: string
  cancelLabel?: string
}

export function PromptDialog({
  message,
  defaultValue = '',
  onClose,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEscapeKey(() => onClose(undefined))

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    onClose(value)
  }

  return (
    <>
      <button
        className="qt-dialog-overlay cursor-default border-none z-[100]"
        onClick={() => onClose(undefined)}
        aria-label="Close dialog"
        type="button"
      />
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[101] pointer-events-auto">
        <form onSubmit={handleSubmit} className="qt-dialog p-6 min-w-[20rem]">
          <div className="qt-dialog-body !px-0 !py-0 mb-4">
            <p className="text-sm text-foreground whitespace-pre-wrap break-words">
              {message}
            </p>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="qt-input w-full mb-6"
          />
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => onClose(undefined)}
              className="qt-button qt-button-secondary"
            >
              {cancelLabel}
            </button>
            <button type="submit" className="qt-button qt-button-primary">
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
