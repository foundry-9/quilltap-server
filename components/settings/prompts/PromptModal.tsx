'use client'

import { PromptTemplate, TemplateFormData } from './types'
import ReactMarkdown from 'react-markdown'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'

interface PromptModalProps {
  isOpen: boolean
  editingTemplate: PromptTemplate | null
  formData: TemplateFormData
  showPreview: boolean
  isSaving: boolean
  onClose: () => void
  onSave: () => void
  onFormChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onPreviewToggle: () => void
}

/**
 * Modal component for creating/editing a prompt template
 */
export function PromptModal({
  isOpen,
  editingTemplate,
  formData,
  showPreview,
  isSaving,
  onClose,
  onSave,
  onFormChange,
  onPreviewToggle,
}: PromptModalProps) {
  const isDisabled = !formData.name.trim() || !formData.content.trim()

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={editingTemplate ? 'Edit Prompt' : 'Create Prompt'}
      maxWidth="4xl"
      footer={
        <FormActions
          onCancel={onClose}
          onSubmit={onSave}
          isLoading={isSaving}
          isDisabled={isDisabled}
          submitLabel={editingTemplate ? 'Save Changes' : 'Create Prompt'}
        />
      }
    >
      <div className="space-y-4">
        {/* Name field */}
        <div>
          <label className="qt-label mb-1">
            Name <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={onFormChange}
            maxLength={100}
            placeholder="My Custom Prompt"
            className="qt-input"
          />
          <p className="qt-text-xs mt-1">
            {formData.name.length}/100 characters
          </p>
        </div>

        {/* Description field */}
        <div>
          <label className="qt-label mb-1">Description</label>
          <input
            type="text"
            name="description"
            value={formData.description}
            onChange={onFormChange}
            maxLength={500}
            placeholder="A brief description of what this prompt does"
            className="qt-input"
          />
          <p className="qt-text-xs mt-1">
            {formData.description.length}/500 characters
          </p>
        </div>

        {/* Content field */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm qt-text-primary">
              Content <span className="text-destructive">*</span>
            </label>
            <button
              type="button"
              onClick={onPreviewToggle}
              className="text-sm text-primary hover:underline"
            >
              {showPreview ? 'Edit' : 'Preview'}
            </button>
          </div>

          {showPreview ? (
            <div className="w-full rounded-md border border-input bg-background p-4 min-h-[300px] max-h-[400px] overflow-y-auto prose prose-sm qt-prose-auto max-w-none">
              <ReactMarkdown>{formData.content || '*No content*'}</ReactMarkdown>
            </div>
          ) : (
            <textarea
              name="content"
              value={formData.content}
              onChange={onFormChange}
              rows={15}
              placeholder="Enter your prompt content here. Markdown formatting is supported."
              className="qt-input font-mono text-sm"
            />
          )}
          <p className="qt-text-xs mt-1">
            Markdown formatting is supported. Use the Preview button to see how it will render.
          </p>
        </div>
      </div>
    </BaseModal>
  )
}
