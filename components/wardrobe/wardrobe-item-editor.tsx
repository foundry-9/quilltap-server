'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import FormActions from '@/components/ui/FormActions'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { unionTypes } from '@/lib/wardrobe/composite-types'
import { charCountClass } from '@/lib/utils/char-count'

type EditorMode = 'single' | 'bundle'

interface WardrobeItemEditorProps {
  characterId: string
  item?: WardrobeItem | null
  /** Whether this item is being created/edited as a shared item */
  isShared?: boolean
  /** Pre-populated component IDs (used by Save-as-outfit from the Outfit Builder). */
  initialComponentItemIds?: string[]
  /** Force a starting mode (used by Save-as-outfit to open in bundle mode). */
  initialMode?: EditorMode
  /** Focus the title field on mount (used by Save-as-outfit). */
  autoFocusTitle?: boolean
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

type CandidateGroup = 'top' | 'bottom' | 'footwear' | 'accessories' | 'multi'

const GROUP_LABEL: Record<CandidateGroup, string> = {
  top: 'Tops',
  bottom: 'Bottoms',
  footwear: 'Footwear',
  accessories: 'Accessories',
  multi: 'Multi-slot',
}

const GROUP_ORDER: CandidateGroup[] = ['top', 'bottom', 'footwear', 'accessories', 'multi']

const TYPE_BADGE_CLASS: Record<WardrobeItemType, string> = {
  top: 'qt-badge-wardrobe-top',
  bottom: 'qt-badge-wardrobe-bottom',
  footwear: 'qt-badge-wardrobe-footwear',
  accessories: 'qt-badge-wardrobe-accessories',
}

function getCandidateGroup(c: CandidateItem): CandidateGroup {
  if (c.types.length > 1) return 'multi'
  return (c.types[0] as CandidateGroup) ?? 'multi'
}

export function WardrobeItemEditor({
  characterId,
  item,
  isShared: isSharedProp = false,
  initialComponentItemIds,
  initialMode,
  autoFocusTitle = false,
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
    initialComponentItemIds ?? item?.componentItemIds ?? [],
  )
  // Editor mode is independent of `componentItemIds` so the user can switch
  // between single garment and outfit bundle without immediately mutating
  // the data. The toggle handler enforces consistency on transitions.
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    if (initialMode) return initialMode
    const seedComponents = initialComponentItemIds ?? item?.componentItemIds ?? []
    if (seedComponents.length > 0) return 'bundle'
    return 'single'
  })

  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [componentSearch, setComponentSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<CandidateGroup>>(
    () => new Set<CandidateGroup>(GROUP_ORDER),
  )

  // Validation timing: errors only after submit attempt or focus-then-blur.
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [touched, setTouched] = useState<{
    title?: boolean
    types?: boolean
    components?: boolean
  }>({})

  // Confirmation modal for bundle → single with components present.
  const [showKeepResetPrompt, setShowKeepResetPrompt] = useState(false)

  const { loading: saving, execute: executeSave, clearError } = useAsyncOperation<void>()

  // Adapter so MarkdownLexicalEditor's (value: string) => void onChange feeds
  // useFormState's event-based handleChange.
  const handleMarkdownDescriptionChange = (value: string) => {
    handleChange({
      target: { name: 'description', value },
    } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
  }

  const titleInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocusTitle) titleInputRef.current?.focus()
  }, [autoFocusTitle])

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

  const groupedCandidates = useMemo(() => {
    const map = new Map<CandidateGroup, CandidateItem[]>()
    for (const g of GROUP_ORDER) map.set(g, [])
    for (const c of eligibleCandidates) {
      const group = getCandidateGroup(c)
      map.get(group)!.push(c)
    }
    return map
  }, [eligibleCandidates])

  const isBundle = editorMode === 'bundle'
  const hasComponents = componentItemIds.length > 0

  // Auto-compute types from components when in bundle mode with components.
  // The server runs the exact same union; we mirror it here so the UI always
  // shows what's about to be saved.
  const computedTypes = useMemo<WardrobeItemType[]>(() => {
    if (componentItemIds.length === 0) return []
    const components = candidates.filter((c) => componentItemIds.includes(c.id))
    return unionTypes(components)
  }, [candidates, componentItemIds])

  // In bundle mode, show computed types once any component is added; otherwise
  // preserve the previously-selected types as a hint of what coverage is
  // intended. In single mode, types are always user-selected.
  const effectiveTypes = isBundle
    ? hasComponents
      ? computedTypes
      : selectedTypes
    : selectedTypes

  const handleTypeToggle = (type: WardrobeItemType): void => {
    if (isBundle) return
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    )
  }

  const toggleComponent = (id: string): void => {
    setComponentItemIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  const toggleGroup = (group: CandidateGroup): void => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const handleModeChange = (next: EditorMode): void => {
    if (next === editorMode) return
    if (next === 'single' && componentItemIds.length > 0) {
      // Need explicit decision about what to do with the existing components
      // and their derived types.
      setShowKeepResetPrompt(true)
      return
    }
    setEditorMode(next)
  }

  const handleConfirmKeepTypes = (): void => {
    // Drop the components but lock in the types they had been computing.
    setSelectedTypes(computedTypes)
    setComponentItemIds([])
    setEditorMode('single')
    setShowKeepResetPrompt(false)
  }

  const handleConfirmReset = (): void => {
    setSelectedTypes([])
    setComponentItemIds([])
    setEditorMode('single')
    setShowKeepResetPrompt(false)
  }

  // Validation flags — surfaced only after submit attempt or field blur.
  const showTitleError =
    !formData.title.trim() && (submitAttempted || !!touched.title)
  const showTypesError =
    !isBundle &&
    selectedTypes.length === 0 &&
    (submitAttempted || !!touched.types)
  const showComponentsError =
    isBundle &&
    componentItemIds.length === 0 &&
    (submitAttempted || !!touched.components)

  const isSaveDisabled =
    !formData.title.trim() ||
    (!isBundle && selectedTypes.length === 0) ||
    (isBundle && componentItemIds.length === 0)

  const handleSave = async (): Promise<void> => {
    setSubmitAttempted(true)
    if (!formData.title.trim()) {
      showErrorToast('Enter a title')
      return
    }
    if (!isBundle && selectedTypes.length === 0) {
      showErrorToast('Select at least one type')
      return
    }
    if (isBundle && componentItemIds.length === 0) {
      showErrorToast('Add at least one component')
      return
    }
    if (isBundle && computedTypes.length === 0) {
      showErrorToast('Selected components do not cover any slots')
      return
    }

    clearError()

    await executeSave(async () => {
      const typesToSave = isBundle ? computedTypes : selectedTypes
      const componentsToSave = isBundle ? componentItemIds : []

      const payload: Record<string, unknown> = {
        title: formData.title,
        description: formData.description || null,
        types: typesToSave,
        appropriateness: formData.appropriateness || null,
        isDefault: formData.isDefault,
        componentItemIds: componentsToSave,
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
          <div className="qt-dialog-header sticky top-0 flex-shrink-0 qt-bg-default border-b qt-border-default">
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
            {/* Mode toggle — Single garment vs. Outfit bundle */}
            <div
              role="tablist"
              aria-label="Wardrobe item kind"
              className="inline-flex gap-1 qt-bg-muted/50 rounded-lg p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={editorMode === 'single'}
                onClick={() => handleModeChange('single')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  editorMode === 'single'
                    ? 'qt-bg-default text-foreground shadow-sm'
                    : 'qt-text-secondary hover:text-foreground'
                }`}
              >
                Single garment
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editorMode === 'bundle'}
                onClick={() => handleModeChange('bundle')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  editorMode === 'bundle'
                    ? 'qt-bg-default text-foreground shadow-sm'
                    : 'qt-text-secondary hover:text-foreground'
                }`}
              >
                Outfit bundle
              </button>
            </div>

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
                ref={titleInputRef}
                type="text"
                id="wardrobe-title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                required
                placeholder={
                  isBundle
                    ? 'e.g., Working Outfit, Sunday Best'
                    : 'e.g., Charcoal Sweater'
                }
                className="qt-input"
              />
              {showTitleError && (
                <p className="mt-1 text-xs qt-text-destructive">Enter a title</p>
              )}
            </div>

            {/* Single mode: Types checkboxes */}
            {!isBundle && (
              <div>
                <span className="qt-label mb-2 block">Type(s) *</span>
                <div
                  className="flex flex-wrap gap-3"
                  onBlur={() => setTouched((t) => ({ ...t, types: true }))}
                >
                  {WARDROBE_SLOT_TYPES.map((type) => {
                    const checked = selectedTypes.includes(type)
                    return (
                      <label
                        key={type}
                        className="inline-flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleTypeToggle(type)}
                          className="qt-checkbox"
                        />
                        <span className="text-sm capitalize text-foreground">{type}</span>
                      </label>
                    )
                  })}
                </div>
                {showTypesError && (
                  <p className="mt-1 text-xs qt-text-destructive">
                    Select at least one type
                  </p>
                )}
              </div>
            )}

            {/* Bundle mode: Components section */}
            {isBundle && (
              <div>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="qt-label">
                    Components <span className="qt-text-xs qt-text-secondary">(auto types)</span>
                  </span>
                  <div className="flex items-center gap-1 flex-wrap">
                    {effectiveTypes.length === 0 ? (
                      <span className="qt-text-xs qt-text-secondary italic">
                        no slots covered yet
                      </span>
                    ) : (
                      effectiveTypes.map((t) => (
                        <span
                          key={t}
                          className={`qt-badge ${TYPE_BADGE_CLASS[t]} qt-text-xs uppercase`}
                        >
                          {t}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <p className="qt-text-xs qt-text-small mb-2">
                  Pick the items this outfit bundles together.
                </p>

                {selectedComponents.length > 0 && (
                  <div className="mb-2">
                    <p className="qt-text-xs qt-text-secondary mb-1">
                      Currently in this outfit:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedComponents.map((c) => (
                        <span
                          key={c.id}
                          className="inline-flex items-center gap-1 rounded-full qt-bg-muted border qt-border-default px-2 py-0.5 qt-text-xs"
                        >
                          {c.title}
                          {c.isShared ? (
                            <span className="qt-badge qt-badge-info qt-text-xs ml-1">
                              shared
                            </span>
                          ) : null}
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
                  </div>
                )}

                <input
                  type="search"
                  value={componentSearch}
                  onChange={(e) => setComponentSearch(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, components: true }))}
                  placeholder="Search items to add as components…"
                  className="qt-input mb-2"
                />

                <div className="max-h-64 overflow-y-auto rounded border qt-border-default qt-bg-muted/40">
                  {candidatesLoading ? (
                    <div className="px-3 py-2 qt-text-small qt-text-secondary">
                      Loading…
                    </div>
                  ) : eligibleCandidates.length === 0 ? (
                    <div className="px-3 py-2 qt-text-small qt-text-secondary">
                      {candidates.length === 0
                        ? 'No other wardrobe items to bundle.'
                        : 'No candidates match your filter.'}
                    </div>
                  ) : (
                    GROUP_ORDER.map((group) => {
                      const items = groupedCandidates.get(group) ?? []
                      if (items.length === 0) return null
                      const expanded = expandedGroups.has(group)
                      return (
                        <div key={group}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group)}
                            className="w-full flex items-center justify-between px-3 py-1.5 qt-bg-muted/60 hover:qt-bg-muted text-sm font-medium qt-text-primary"
                          >
                            <span className="flex items-center gap-2">
                              <span aria-hidden="true">{expanded ? '▼' : '▶'}</span>
                              <span>{GROUP_LABEL[group]}</span>
                              <span className="qt-text-xs qt-text-secondary">
                                ({items.length})
                              </span>
                            </span>
                          </button>
                          {expanded && (
                            <ul className="divide-y qt-border-default">
                              {items.map((c) => {
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
                                          <span className="ml-1 qt-badge qt-badge-info qt-text-xs">
                                            shared
                                          </span>
                                        ) : null}
                                      </span>
                                      <span className="qt-text-xs qt-text-secondary">
                                        {c.types.join(', ')}
                                        {c.componentItemIds.length > 0 ? ' · bundle' : ''}
                                      </span>
                                    </label>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
                {showComponentsError && (
                  <p className="mt-1 text-xs qt-text-destructive">
                    Add at least one component
                  </p>
                )}
              </div>
            )}

            {/* Default + Shared compact row — moved up so they're visible on first screen */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="inline-flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="isDefault"
                  checked={formData.isDefault}
                  onChange={handleChange}
                  className="qt-checkbox mt-0.5"
                />
                <span className="text-sm text-foreground">
                  Part of this character&apos;s default outfit
                </span>
              </label>
              <label
                className={`inline-flex items-start gap-2 ${
                  isEditing && !existingIsShared
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isShared}
                  onChange={(e) => setIsShared(e.target.checked)}
                  disabled={isEditing && !existingIsShared}
                  className="qt-checkbox mt-0.5"
                />
                <span className="text-sm text-foreground">
                  Available to all characters
                  {isEditing && !existingIsShared && (
                    <span className="block qt-text-xs qt-text-muted">
                      personal items can&apos;t be converted to shared
                    </span>
                  )}
                </span>
              </label>
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
                When is this appropriate to wear? e.g., formal, casual, intimate, combat.
              </p>
            </div>

            {/* Description (Markdown) */}
            <div>
              <label htmlFor="wardrobe-description" className="block text-sm qt-text-primary mb-1">
                Description
              </label>
              <p className="text-xs qt-text-secondary mb-2">
                Describe the item in detail.
              </p>
              <MarkdownLexicalEditor
                value={formData.description}
                onChange={handleMarkdownDescriptionChange}
                namespace="WardrobeItem.description"
                ariaLabel="Wardrobe item description"
                minHeight="10rem"
              />
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
              isDisabled={isSaveDisabled}
            />
          </div>
        </div>
      </div>

      {/* Bundle → Single confirmation prompt */}
      {showKeepResetPrompt && (
        <>
          <button
            className="qt-dialog-overlay !p-0 cursor-default border-none z-[90]"
            onClick={() => setShowKeepResetPrompt(false)}
            aria-label="Cancel"
            type="button"
          />
          <div
            className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[100] pointer-events-auto"
            style={{ width: 'min(420px, calc(100vw - 2rem))' }}
          >
            <div className="qt-dialog">
              <div className="qt-dialog-header">
                <h3 className="qt-dialog-title">Switch to a single garment?</h3>
              </div>
              <div className="qt-dialog-body">
                <p className="qt-text-small">
                  This will discard the {componentItemIds.length} component
                  {componentItemIds.length === 1 ? '' : 's'}. Keep types as they are
                  now, or reset?
                </p>
              </div>
              <div className="qt-dialog-footer flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowKeepResetPrompt(false)}
                  className="qt-button-ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReset}
                  className="qt-button-secondary"
                >
                  Reset types
                </button>
                <button
                  type="button"
                  onClick={handleConfirmKeepTypes}
                  className="qt-button-primary"
                >
                  Keep types
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
