'use client'

import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { charCountClass } from '@/lib/utils/char-count'
import FormActions from '@/components/ui/FormActions'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'

export interface PhysicalDescription {
  id: string
  name: string
  usageContext?: string | null
  shortPrompt?: string | null
  mediumPrompt?: string | null
  longPrompt?: string | null
  completePrompt?: string | null
  fullDescription?: string | null
  createdAt: string
  updatedAt: string
}

interface PhysicalDescriptionEditorProps {
  // EntityType is now only 'character' - personas have been migrated to characters with controlledBy: 'user'
  entityType: 'character'
  entityId: string
  description?: PhysicalDescription | null
  onClose: () => void
  onSave: () => void
}

export function PhysicalDescriptionEditor({
  entityType,
  entityId,
  description,
  onClose,
  onSave,
}: PhysicalDescriptionEditorProps) {
  const isEditing = !!description

  const { formData, handleChange } = useFormState({
    name: description?.name || '',
    usageContext: description?.usageContext || '',
    shortPrompt: description?.shortPrompt || '',
    mediumPrompt: description?.mediumPrompt || '',
    longPrompt: description?.longPrompt || '',
    completePrompt: description?.completePrompt || '',
    fullDescription: description?.fullDescription || '',
  })

  const { loading: saving, error: saveError, execute: executeSave, clearError } = useAsyncOperation<void>()

  // Adapter so MarkdownLexicalEditor's (value: string) => void onChange feeds
  // useFormState's event-based handleChange.
  const handleMarkdownFieldChange = (name: string) => (value: string) => {
    handleChange({
      target: { name, value },
    } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
  }

  const handleSave = async () => {
    clearError()

    await executeSave(async () => {
      const payload = {
        name: formData.name,
        usageContext: formData.usageContext || null,
        shortPrompt: formData.shortPrompt || null,
        mediumPrompt: formData.mediumPrompt || null,
        longPrompt: formData.longPrompt || null,
        completePrompt: formData.completePrompt || null,
        fullDescription: formData.fullDescription || null,
      }

      // All entities are now characters (personas migrated to characters with controlledBy: 'user')
      const baseUrl = `/api/v1/characters/${entityId}/descriptions`

      const url = isEditing ? `${baseUrl}/${description.id}` : baseUrl
      const method = isEditing ? 'PUT' : 'POST'

      const result = await fetchJson<{ id: string }>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        const errorMessage = result.error || 'Failed to save description'
        console.error('Physical description save failed', {
          status: result.status,
          error: errorMessage,
        })
        showErrorToast(errorMessage)
        throw new Error(errorMessage)
      }

      showSuccessToast(isEditing ? 'Description updated' : 'Description created')
      onSave()
    })
  }

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={onClose}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog - wrapper needs width for qt-dialog-wide to work */}
      <div
        className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto"
        style={{ width: 'min(var(--qt-page-max-width), calc(100vw - 2rem))' }}
      >
        <div className="qt-dialog qt-dialog-wide max-h-[90vh] overflow-y-auto flex flex-col">
          <div className="qt-dialog-header sticky top-0 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">
                {isEditing ? 'Edit Description' : 'New Physical Description'}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="qt-text-secondary hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="qt-dialog-body space-y-4 flex-1">
          {/* Name */}
          <div>
            <label htmlFor="name" className="qt-label mb-1">
              Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="e.g., Base Appearance, Formal Attire"
              className="qt-input"
            />
          </div>

          {/* Usage Context */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="usageContext" className="qt-label">
                Usage Context
              </label>
              <span className={`text-xs ${charCountClass(formData.usageContext.length, 200)}`}>
                {formData.usageContext.length}/200
              </span>
            </div>
            <input
              type="text"
              id="usageContext"
              name="usageContext"
              value={formData.usageContext}
              onChange={handleChange}
              maxLength={200}
              placeholder="e.g., at work in a professional capacity, relaxing at the pool"
              className="qt-input"
            />
            <p className="mt-1 text-xs qt-text-small">
              Describes when this appearance is most appropriate
            </p>
          </div>

          {/* Short Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="shortPrompt" className="block text-sm qt-text-primary">
                Short Prompt
              </label>
              <span className={`text-xs ${charCountClass(formData.shortPrompt.length, 350)}`}>
                {formData.shortPrompt.length}/350
              </span>
            </div>
            <p className="text-xs qt-text-secondary mb-2">
              Brief description for small prompts.
            </p>
            <MarkdownLexicalEditor
              value={formData.shortPrompt}
              onChange={handleMarkdownFieldChange('shortPrompt')}
              namespace="PhysicalDescription.shortPrompt"
              ariaLabel="Short prompt"
              minHeight="4rem"
            />
          </div>

          {/* Medium Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="mediumPrompt" className="block text-sm qt-text-primary">
                Medium Prompt
              </label>
              <span className={`text-xs ${charCountClass(formData.mediumPrompt.length, 500)}`}>
                {formData.mediumPrompt.length}/500
              </span>
            </div>
            <p className="text-xs qt-text-secondary mb-2">
              More detailed description.
            </p>
            <MarkdownLexicalEditor
              value={formData.mediumPrompt}
              onChange={handleMarkdownFieldChange('mediumPrompt')}
              namespace="PhysicalDescription.mediumPrompt"
              ariaLabel="Medium prompt"
              minHeight="6rem"
            />
          </div>

          {/* Long Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="longPrompt" className="block text-sm qt-text-primary">
                Long Prompt
              </label>
              <span className={`text-xs ${charCountClass(formData.longPrompt.length, 750)}`}>
                {formData.longPrompt.length}/750
              </span>
            </div>
            <p className="text-xs qt-text-secondary mb-2">
              Extended description with more detail.
            </p>
            <MarkdownLexicalEditor
              value={formData.longPrompt}
              onChange={handleMarkdownFieldChange('longPrompt')}
              namespace="PhysicalDescription.longPrompt"
              ariaLabel="Long prompt"
              minHeight="8rem"
            />
          </div>

          {/* Complete Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="completePrompt" className="block text-sm qt-text-primary">
                Complete Prompt
              </label>
              <span className={`text-xs ${charCountClass(formData.completePrompt.length, 1000)}`}>
                {formData.completePrompt.length}/1000
              </span>
            </div>
            <p className="text-xs qt-text-secondary mb-2">
              Full detailed description for maximum context.
            </p>
            <MarkdownLexicalEditor
              value={formData.completePrompt}
              onChange={handleMarkdownFieldChange('completePrompt')}
              namespace="PhysicalDescription.completePrompt"
              ariaLabel="Complete prompt"
              minHeight="10rem"
            />
          </div>

          {/* Full Description (Markdown) */}
          <div>
            <label htmlFor="fullDescription" className="block text-sm qt-text-primary mb-1">
              Full Description (Markdown)
            </label>
            <p className="text-xs qt-text-secondary mb-2">
              Complete freeform description. Use this to generate the shorter prompts above.
            </p>
            <MarkdownLexicalEditor
              value={formData.fullDescription}
              onChange={handleMarkdownFieldChange('fullDescription')}
              namespace="PhysicalDescription.fullDescription"
              ariaLabel="Full description"
              minHeight="10rem"
            />
          </div>

          {/* Actions */}
        </div>

        {/* Footer */}
        <div className="qt-dialog-footer flex-shrink-0">
          <FormActions
            onCancel={onClose}
            onSubmit={handleSave}
            submitLabel={isEditing ? 'Update' : 'Create'}
            cancelLabel="Cancel"
            isLoading={saving}
            isDisabled={!formData.name.trim()}
          />
        </div>
        </div>
      </div>
    </>
  )
}
