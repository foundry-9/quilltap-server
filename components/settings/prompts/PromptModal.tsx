'use client'

import { PromptTemplate, TemplateFormData } from './types'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'

interface PromptModalProps {
  isOpen: boolean
  editingTemplate: PromptTemplate | null
  formData: TemplateFormData
  isSaving: boolean
  onClose: () => void
  onSave: () => void
  onFormChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}

/**
 * Modal component for creating/editing a prompt template
 */
export function PromptModal({
  isOpen,
  editingTemplate,
  formData,
  isSaving,
  onClose,
  onSave,
  onFormChange,
}: PromptModalProps) {
  const isDisabled = !formData.name.trim() || !formData.content.trim()

  const handleContentChange = (value: string) => {
    onFormChange({
      target: { name: 'content', value },
    } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
  }

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
            Name <span className="qt-text-destructive">*</span>
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
          <label className="block text-sm qt-text-primary mb-1">
            Content <span className="qt-text-destructive">*</span>
          </label>
          <p className="qt-text-xs mb-2">
            Markdown is supported. Toggle the source view from the toolbar if you want to see or edit the raw markdown.
          </p>
          <MarkdownLexicalEditor
            value={formData.content}
            onChange={handleContentChange}
            remountKey={editingTemplate?.id ?? 'new'}
            namespace="PromptModal.content"
            ariaLabel="Prompt content"
            minHeight="18rem"
          />
        </div>
      </div>
    </BaseModal>
  )
}
