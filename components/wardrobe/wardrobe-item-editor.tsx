'use client'

import { useEffect, useMemo, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import FormActions from '@/components/ui/FormActions'
import MessageContent from '@/components/chat/MessageContent'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { unionTypes } from '@/lib/wardrobe/composite-types'

interface WardrobeItemEditorProps {
  characterId: string
  item?: WardrobeItem | null
  /** Whether this item is being created/edited as a shared item */
  isShared?: boolean
  onClose: () => void
  onSave: () => void
}

/** A wardrobe item summary shape used by the components multi-select. */
interface CandidateItem {
  id: string
  title: string
  types: WardrobeItemType[]
  componentItemIds: string[]
  /** Whether this is a shared archetype (no characterId) */
  isShared: boolean
}

export function WardrobeItemEditor({
  characterId,
  item,
  isShared: isSharedProp = false,
  onClose,
  onSave,
}: WardrobeItemEditorProps) {
  const isEditing = !!item
  // Determine if the item is shared: either explicitly passed as shared,
  // or the existing item has no characterId (archetype)
  const existingIsShared = isEditing && !item.characterId
  const [isShared, setIsShared] = useState(isSharedProp || existingIsShared)

  const { formData, handleChange } = useFormState({
    title: item?.title || '',
    description: item?.description || '',
    appropriateness: item?.appropriateness || '',
    isDefault: item?.isDefault || false,
  })

  const [selectedTypes, setSelectedTypes] = useState<WardrobeItemType[]>(
    item?.types || []
  )
  const [componentItemIds, setComponentItemIds] = useState<string[]>(
    item?.componentItemIds ?? [],
  )
  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [componentSearch, setComponentSearch] = useState('')

  const { loading: saving, execute: executeSave, clearError } = useAsyncOperation<void>()
  const [showPreview, setShowPreview] = useState(false)

  // Load candidate items (this character's wardrobe + shared archetypes) so
  // the user can pick components for a composite. We do this once on mount;
  // adding fresh items mid-edit is rare and a re-open will refresh.
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setCandidatesLoading(true)
      try {
        const [personalRes, archetypeRes] = await Promise.all([
          fetch(`/api/v1/characters/${characterId}/wardrobe`),
          fetch('/api/v1/wardrobe'),
        ])

        const collected: CandidateItem[] = []
        if (personalRes.ok) {
          const data = (await personalRes.json()) as { wardrobeItems?: WardrobeItem[] }
          for (const w of data.wardrobeItems ?? []) {
            collected.push({
              id: w.id,
              title: w.title,
              types: w.types,
              componentItemIds: Array.isArray(w.componentItemIds) ? w.componentItemIds : [],
              isShared: false,
            })
          }
        }
        if (archetypeRes.ok) {
          const data = (await archetypeRes.json()) as { wardrobeItems?: WardrobeItem[] }
          for (const w of data.wardrobeItems ?? []) {
            if (!collected.some((c) => c.id === w.id)) {
              collected.push({
                id: w.id,
                title: w.title,
                types: w.types,
                componentItemIds: Array.isArray(w.componentItemIds) ? w.componentItemIds : [],
                isShared: true,
              })
            }
          }
        }
        if (!cancelled) setCandidates(collected)
      } catch (err) {
        if (!cancelled) {
          console.warn('[WardrobeItemEditor] Failed to load candidate items', err)
          setCandidates([])
        }
      } finally {
        if (!cancelled) setCandidatesLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [characterId])

  /**
   * Items the user can pick as components, excluding:
   *  - this item itself (self-reference is a trivial cycle)
   *  - items that already reference this item as a component (direct parents,
   *    which would make a cycle on save — server enforces this anyway)
   */
  const eligibleCandidates = useMemo<CandidateItem[]>(() => {
    const excluded = new Set<string>()
    if (item) {
      excluded.add(item.id)
      for (const c of candidates) {
        if (c.componentItemIds.includes(item.id)) excluded.add(c.id)
      }
    }
    const search = componentSearch.trim().toLowerCase()
    return candidates
      .filter((c) => !excluded.has(c.id))
      .filter((c) => (search ? c.title.toLowerCase().includes(search) : true))
  }, [candidates, item, componentSearch])

  const isComposite = componentItemIds.length > 0

  // Auto-compute types from components when composite. The server runs the
  // exact same union; we mirror it here so the UI always shows what's about
  // to be saved.
  const computedTypes = useMemo<WardrobeItemType[]>(() => {
    if (!isComposite) return selectedTypes
    const components = candidates.filter((c) => componentItemIds.includes(c.id))
    return unionTypes(components)
  }, [isComposite, candidates, componentItemIds, selectedTypes])

  const effectiveTypes = isComposite ? computedTypes : selectedTypes

  const handleTypeToggle = (type: WardrobeItemType): void => {
    if (isComposite) return
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    )
  }

  const toggleComponent = (id: string): void => {
    setComponentItemIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  const handleSave = async (): Promise<void> => {
    if (!isComposite && selectedTypes.length === 0) {
      showErrorToast('Please select at least one type')
      return
    }
    if (isComposite && computedTypes.length === 0) {
      showErrorToast('Selected components do not cover any slots')
      return
    }

    clearError()

    await executeSave(async () => {
      const payload: Record<string, unknown> = {
        title: formData.title,
        description: formData.description || null,
        types: effectiveTypes,
        appropriateness: formData.appropriateness || null,
        isDefault: formData.isDefault,
        componentItemIds,
      }

      // Route to the correct API endpoint based on shared status
      let url: string
      if (isShared) {
        const sharedBaseUrl = '/api/v1/wardrobe'
        url = isEditing ? `${sharedBaseUrl}/${item.id}` : sharedBaseUrl
      } else {
        const charBaseUrl = `/api/v1/characters/${characterId}/wardrobe`
        url = isEditing ? `${charBaseUrl}/${item.id}` : charBaseUrl
      }
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

  const charCountClass = (current: number, max: number): string => {
    if (current > max) return 'qt-text-destructive'
    if (current > max * 0.9) return 'qt-text-warning'
    return 'qt-text-secondary'
  }

  const selectedComponents = useMemo(() => {
    return componentItemIds
      .map((id) => candidates.find((c) => c.id === id))
      .filter((c): c is CandidateItem => Boolean(c))
  }, [candidates, componentItemIds])

  return (
    <>
      {/* Overlay — z values sit above the qt-dialog-overlay (z-[60]) so this
          editor always stacks on top when summoned from another dialog. */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-[70]"
        onClick={onClose}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog */}
      <div
        className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[80] pointer-events-auto"
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
            {/* Shared item notice */}
            {isShared && isEditing && (
              <div className="rounded border qt-border-warning/50 qt-bg-warning/10 px-3 py-2 qt-text-small qt-text-warning">
                Changes to shared items affect all characters
              </div>
            )}

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

            {/* Types (multi-select checkboxes — auto-computed for composites) */}
            <div>
              <span className="qt-label mb-2 block">
                Type(s) {isComposite ? '(auto from components)' : '*'}
              </span>
              <div className="flex flex-wrap gap-3">
                {WARDROBE_SLOT_TYPES.map((type) => {
                  const checked = effectiveTypes.includes(type)
                  return (
                    <label
                      key={type}
                      className={`inline-flex items-center gap-2 ${isComposite ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleTypeToggle(type)}
                        disabled={isComposite}
                        className="qt-checkbox"
                      />
                      <span className="text-sm capitalize text-foreground">{type}</span>
                    </label>
                  )
                })}
              </div>
              {isComposite ? (
                <p className="mt-1 text-xs qt-text-small">
                  Composite items inherit the union of their components&apos; slot types.
                </p>
              ) : (
                selectedTypes.length === 0 && (
                  <p className="mt-1 text-xs qt-text-destructive">
                    Select at least one type
                  </p>
                )
              )}
            </div>

            {/* Composes (composite components) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="qt-label">Composes</span>
                <span className="qt-text-xs qt-text-secondary">
                  {componentItemIds.length === 0
                    ? 'Leaf item'
                    : `Composite of ${componentItemIds.length}`}
                </span>
              </div>
              <p className="qt-text-xs qt-text-small mb-2">
                Bundle other items into this one — e.g., a &quot;Rain Outfit&quot; that pulls in
                a raincoat, jeans, and boots. Leave empty for a single garment.
              </p>

              {selectedComponents.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedComponents.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 rounded-full qt-bg-muted border qt-border-default px-2 py-0.5 qt-text-xs"
                    >
                      {c.title}
                      {c.isShared ? <span className="qt-text-secondary">(shared)</span> : null}
                      <button
                        type="button"
                        aria-label={`Remove ${c.title}`}
                        onClick={() => toggleComponent(c.id)}
                        className="qt-text-secondary hover:text-foreground"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <input
                type="search"
                value={componentSearch}
                onChange={(e) => setComponentSearch(e.target.value)}
                placeholder="Search items to add as components…"
                className="qt-input mb-2"
              />

              <div className="max-h-48 overflow-y-auto rounded border qt-border-default qt-bg-muted/40">
                {candidatesLoading ? (
                  <div className="px-3 py-2 qt-text-small qt-text-secondary">Loading…</div>
                ) : eligibleCandidates.length === 0 ? (
                  <div className="px-3 py-2 qt-text-small qt-text-secondary">
                    {candidates.length === 0
                      ? 'No other wardrobe items to bundle.'
                      : 'No candidates match your filter.'}
                  </div>
                ) : (
                  <ul className="divide-y qt-border-default">
                    {eligibleCandidates.map((c) => {
                      const checked = componentItemIds.includes(c.id)
                      return (
                        <li key={c.id}>
                          <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:qt-bg-muted">
                            <input
                              type="checkbox"
                              className="qt-checkbox"
                              checked={checked}
                              onChange={() => toggleComponent(c.id)}
                            />
                            <span className="flex-1 truncate text-sm text-foreground">
                              {c.title}
                              {c.isShared ? (
                                <span className="ml-1 qt-text-xs qt-text-secondary">(shared)</span>
                              ) : null}
                            </span>
                            <span className="qt-text-xs qt-text-secondary">
                              {c.types.join(', ')}
                              {c.componentItemIds.length > 0 ? ' · composite' : ''}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
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
                Default items make up this character&apos;s standard outfit when a chat starts.
              </p>
            </div>

            {/* Shared item checkbox */}
            <div>
              <label className={`inline-flex items-center gap-2 ${isEditing && !existingIsShared ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={isShared}
                  onChange={(e) => setIsShared(e.target.checked)}
                  disabled={isEditing && !existingIsShared}
                  className="qt-checkbox"
                />
                <span className="text-sm text-foreground">
                  Shared item (available to all characters)
                </span>
              </label>
              {isEditing && !existingIsShared && (
                <p className="mt-1 text-xs qt-text-muted">
                  Personal items cannot be converted to shared items
                </p>
              )}
              {!isEditing && isShared && (
                <p className="mt-1 text-xs qt-text-small">
                  This item will be available to all characters
                </p>
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
              isDisabled={
                !formData.title.trim() ||
                (!isComposite && selectedTypes.length === 0) ||
                (isComposite && computedTypes.length === 0)
              }
            />
          </div>
        </div>
      </div>
    </>
  )
}
