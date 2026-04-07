'use client'

import { useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import FormActions from '@/components/ui/FormActions'
import MessageContent from '@/components/chat/MessageContent'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

interface WardrobeItemEditorProps {
  characterId: string
  item?: WardrobeItem | null
  onClose: () => void
  onSave: () => void
}

export function WardrobeItemEditor({
  characterId,
  item,
  onClose,
  onSave,
}: WardrobeItemEditorProps) {
  const isEditing = !!item

  const { formData, handleChange, setField } = useFormState({
    title: item?.title || '',
    description: item?.description || '',
    appropriateness: item?.appropriateness || '',
    isDefault: item?.isDefault || false,
  })

  const [selectedTypes, setSelectedTypes] = useState<WardrobeItemType[]>(
    item?.types || []
  )

  const { loading: saving, execute: executeSave, clearError } = useAsyncOperation<void>()
  const [showPreview, setShowPreview] = useState(false)

  const handleTypeToggle = (type: WardrobeItemType) => {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type]
    )
  }

  const handleSave = async () => {
    if (selectedTypes.length === 0) {
      showErrorToast('Please select at least one type')
      return
    }

    clearError()

    await executeSave(async () => {
      const payload = {
        title: formData.title,
        description: formData.description || null,
        types: selectedTypes,
        appropriateness: formData.appropriateness || null,
        isDefault: formData.isDefault,
      }

      const baseUrl = `/api/v1/characters/${characterId}/wardrobe`
      const url = isEditing ? `${baseUrl}/${item.id}` : baseUrl
      const method = isEditing ? 'PUT' : 'POST'

      const result = await fetchJson<{ id: string }>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        const errorMessage = result.error || 'Failed to save wardrobe item'
        showErrorToast(errorMessage)
        throw new Error(errorMessage)
      }

      showSuccessToast(isEditing ? 'Wardrobe item updated' : 'Wardrobe item created')
      onSave()
    })
  }

  const charCountClass = (current: number, max: number) => {
    if (current > max) return 'qt-text-destructive'
    if (current > max * 0.9) return 'qt-text-warning'
    return 'qt-text-secondary'
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
                {isEditing ? 'Edit Wardrobe Item' : 'New Wardrobe Item'}
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
            {/* Title */}
            <div>
              <label htmlFor="wardrobe-title" className="qt-label mb-1">
                Title *
              </label>
              <input
                type="text"
                id="wardrobe-title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                placeholder="e.g., Silk Evening Gown, Steel-Toed Boots, Pearl Necklace"
                className="qt-input"
              />
            </div>

            {/* Types (multi-select checkboxes) */}
            <div>
              <span className="qt-label mb-2 block">
                Type(s) *
              </span>
              <div className="flex flex-wrap gap-3">
                {WARDROBE_SLOT_TYPES.map((type) => (
                  <label
                    key={type}
                    className="inline-flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTypes.includes(type)}
                      onChange={() => handleTypeToggle(type)}
                      className="qt-checkbox"
                    />
                    <span className="text-sm capitalize text-foreground">{type}</span>
                  </label>
                ))}
              </div>
              {selectedTypes.length === 0 && (
                <p className="mt-1 text-xs qt-text-destructive">
                  Select at least one type
                </p>
              )}
            </div>

            {/* Appropriateness */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="wardrobe-appropriateness" className="qt-label">
                  Appropriateness
                </label>
                <span className={`text-xs ${charCountClass(formData.appropriateness.length, 200)}`}>
                  {formData.appropriateness.length}/200
                </span>
              </div>
              <input
                type="text"
                id="wardrobe-appropriateness"
                name="appropriateness"
                value={formData.appropriateness}
                onChange={handleChange}
                maxLength={200}
                placeholder="e.g., formal, casual, intimate, combat"
                className="qt-input"
              />
              <p className="mt-1 text-xs qt-text-small">
                Tags for when this item is appropriate to wear
              </p>
            </div>

            {/* Description (Markdown) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="wardrobe-description" className="block text-sm qt-text-primary">
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
                <div className="w-full px-3 py-2 border qt-border-default qt-bg-muted text-foreground rounded-lg min-h-[120px] prose qt-prose-auto prose-sm max-w-none">
                  {formData.description ? (
                    <MessageContent content={formData.description} />
                  ) : (
                    <span className="qt-text-secondary italic">No content</span>
                  )}
                </div>
              ) : (
                <textarea
                  id="wardrobe-description"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={8}
                  placeholder="Describe the item in detail. You can use Markdown formatting..."
                  className="qt-textarea font-mono text-sm"
                />
              )}
            </div>

            {/* isDefault */}
            <div>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="isDefault"
                  checked={formData.isDefault}
                  onChange={handleChange}
                  className="qt-checkbox"
                />
                <span className="text-sm text-foreground">Default outfit item</span>
              </label>
              <p className="mt-1 text-xs qt-text-small">
                Default items are part of the character&apos;s standard outfit
              </p>
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
              isDisabled={!formData.title.trim() || selectedTypes.length === 0}
            />
          </div>
        </div>
      </div>
    </>
  )
}
