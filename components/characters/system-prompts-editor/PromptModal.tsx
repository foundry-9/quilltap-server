'use client'

import ReactMarkdown from 'react-markdown'
import { BaseModal } from '@/components/ui/BaseModal'
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
  const isDisabled = !formData.name.trim() || !formData.content.trim()

  const footer = (
    <div className="flex justify-end gap-3">
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
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={editingPrompt ? 'Edit Prompt' : 'Create Prompt'}
      maxWidth="2xl"
      showCloseButton={true}
      footer={footer}
    >
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
            <div className="p-4 border border-border rounded-lg bg-muted/30 min-h-[200px] prose prose-sm qt-prose-auto max-w-none">
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
    </BaseModal>
  )
}
