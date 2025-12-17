'use client'

import ReactMarkdown from 'react-markdown'
import { CharacterSystemPrompt, PromptFormData } from './types'

interface PromptModalProps {
  isOpen: boolean
  editingPrompt: CharacterSystemPrompt | null
  formData: PromptFormData
  showPreview: boolean
  saving: boolean
  onClose: () => void
  onSave: () => void
  onFormChange: (field: keyof PromptFormData, value: string | boolean) => void
  onPreviewToggle: () => void
}

export function PromptModal({
  isOpen,
  editingPrompt,
  formData,
  showPreview,
  saving,
  onClose,
  onSave,
  onFormChange,
  onPreviewToggle,
}: PromptModalProps) {
  if (!isOpen) return null

  const isDisabled = !formData.name.trim() || !formData.content.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="qt-dialog w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-foreground">
              {editingPrompt ? 'Edit Prompt' : 'Create Prompt'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="qt-button-icon qt-button-ghost"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="qt-label">
                Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => onFormChange('name', e.target.value)}
                placeholder="e.g., Romantic, Companion, Professional"
                className="qt-input"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="qt-label">
                  Content *
                </label>
                <button
                  type="button"
                  onClick={onPreviewToggle}
                  className="qt-link text-xs"
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {showPreview ? (
                <div className="p-4 border border-border rounded-lg bg-muted/30 min-h-[200px] prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{formData.content || '*No content*'}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={formData.content}
                  onChange={(e) => onFormChange('content', e.target.value)}
                  placeholder="Enter the system prompt content (Markdown supported)"
                  rows={10}
                  className="qt-textarea font-mono"
                />
              )}
              <p className="mt-1 qt-text-xs">
                Supports Markdown formatting. Use {'{{char}}'} and {'{{user}}'} for character/user name substitution.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isDefault"
                checked={formData.isDefault}
                onChange={(e) => onFormChange('isDefault', e.target.checked)}
                className="qt-checkbox"
              />
              <label htmlFor="isDefault" className="text-sm text-foreground">
                Set as default prompt
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="qt-button-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || isDisabled}
              className="qt-button-primary"
            >
              {saving ? 'Saving...' : editingPrompt ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
