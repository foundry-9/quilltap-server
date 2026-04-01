'use client'

import { useState } from 'react'
import { CharacterSystemPrompt } from './types'

interface PromptListProps {
  prompts: CharacterSystemPrompt[]
  saving: boolean
  onEdit: (prompt: CharacterSystemPrompt) => void
  onPreview: (prompt: CharacterSystemPrompt) => void
  onSetDefault: (promptId: string) => void
  onDelete: (promptId: string) => void
}

export function PromptList({
  prompts,
  saving,
  onEdit,
  onPreview,
  onSetDefault,
  onDelete,
}: PromptListProps) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  if (prompts.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {prompts.map((prompt) => (
        <div
          key={prompt.id}
          className="qt-card hover:bg-accent/50 transition"
        >
          <div className="flex justify-between items-start">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="qt-text-primary truncate">{prompt.name}</h4>
                {prompt.isDefault && (
                  <span className="qt-badge-primary">Default</span>
                )}
              </div>
              <p className="qt-text-small line-clamp-2">
                {prompt.content.slice(0, 150)}...
              </p>
            </div>
            <div className="flex items-center gap-1 ml-4">
              {/* Preview Button */}
              <button
                type="button"
                onClick={() => onPreview(prompt)}
                className="qt-button-icon qt-button-ghost"
                title="Preview"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              </button>

              {/* Edit Button */}
              <button
                type="button"
                onClick={() => onEdit(prompt)}
                className="qt-button-icon qt-button-ghost"
                title="Edit"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </button>

              {/* Set Default Button */}
              {!prompt.isDefault && (
                <button
                  type="button"
                  onClick={() => onSetDefault(prompt.id)}
                  className="qt-button-icon qt-button-ghost hover:text-primary"
                  title="Set as default"
                  disabled={saving}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                    />
                  </svg>
                </button>
              )}

              {/* Delete Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setDeleteConfirm(
                      deleteConfirm === prompt.id ? null : prompt.id
                    )
                  }
                  className="qt-button-icon qt-button-ghost hover:text-destructive"
                  title="Delete"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>

                {/* Delete Confirmation Popup */}
                {deleteConfirm === prompt.id && (
                  <div className="absolute right-0 top-full mt-1 p-3 bg-card border border-border rounded-lg shadow-lg z-10 min-w-[180px]">
                    <p className="text-sm text-foreground mb-2">
                      Delete this prompt?
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onDelete(prompt.id)
                          setDeleteConfirm(null)
                        }}
                        disabled={saving}
                        className="qt-button-destructive qt-button-sm flex-1"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(null)}
                        className="qt-button-secondary qt-button-sm flex-1"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
