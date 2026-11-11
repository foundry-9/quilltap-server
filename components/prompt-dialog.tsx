'use client'

import { useEffect, useRef, useState } from 'react'
import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'

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
    <BaseModal
      isOpen
      onClose={() => onClose(undefined)}
      headerless
      className="p-6 min-w-[20rem]"
      bodyClassName="overflow-y-auto"
      // Raised to the lightbox layer: lib/alert.tsx summons it imperatively,
      // and a confirm asked from inside a lightbox (ImageModal, z-[100]) must
      // paint above it. Among other dialogs it is on top by DOM order anyway.
      overlayClassName="z-[100]"
    >
      <form onSubmit={handleSubmit}>
        <div className="qt-dialog-body !px-0 !py-0 mb-4">
          <ModalTitle className="text-sm font-normal text-foreground whitespace-pre-wrap break-words">
            {message}
          </ModalTitle>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={message}
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
    </BaseModal>
  )
}
