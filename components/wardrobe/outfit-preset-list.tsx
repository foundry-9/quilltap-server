'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useListManager } from '@/hooks/useListManager'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { OutfitPresetCard } from './outfit-preset-card'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'
import FormActions from '@/components/ui/FormActions'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type {
  OutfitPreset,
  WardrobeItem,
  WardrobeItemType,
  EquippedSlots,
} from '@/lib/schemas/wardrobe.types'

// ============================================================================
// TYPES
// ============================================================================

interface OutfitPresetListProps {
  characterId: string
  /** Current equipped state (for "Save Current Outfit") */
  equippedSlots?: EquippedSlots | null
  /** Chat ID context for the "Apply" action */
  chatId?: string
  /** Callback when a preset is applied */
  onApply?: (preset: OutfitPreset) => void
  /** All wardrobe items for the character (for slot summaries and save-current) */
  wardrobeItems?: WardrobeItem[]
  refreshKey?: number
}

// ============================================================================
// SLOT LABELS
// ============================================================================

const SLOT_LABELS: Record<WardrobeItemType, string> = {
  top: 'Top',
  bottom: 'Bottom',
  footwear: 'Footwear',
  accessories: 'Accessories',
}

// ============================================================================
// PRESET EDITOR DIALOG
// ============================================================================

interface PresetEditorProps {
  characterId: string
  preset?: OutfitPreset | null
  wardrobeItems: WardrobeItem[]
  onClose: () => void
  onSave: () => void
}

function PresetEditor({
  characterId,
  preset,
  wardrobeItems,
  onClose,
  onSave,
}: PresetEditorProps) {
  const isEditing = !!preset
  const [name, setName] = useState(preset?.name || '')
  const [description, setDescription] = useState(preset?.description || '')
  const [slots, setSlots] = useState<EquippedSlots>(
    preset?.slots || { top: null, bottom: null, footwear: null, accessories: null }
  )
  const [saving, setSaving] = useState(false)

  const getItemsForSlot = useCallback(
    (slot: WardrobeItemType): WardrobeItem[] => {
      return wardrobeItems.filter((item) => item.types.includes(slot))
    },
    [wardrobeItems]
  )

  const handleSlotChange = (slot: WardrobeItemType, itemId: string | null) => {
    setSlots((prev) => ({ ...prev, [slot]: itemId }))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      showErrorToast('Please enter a name for this preset')
      return
    }

    setSaving(true)
    try {
      const baseUrl = `/api/v1/characters/${characterId}/wardrobe/presets`
      const url = isEditing ? `${baseUrl}/${preset.id}` : baseUrl
      const method = isEditing ? 'PUT' : 'POST'

      const result = await fetchJson<{ id: string }>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || null, slots }),
      })

      if (!result.ok) {
        showErrorToast(result.error || 'Failed to save preset')
        return
      }

      showSuccessToast(isEditing ? 'Preset updated' : 'Preset created')
      onSave()
    } catch {
      showErrorToast('Failed to save preset')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={onClose}
        aria-label="Close dialog"
        type="button"
      />

      <div
        className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto"
        style={{ width: 'min(var(--qt-page-max-width), calc(100vw - 2rem))' }}
      >
        <div className="qt-dialog qt-dialog-wide max-h-[90vh] overflow-y-auto flex flex-col">
          <div className="qt-dialog-header sticky top-0 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">
                {isEditing ? 'Edit Outfit Preset' : 'New Outfit Preset'}
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
              <label htmlFor="preset-name" className="qt-label mb-1">
                Name *
              </label>
              <input
                type="text"
                id="preset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g., Evening Out, Casual Friday, Battle Ready"
                className="qt-input"
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="preset-description" className="qt-label mb-1">
                Description
              </label>
              <input
                type="text"
                id="preset-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of when this outfit is appropriate"
                className="qt-input"
              />
            </div>

            {/* Slot assignments */}
            <div>
              <span className="qt-label mb-2 block">Slot Assignments</span>
              <div className="space-y-2">
                {WARDROBE_SLOT_TYPES.map((slot) => {
                  const items = getItemsForSlot(slot)
                  return (
                    <div key={slot}>
                      <label
                        htmlFor={`preset-slot-${slot}`}
                        className="mb-1 block text-xs font-medium qt-text-secondary"
                      >
                        {SLOT_LABELS[slot]}
                      </label>
                      <select
                        id={`preset-slot-${slot}`}
                        value={slots[slot] || ''}
                        onChange={(e) => handleSlotChange(slot, e.target.value || null)}
                        className="qt-select w-full"
                      >
                        <option value="">None</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                            {item.isDefault ? ' (Default)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="qt-dialog-footer flex-shrink-0">
            <FormActions
              onCancel={onClose}
              onSubmit={handleSave}
              submitLabel={isEditing ? 'Update' : 'Create'}
              cancelLabel="Cancel"
              isLoading={saving}
              isDisabled={!name.trim()}
            />
          </div>
        </div>
      </div>
    </>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function OutfitPresetList({
  characterId,
  equippedSlots,
  chatId,
  onApply,
  wardrobeItems = [],
  refreshKey,
}: OutfitPresetListProps) {
  const presetsUrl = `/api/v1/characters/${characterId}/wardrobe/presets`

  const {
    items: presets,
    loading,
    error,
    deletingId,
    editingItem,
    showEditor,
    refetch,
    handleDelete,
    handleEdit,
    handleCreate,
    handleEditorClose,
    handleEditorSave,
  } = useListManager<OutfitPreset>({
    fetchFn: async () => {
      const result = await fetchJson<{ presets: OutfitPreset[] }>(presetsUrl)
      if (!result.ok) throw new Error(result.error || 'Failed to fetch presets')
      return result.data?.presets || []
    },
    deleteFn: async (id: string) => {
      const result = await fetchJson(`${presetsUrl}/${id}`, { method: 'DELETE' })
      if (!result.ok) throw new Error(result.error || 'Failed to delete preset')
    },
    deleteConfirmMessage: 'Are you sure you want to delete this outfit preset?',
    deleteSuccessMessage: 'Outfit preset deleted',
  })

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetch()
    }
  }, [refreshKey, refetch])

  // Build item map for slot summaries
  const itemMap = useMemo(() => {
    const map: Record<string, WardrobeItem> = {}
    for (const item of wardrobeItems) {
      map[item.id] = item
    }
    return map
  }, [wardrobeItems])

  // Save current equipped state as a new preset
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [savingCurrent, setSavingCurrent] = useState(false)

  const handleSaveCurrentOutfit = async () => {
    if (!saveName.trim() || !equippedSlots) return

    setSavingCurrent(true)
    try {
      const result = await fetchJson<{ id: string }>(presetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName,
          description: saveDescription || null,
          slots: equippedSlots,
        }),
      })

      if (!result.ok) {
        showErrorToast(result.error || 'Failed to save preset')
        return
      }

      showSuccessToast('Current outfit saved as preset')
      setSaveName('')
      setSaveDescription('')
      setShowSaveDialog(false)
      refetch()
    } catch {
      showErrorToast('Failed to save preset')
    } finally {
      setSavingCurrent(false)
    }
  }

  if (loading) {
    return <LoadingState variant="spinner" />
  }

  if (error) {
    return <ErrorAlert message={error} onRetry={refetch} />
  }

  return (
    <div>
      <SectionHeader
        title="Outfit Presets"
        count={presets.length}
        action={{
          label: 'New Preset',
          onClick: handleCreate,
        }}
      />

      {/* Save Current Outfit button */}
      {equippedSlots && (
        <div className="mb-4">
          {!showSaveDialog ? (
            <button
              type="button"
              onClick={() => setShowSaveDialog(true)}
              className="qt-button-secondary qt-button-sm"
            >
              Save Current Outfit as Preset
            </button>
          ) : (
            <div className="qt-card space-y-3">
              <div>
                <label htmlFor="save-preset-name" className="qt-label mb-1">
                  Preset Name *
                </label>
                <input
                  type="text"
                  id="save-preset-name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Name for this outfit"
                  className="qt-input"
                />
              </div>
              <div>
                <label htmlFor="save-preset-desc" className="qt-label mb-1">
                  Description
                </label>
                <input
                  type="text"
                  id="save-preset-desc"
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  placeholder="Optional description"
                  className="qt-input"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowSaveDialog(false)}
                  className="qt-button-secondary qt-button-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveCurrentOutfit}
                  disabled={!saveName.trim() || savingCurrent}
                  className="qt-button-primary qt-button-sm"
                >
                  {savingCurrent ? 'Saving...' : 'Save Preset'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {presets.length === 0 ? (
        <EmptyState
          title="No outfit presets yet"
          description="Save outfit combinations as presets for quick switching"
          variant="dashed"
          action={{
            label: 'New Preset',
            onClick: handleCreate,
          }}
        />
      ) : (
        <div className="space-y-3">
          {presets.map((preset) => (
            <OutfitPresetCard
              key={preset.id}
              preset={preset}
              itemMap={itemMap}
              onApply={onApply}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isDeleting={deletingId === preset.id}
              showApply={!!chatId && !!onApply}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <PresetEditor
          characterId={characterId}
          preset={editingItem}
          wardrobeItems={wardrobeItems}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}
    </div>
  )
}
