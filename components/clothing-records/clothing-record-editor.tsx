'use client'

import { useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import FormActions from '@/components/ui/FormActions'
import MessageContent from '@/components/chat/MessageContent'
import type { ClothingRecord } from './clothing-record-card'

interface ClothingRecordEditorProps {
  entityId: string
  record?: ClothingRecord | null
  onClose: () => void
  onSave: () => void
}

export function ClothingRecordEditor({
  entityId,
  record,
  onClose,
  onSave,
}: ClothingRecordEditorProps) {
  const isEditing = !!record

  const { formData, handleChange } = useFormState({
    name: record?.name || '',
    usageContext: record?.usageContext || '',
    description: record?.description || '',
  })

  const { loading: saving, execute: executeSave, clearError } = useAsyncOperation<void>()
  const [showPreview, setShowPreview] = useState(false)

  const handleSave = async () => {
    clearError()

    await executeSave(async () => {
      const payload = {
        name: formData.name,
        usageContext: formData.usageContext || null,
        description: formData.description || null,
      }

      const baseUrl = `/api/v1/characters/${entityId}/clothing`
      const url = isEditing ? `${baseUrl}/${record.id}` : baseUrl
      const method = isEditing ? 'PUT' : 'POST'

      const result = await fetchJson<{ id: string }>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        const errorMessage = result.error || 'Failed to save clothing record'
        showErrorToast(errorMessage)
        throw new Error(errorMessage)
      }

      showSuccessToast(isEditing ? 'Clothing record updated' : 'Clothing record created')
      onSave()
    })
  }

  const charCountClass = (current: number, max: number) => {
    if (current > max) return 'text-destructive'
    if (current > max * 0.9) return 'text-warning'
    return 'text-muted-foreground'
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
      <div
        className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto"
        style={{ width: 'min(var(--qt-page-max-width), calc(100vw - 2rem))' }}
      >
        <div className="qt-dialog qt-dialog-wide max-h-[90vh] overflow-y-auto flex flex-col">
          <div className="qt-dialog-header sticky top-0 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">
                {isEditing ? 'Edit Clothing Record' : 'New Clothing Record'}
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
              <label htmlFor="clothing-name" className="qt-label mb-1">
                Name *
              </label>
              <input
                type="text"
                id="clothing-name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                placeholder="e.g., Battle Armor, Formal Gown, Casual Wear"
                className="qt-input"
              />
            </div>

            {/* Usage Context */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="clothing-usageContext" className="qt-label">
                  Usage Context
                </label>
                <span className={`text-xs ${charCountClass(formData.usageContext.length, 200)}`}>
                  {formData.usageContext.length}/200
                </span>
              </div>
              <input
                type="text"
                id="clothing-usageContext"
                name="usageContext"
                value={formData.usageContext}
                onChange={handleChange}
                maxLength={200}
                placeholder="e.g., in combat, at formal events, everyday around the house"
                className="qt-input"
              />
              <p className="mt-1 text-xs qt-text-small">
                Helps the LLM and image generators pick the right outfit for the situation
              </p>
            </div>

            {/* Description (Markdown) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="clothing-description" className="block text-sm qt-text-primary">
                  Description (Markdown)
                </label>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-xs text-primary hover:underline"
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {showPreview ? (
                <div className="w-full px-3 py-2 border border-border bg-muted text-foreground rounded-lg min-h-[120px] prose qt-prose-auto prose-sm max-w-none">
                  {formData.description ? (
                    <MessageContent content={formData.description} />
                  ) : (
                    <span className="text-muted-foreground italic">No content</span>
                  )}
                </div>
              ) : (
                <textarea
                  id="clothing-description"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={8}
                  placeholder="Describe the outfit in detail. You can use Markdown formatting..."
                  className="qt-textarea font-mono text-sm"
                />
              )}
            </div>
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
