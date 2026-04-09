'use client'

/**
 * Gift Wardrobe Item Modal
 *
 * A modal form for creating a new wardrobe item and gifting it to a
 * specific character. Reuses the same field structure as WardrobeItemEditor
 * but targets a recipient character and supports optional immediate equipping.
 *
 * @module components/wardrobe/gift-wardrobe-item-modal
 */

import { useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import FormActions from '@/components/ui/FormActions'
import MessageContent from '@/components/chat/MessageContent'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

interface GiftWardrobeItemModalProps {
  /** Character ID of the recipient */
  recipientCharacterId: string
  /** Display name of the recipient */
  recipientName: string
  /** Chat ID (for equipping in the current chat) */
  chatId: string
  onClose: () => void
  /** Called after a successful gift so the parent can refresh outfit state */
  onGifted: (giftInfo?: { title: string; types: string[]; equipped: boolean }) => void
}

export function GiftWardrobeItemModal({
  recipientCharacterId,
  recipientName,
  chatId,
  onClose,
  onGifted,
}: GiftWardrobeItemModalProps) {
  const { formData, handleChange } = useFormState({
    title: '',
    description: '',
    appropriateness: '',
  })

  const [selectedTypes, setSelectedTypes] = useState<WardrobeItemType[]>([])
  const [equipNow, setEquipNow] = useState(false)
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
      // Create the item via the character wardrobe API
      const payload = {
        title: formData.title,
        description: formData.description || null,
        types: selectedTypes,
        appropriateness: formData.appropriateness || null,
        isDefault: false,
      }

      const createResult = await fetchJson<{ id: string }>(
        `/api/v1/characters/${recipientCharacterId}/wardrobe`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )

      if (!createResult.ok) {
        const errorMessage = createResult.error || 'Failed to create wardrobe item'
        showErrorToast(errorMessage)
        throw new Error(errorMessage)
      }

      // If equip_now, equip the item on the recipient in this chat
      if (equipNow && createResult.data?.id) {
        // Equip each slot that the item covers
        for (const slot of selectedTypes) {
          const equipResult = await fetchJson(`/api/v1/chats/${chatId}?action=equip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              characterId: recipientCharacterId,
              slot,
              itemId: createResult.data.id,
            }),
          })

          if (!equipResult.ok) {
            console.warn('[GiftWardrobeItemModal] Failed to equip slot', slot, equipResult.error)
          }
        }
      }

      showSuccessToast(`Gifted "${formData.title}" to ${recipientName}`)
      onGifted({ title: formData.title, types: [...selectedTypes], equipped: equipNow })
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
                Gift Item to {recipientName}
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
            {/* Recipient notice */}
            <div className="rounded border qt-border-info/50 qt-bg-info/10 px-3 py-2 qt-text-small qt-text-info">
              This item will be added to {recipientName}&apos;s wardrobe
            </div>

            {/* Title */}
            <div>
              <label htmlFor="gift-wardrobe-title" className="qt-label mb-1">
                Title *
              </label>
              <input
                type="text"
                id="gift-wardrobe-title"
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
                <label htmlFor="gift-wardrobe-appropriateness" className="qt-label">
                  Appropriateness
                </label>
                <span className={`text-xs ${charCountClass(formData.appropriateness.length, 200)}`}>
                  {formData.appropriateness.length}/200
                </span>
              </div>
              <input
                type="text"
                id="gift-wardrobe-appropriateness"
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
                <label htmlFor="gift-wardrobe-description" className="block text-sm qt-text-primary">
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
                  id="gift-wardrobe-description"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={6}
                  placeholder="Describe the item in detail. You can use Markdown formatting..."
                  className="qt-textarea font-mono text-sm"
                />
              )}
            </div>

            {/* Equip immediately */}
            <div>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={equipNow}
                  onChange={(e) => setEquipNow(e.target.checked)}
                  className="qt-checkbox"
                />
                <span className="text-sm text-foreground">
                  Equip on {recipientName} immediately
                </span>
              </label>
              <p className="mt-1 text-xs qt-text-small">
                If checked, {recipientName} will wear this item right away in this chat
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer flex-shrink-0">
            <FormActions
              onCancel={onClose}
              onSubmit={handleSave}
              submitLabel="Gift Item"
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
