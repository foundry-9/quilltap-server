'use client'

import { useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { clientLogger } from '@/lib/client-logger'
import FormActions from '@/components/ui/FormActions'
import MessageContent from '@/components/chat/MessageContent'

export interface PhysicalDescription {
  id: string
  name: string
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
    shortPrompt: description?.shortPrompt || '',
    mediumPrompt: description?.mediumPrompt || '',
    longPrompt: description?.longPrompt || '',
    completePrompt: description?.completePrompt || '',
    fullDescription: description?.fullDescription || '',
  })

  const { loading: saving, error: saveError, execute: executeSave, clearError } = useAsyncOperation<void>()
  const [showFullDescPreview, setShowFullDescPreview] = useState(false)

  const handleSave = async () => {
    clearError()
    clientLogger.debug('Physical description save initiated', {
      isEditing,
      entityType,
      entityId,
    })

    await executeSave(async () => {
      const payload = {
        name: formData.name,
        shortPrompt: formData.shortPrompt || null,
        mediumPrompt: formData.mediumPrompt || null,
        longPrompt: formData.longPrompt || null,
        completePrompt: formData.completePrompt || null,
        fullDescription: formData.fullDescription || null,
      }

      // All entities are now characters (personas migrated to characters with controlledBy: 'user')
      const baseUrl = `/api/characters/${entityId}/descriptions`

      const url = isEditing ? `${baseUrl}/${description.id}` : baseUrl
      const method = isEditing ? 'PUT' : 'POST'

      clientLogger.debug('Sending physical description request', {
        url,
        method,
      })

      const result = await fetchJson<{ id: string }>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        const errorMessage = result.error || 'Failed to save description'
        clientLogger.error('Physical description save failed', {
          status: result.status,
          error: errorMessage,
        })
        showErrorToast(errorMessage)
        throw new Error(errorMessage)
      }

      clientLogger.debug('Physical description saved successfully', {
        isEditing,
      })
      showSuccessToast(isEditing ? 'Description updated' : 'Description created')
      onSave()
    })
  }

  const charCountClass = (current: number, max: number) => {
    if (current > max) return 'text-red-600 dark:text-red-400'
    if (current > max * 0.9) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-gray-500 dark:text-gray-400'
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

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
        <div className="qt-dialog max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
          <div className="qt-dialog-header sticky top-0 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">
                {isEditing ? 'Edit Description' : 'New Physical Description'}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
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
            <textarea
              id="shortPrompt"
              name="shortPrompt"
              value={formData.shortPrompt}
              onChange={handleChange}
              rows={2}
              maxLength={350}
              placeholder="Brief description for small prompts..."
              className="qt-textarea"
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
            <textarea
              id="mediumPrompt"
              name="mediumPrompt"
              value={formData.mediumPrompt}
              onChange={handleChange}
              rows={3}
              maxLength={500}
              placeholder="More detailed description..."
              className="qt-textarea"
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
            <textarea
              id="longPrompt"
              name="longPrompt"
              value={formData.longPrompt}
              onChange={handleChange}
              rows={4}
              maxLength={750}
              placeholder="Extended description with more detail..."
              className="qt-textarea"
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
            <textarea
              id="completePrompt"
              name="completePrompt"
              value={formData.completePrompt}
              onChange={handleChange}
              rows={5}
              maxLength={1000}
              placeholder="Full detailed description for maximum context..."
              className="qt-textarea"
            />
          </div>

          {/* Full Description (Markdown) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="fullDescription" className="block text-sm qt-text-primary">
                Full Description (Markdown)
              </label>
              <button
                type="button"
                onClick={() => setShowFullDescPreview(!showFullDescPreview)}
                className="text-xs text-primary hover:underline"
              >
                {showFullDescPreview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {showFullDescPreview ? (
              <div className="w-full px-3 py-2 border border-border bg-muted text-foreground rounded-lg min-h-[120px] prose dark:prose-invert prose-sm max-w-none">
                {formData.fullDescription ? (
                  <MessageContent content={formData.fullDescription} />
                ) : (
                  <span className="text-muted-foreground italic">No content</span>
                )}
              </div>
            ) : (
              <textarea
                id="fullDescription"
                name="fullDescription"
                value={formData.fullDescription}
                onChange={handleChange}
                rows={6}
                placeholder="Complete freeform description in Markdown format. Use this to generate shorter prompts..."
                className="qt-textarea font-mono text-sm"
              />
            )}
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
