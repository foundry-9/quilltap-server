'use client'

import ReactMarkdown from 'react-markdown'
import { BaseModal } from '@/components/ui/BaseModal'
import { CharacterSystemPrompt } from './types'

interface PreviewModalProps {
  prompt: CharacterSystemPrompt | null
  onClose: () => void
  onEdit: (prompt: CharacterSystemPrompt) => void
}

export function PreviewModal({
  prompt,
  onClose,
  onEdit,
}: PreviewModalProps) {
  if (!prompt) return null

  const title = (
    <span className="flex items-center gap-2">
      {prompt.name}
      {prompt.isDefault && (
        <span className="qt-badge-primary text-xs">
          Default
        </span>
      )}
    </span>
  )

  const footer = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={onClose}
        className="qt-button-secondary"
      >
        Close
      </button>
      <button
        type="button"
        onClick={() => {
          onEdit(prompt)
          onClose()
        }}
        className="qt-button-primary"
      >
        Edit
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      title={prompt.name}
      maxWidth="2xl"
      showCloseButton={true}
      footer={footer}
    >
      <div className="p-4 border qt-border-default rounded-lg qt-bg-muted/30 prose prose-sm qt-prose-auto max-w-none max-h-[60vh] overflow-y-auto">
        <ReactMarkdown>{prompt.content}</ReactMarkdown>
      </div>
    </BaseModal>
  )
}
