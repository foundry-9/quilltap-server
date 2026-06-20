'use client'

import { Icon } from '@/components/ui/icon'
import { CharacterSystemPrompt } from './types'

interface PromptListProps {
  prompts: CharacterSystemPrompt[]
  onPreview: (prompt: CharacterSystemPrompt) => void
  onEdit: (prompt: CharacterSystemPrompt) => void
  onSetDefault: (promptId: string) => void
  onDeleteToggle: (promptId: string | null) => void
  onDelete: (promptId: string) => void
  deleteConfirm: string | null
  saving: boolean
  onCreateClick: () => void
  onImportClick: () => void
}

export function PromptList({
  prompts,
  onPreview,
  onEdit,
  onSetDefault,
  onDeleteToggle,
  onDelete,
  deleteConfirm,
  saving,
  onCreateClick,
  onImportClick,
}: PromptListProps) {
  if (prompts.length === 0) {
    return (
      <div className="qt-card text-center">
        <p className="qt-text-small mb-4">
          No system prompts yet. Add your first prompt or import from a template.
        </p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={onImportClick}
            className="qt-button-secondary"
          >
            Import Template
          </button>
          <button
            type="button"
            onClick={onCreateClick}
            className="qt-button-primary"
          >
            Create First Prompt
          </button>
        </div>
      </div>
    )
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
                  <span className="qt-badge-primary">
                    Default
                  </span>
                )}
              </div>
              <p className="qt-text-small line-clamp-2">
                {prompt.content.slice(0, 150)}...
              </p>
            </div>
            <div className="flex items-center gap-1 ml-4">
              <button
                type="button"
                onClick={() => onPreview(prompt)}
                className="qt-button-icon qt-button-ghost"
                title="Preview"
              >
                <Icon name="eye" className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onEdit(prompt)}
                className="qt-button-icon qt-button-ghost"
                title="Edit"
              >
                <Icon name="pencil" className="w-4 h-4" />
              </button>
              {!prompt.isDefault && (
                <button
                  type="button"
                  onClick={() => onSetDefault(prompt.id)}
                  className="qt-button-icon qt-button-ghost hover:text-primary"
                  title="Set as default"
                  disabled={saving}
                >
                  <Icon name="star" className="w-4 h-4" />
                </button>
              )}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => onDeleteToggle(deleteConfirm === prompt.id ? null : prompt.id)}
                  className="qt-button-icon qt-button-ghost hover:qt-text-destructive"
                  title="Delete"
                >
                  <Icon name="trash" className="w-4 h-4" />
                </button>
                {deleteConfirm === prompt.id && (
                  <div className="absolute right-0 top-full mt-1 p-3 qt-bg-card border qt-border-default rounded-lg qt-shadow-lg z-10 min-w-[180px]">
                    <p className="text-sm text-foreground mb-2">Delete this prompt?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onDelete(prompt.id)}
                        disabled={saving}
                        className="qt-button-destructive qt-button-sm flex-1"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteToggle(null)}
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
