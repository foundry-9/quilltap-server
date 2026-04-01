'use client'

import ReactMarkdown from 'react-markdown'
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="qt-dialog w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">
                {prompt.name}
              </h3>
              {prompt.isDefault && (
                <span className="qt-badge-primary">Default</span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="qt-button-icon qt-button-ghost"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="p-4 border border-border rounded-lg bg-muted/30 prose prose-sm dark:prose-invert max-w-none max-h-[60vh] overflow-y-auto">
            <ReactMarkdown>{prompt.content}</ReactMarkdown>
          </div>
          <div className="flex justify-end gap-3 mt-4">
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
        </div>
      </div>
    </div>
  )
}
