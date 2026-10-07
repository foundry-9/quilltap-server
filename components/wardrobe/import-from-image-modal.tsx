'use client'

/**
 * Import From Image Modal
 *
 * A three-state modal for importing wardrobe items from a reference image:
 * 1. Upload state — file picker, optional guidance notes, "Analyze" button
 * 2. Analyzing state — loading spinner while LLM processes the image
 * 3. Review state — editable item cards with select/deselect, "Import Selected" button,
 *    plus an optional ensemble card that bundles the imported pieces into one
 *    composite outfit. The pieces are created first; their returned ids become
 *    the outfit's `componentItemIds`, so nothing needs an id assigned up front.
 *
 * Unless the operator declines, the photograph itself is attached to every
 * piece (and the outfit) as its first picture, `kind=imported`. The server
 * de-duplicates the bytes, so N pieces share one blob behind N links. A
 * failed attachment never aborts the import — the garment stands without it.
 *
 * @module components/wardrobe/import-from-image-modal
 */

import { useState, useRef, useCallback } from 'react'
import { Icon } from '@/components/ui/icon'
import { showErrorToast, showSuccessToast, showWarningToast } from '@/lib/toast'
import { fetchJson } from '@/lib/fetch-helpers'
import FormActions from '@/components/ui/FormActions'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { unionTypes } from '@/lib/wardrobe/composite-types'
import { uploadWardrobeItemImage } from '@/lib/wardrobe/item-images-client'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'

// ============================================================================
// TYPES
// ============================================================================

interface ImportFromImageModalProps {
  characterId: string
  onClose: () => void
  onImported: () => void
}

interface ProposedItem {
  title: string
  description: string
  types: WardrobeItemType[]
  appropriateness: string
  selected: boolean
}

interface ProposedOutfit {
  title: string
  description: string
  appropriateness: string
}

interface OutfitDraft extends ProposedOutfit {
  enabled: boolean
  /** Composite equip behaviour — on by default, since this is a whole look. */
  replace: boolean
}

type ModalState = 'upload' | 'analyzing' | 'review'

/** An ensemble needs at least two pieces to be worth bundling. */
const MIN_OUTFIT_PIECES = 2

const EMPTY_OUTFIT: OutfitDraft = {
  enabled: false,
  title: '',
  description: '',
  appropriateness: '',
  replace: true,
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

// ============================================================================
// COMPONENT
// ============================================================================

export function ImportFromImageModal({
  characterId,
  onClose,
  onImported,
}: ImportFromImageModalProps) {
  const [state, setState] = useState<ModalState>('upload')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [guidance, setGuidance] = useState('')
  const [proposedItems, setProposedItems] = useState<ProposedItem[]>([])
  const [outfit, setOutfit] = useState<OutfitDraft>(EMPTY_OUTFIT)
  const [importing, setImporting] = useState(false)
  /** Keep the photograph as each created piece's first picture. */
  const [keepPhotograph, setKeepPhotograph] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── File Selection ──────────────────────────────────────────────────────

  const handleFileSelect = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      showErrorToast('Unsupported file type. Use JPEG, PNG, WebP, or GIF.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      showErrorToast('Image is too large. Maximum file size is 10 MB.')
      return
    }

    setSelectedFile(file)
    setError(null)

    // Create preview
    const reader = new FileReader()
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // ── Image Analysis ──────────────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) return

    setState('analyzing')
    setError(null)

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          // Strip the data URL prefix to get raw base64
          const base64Data = result.split(',')[1]
          resolve(base64Data)
        }
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(selectedFile)
      })

      const result = await fetchJson<{
        proposedItems: Array<{
          title: string
          description: string
          types: WardrobeItemType[]
          appropriateness: string
        }>
        proposedOutfit: ProposedOutfit | null
        provider: string
        model: string
      }>('/api/v1/wardrobe/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64,
          mimeType: selectedFile.type,
          guidance: guidance.trim() || undefined,
        }),
      })

      if (!result.ok || !result.data) {
        throw new Error(result.error || 'Analysis failed')
      }

      const items = result.data.proposedItems
      if (items.length === 0) {
        setError('No clothing items were identified in this image. Try a different image or add guidance notes.')
        setState('upload')
        return
      }

      setProposedItems(items.map(item => ({ ...item, selected: true })))
      const proposedOutfit = result.data.proposedOutfit
      setOutfit(
        proposedOutfit && items.length >= MIN_OUTFIT_PIECES
          ? { ...EMPTY_OUTFIT, ...proposedOutfit, enabled: true }
          : EMPTY_OUTFIT
      )
      setState('review')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed'
      setError(message)
      setState('upload')
    }
  }, [selectedFile, guidance])

  // ── Item Editing ────────────────────────────────────────────────────────

  const updateItem = useCallback((index: number, updates: Partial<ProposedItem>) => {
    setProposedItems(prev => prev.map((item, i) =>
      i === index ? { ...item, ...updates } : item
    ))
  }, [])

  const toggleItemType = useCallback((index: number, type: WardrobeItemType) => {
    setProposedItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      const types = item.types.includes(type)
        ? item.types.filter(t => t !== type)
        : [...item.types, type]
      return { ...item, types: types.length > 0 ? types : [type] }
    }))
  }, [])

  // ── Import ──────────────────────────────────────────────────────────────

  const selectedCount = proposedItems.filter(i => i.selected).length
  const outfitAvailable = selectedCount >= MIN_OUTFIT_PIECES
  const willCreateOutfit = outfitAvailable && outfit.enabled
  const outfitTitleMissing = willCreateOutfit && outfit.title.trim().length === 0

  const handleImport = useCallback(async () => {
    const itemsToImport = proposedItems.filter(i => i.selected)
    if (itemsToImport.length === 0) return

    setImporting(true)

    // Every create below posts to the character's own wardrobe, so that is
    // the container each new piece (and the outfit) lives in.
    const container: WardrobeContainer = { scope: 'character', id: characterId }
    const photograph = keepPhotograph ? selectedFile : null
    let pictureFailures = 0

    /** Attach the photograph to a freshly created item; never throws. */
    const attachPhotograph = async (itemId: string, title: string): Promise<void> => {
      if (!photograph) return
      try {
        await uploadWardrobeItemImage(itemId, container, photograph, 'imported')
      } catch (err) {
        pictureFailures += 1
        console.warn(
          '[ImportFromImageModal] Failed to attach the photograph to item:',
          title,
          err instanceof Error ? err.message : err,
        )
      }
    }

    try {
      const created: WardrobeItem[] = []

      for (const item of itemsToImport) {
        const result = await fetchJson<{ wardrobeItem: WardrobeItem }>(
          `/api/v1/characters/${characterId}/wardrobe`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: item.title,
              description: item.description || null,
              types: item.types,
              appropriateness: item.appropriateness || null,
              isDefault: false,
            }),
          }
        )

        if (result.ok && result.data?.wardrobeItem) {
          created.push(result.data.wardrobeItem)
          await attachPhotograph(result.data.wardrobeItem.id, item.title)
        } else {
          console.warn('[ImportFromImageModal] Failed to create item:', item.title, result.error)
        }
      }

      if (created.length === 0) {
        showErrorToast('Failed to import wardrobe items')
        return
      }

      const importedCount = created.length
      showSuccessToast(
        importedCount === 1
          ? '1 wardrobe item imported from image'
          : `${importedCount} wardrobe items imported from image`
      )

      // Bundle whichever pieces actually landed. Their ids come back from the
      // create calls above; the outfit's coverage is their slot union, exactly
      // as the item editor computes it for a hand-built bundle.
      if (willCreateOutfit && created.length >= MIN_OUTFIT_PIECES) {
        const outfitResult = await fetchJson<{ wardrobeItem: WardrobeItem }>(
          `/api/v1/characters/${characterId}/wardrobe`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: outfit.title.trim(),
              description: outfit.description.trim() || null,
              types: unionTypes(created),
              appropriateness: outfit.appropriateness.trim() || null,
              componentItemIds: created.map(c => c.id),
              replace: outfit.replace,
              isDefault: false,
            }),
          }
        )
        if (outfitResult.ok) {
          if (outfitResult.data?.wardrobeItem) {
            await attachPhotograph(outfitResult.data.wardrobeItem.id, outfit.title.trim())
          }
          showSuccessToast(`Outfit "${outfit.title.trim()}" assembled from ${created.length} pieces`)
        } else {
          console.warn('[ImportFromImageModal] Failed to create outfit:', outfit.title, outfitResult.error)
          showErrorToast('The pieces were imported, but the outfit could not be assembled')
        }
      } else if (willCreateOutfit) {
        showErrorToast('Too few pieces were imported to assemble an outfit')
      }

      if (pictureFailures > 0) {
        showWarningToast(
          pictureFailures === 1
            ? 'One piece arrived without its photograph; the darkroom mislaid it. You may attach it by hand.'
            : `${pictureFailures} pieces arrived without their photograph; the darkroom mislaid them. You may attach it by hand.`
        )
      }

      onImported()
      onClose()
    } catch (err) {
      showErrorToast('Failed to import wardrobe items')
    } finally {
      setImporting(false)
    }
  }, [proposedItems, characterId, onImported, onClose, willCreateOutfit, outfit, keepPhotograph, selectedFile])

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay — z values sit above qt-dialog-overlay (z-[60]) so this
          stacks on top of the parent wardrobe dialog. */}
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
          {/* Header */}
          <div className="qt-dialog-header sticky top-0 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">Import from Image</h2>
              <button
                type="button"
                onClick={onClose}
                className="qt-text-secondary hover:text-foreground"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="qt-dialog-body space-y-4 flex-1">
            {/* Error display */}
            {error && (
              <div className="qt-alert-error rounded px-3 py-2 text-sm">
                {error}
              </div>
            )}

            {/* ── Upload State ─────────────────────────────────────── */}
            {(state === 'upload' || state === 'analyzing') && (
              <>
                {/* Image preview or drop zone */}
                {imagePreview ? (
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="Selected reference image"
                      className="w-full max-h-64 object-contain rounded border qt-border-default"
                    />
                    {state === 'upload' && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFile(null)
                          setImagePreview(null)
                        }}
                        className="absolute top-2 right-2 qt-button-secondary qt-button-sm !px-2"
                        title="Remove image"
                      >
                        <Icon name="close" className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed qt-border-default rounded-lg p-8 text-center cursor-pointer hover:qt-border-primary transition-colors"
                  >
                    <Icon name="image" className="w-12 h-12 mx-auto qt-text-secondary mb-3" />
                    <p className="text-sm text-foreground mb-1">
                      Drop an image here or click to browse
                    </p>
                    <p className="text-xs qt-text-secondary">
                      JPEG, PNG, WebP, or GIF up to 10 MB
                    </p>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(',')}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileSelect(file)
                  }}
                  className="hidden"
                />

                {/* Guidance notes */}
                <div>
                  <label htmlFor="wardrobe-image-guidance" className="qt-label mb-1">
                    Hints for the AI (optional)
                  </label>
                  <textarea
                    id="wardrobe-image-guidance"
                    value={guidance}
                    onChange={(e) => setGuidance(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    disabled={state === 'analyzing'}
                    placeholder='Anything specific to focus on or avoid? e.g., "the woman on the left", "ignore the background", "this is a medieval setting"'
                    className="qt-textarea text-sm"
                  />
                </div>

                {/* Analyzing indicator */}
                {state === 'analyzing' && (
                  <div className="flex items-center gap-3 px-3 py-2 rounded qt-bg-muted">
                    <svg className="w-5 h-5 animate-spin qt-text-primary" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                    </svg>
                    <span className="text-sm qt-text-secondary">
                      Scanning image for clothing and accessories...
                    </span>
                  </div>
                )}
              </>
            )}

            {/* ── Review State ─────────────────────────────────────── */}
            {state === 'review' && (
              <>
                {/* Reference image thumbnail */}
                {imagePreview && (
                  <div className="flex items-start gap-3">
                    <img
                      src={imagePreview}
                      alt="Reference image"
                      className="w-20 h-20 object-cover rounded border qt-border-default flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">
                        {proposedItems.length} item{proposedItems.length !== 1 ? 's' : ''} identified
                      </p>
                      <p className="text-xs qt-text-secondary mt-1">
                        Edit any field below before importing. Deselect items you don&apos;t want.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setState('upload')
                        setProposedItems([])
                        setOutfit(EMPTY_OUTFIT)
                        setError(null)
                      }}
                      className="qt-button-secondary qt-button-sm flex-shrink-0"
                    >
                      Re-analyze
                    </button>
                  </div>
                )}

                {/* Keep the photograph as each piece's first picture */}
                <label className="flex items-start gap-3 cursor-pointer px-3 py-2 rounded qt-bg-muted">
                  <input
                    type="checkbox"
                    checked={keepPhotograph}
                    onChange={(e) => setKeepPhotograph(e.target.checked)}
                    className="qt-checkbox mt-0.5"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="text-sm text-foreground block">
                      The photograph will be kept as each piece&apos;s first picture
                    </span>
                    <span className="text-xs qt-text-secondary block mt-0.5">
                      Pressed into every garment&apos;s album, and the outfit&apos;s too. Untick it to leave the albums blank.
                    </span>
                  </span>
                </label>

                {/* Item cards */}
                <div className="space-y-4">
                  {proposedItems.map((item, index) => (
                    <div
                      key={index}
                      className={`border qt-border-default rounded-lg p-4 space-y-3 transition-opacity ${
                        item.selected ? '' : 'opacity-50'
                      }`}
                    >
                      {/* Select checkbox + title */}
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={(e) => updateItem(index, { selected: e.target.checked })}
                          aria-label={`Import ${item.title || 'this item'}`}
                          className="qt-checkbox mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            value={item.title}
                            onChange={(e) => updateItem(index, { title: e.target.value })}
                            className="qt-input text-sm font-medium w-full"
                            placeholder="Item title"
                          />
                        </div>
                      </div>

                      {item.selected && (
                        <>
                          {/* Types */}
                          <div className="ml-8">
                            <span className="qt-label text-xs mb-1 block">Type(s)</span>
                            <div className="flex flex-wrap gap-2">
                              {WARDROBE_SLOT_TYPES.map((type) => (
                                <label
                                  key={type}
                                  className="inline-flex items-center gap-1.5 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={item.types.includes(type)}
                                    onChange={() => toggleItemType(index, type)}
                                    className="qt-checkbox"
                                  />
                                  <span className="text-xs capitalize text-foreground">{type}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* Appropriateness */}
                          <div className="ml-8">
                            <label className="qt-label text-xs mb-1 block">
                              Appropriateness
                            </label>
                            <input
                              type="text"
                              value={item.appropriateness}
                              onChange={(e) => updateItem(index, { appropriateness: e.target.value })}
                              className="qt-input text-sm w-full"
                              placeholder="e.g., formal, casual, intimate"
                              maxLength={200}
                            />
                          </div>

                          {/* Description */}
                          <div className="ml-8">
                            <label className="qt-label text-xs mb-1 block">
                              Description
                            </label>
                            <textarea
                              value={item.description}
                              onChange={(e) => updateItem(index, { description: e.target.value })}
                              rows={3}
                              className="qt-textarea text-sm w-full"
                              placeholder="Item description..."
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Ensemble — bundles the imported pieces into one outfit */}
                <div
                  className={`border qt-border-default rounded-lg p-4 space-y-3 transition-opacity ${
                    willCreateOutfit ? '' : 'opacity-50'
                  }`}
                >
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={willCreateOutfit}
                      disabled={!outfitAvailable}
                      onChange={(e) => setOutfit(prev => ({ ...prev, enabled: e.target.checked }))}
                      className="qt-checkbox mt-1"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground block">
                        Also create an outfit from these pieces
                      </span>
                      <span className="text-xs qt-text-secondary block mt-0.5">
                        {outfitAvailable
                          ? `Bundles the ${selectedCount} selected items into a single outfit you can wear in one gesture.`
                          : 'Select at least two items to bundle them into an outfit.'}
                      </span>
                    </span>
                  </label>

                  {willCreateOutfit && (
                    <>
                      <div className="ml-8">
                        <label htmlFor="wardrobe-image-outfit-title" className="qt-label text-xs mb-1 block">
                          Outfit title
                        </label>
                        <input
                          id="wardrobe-image-outfit-title"
                          type="text"
                          value={outfit.title}
                          onChange={(e) => setOutfit(prev => ({ ...prev, title: e.target.value }))}
                          className="qt-input text-sm font-medium w-full"
                          placeholder="e.g., Midnight Gala Ensemble"
                        />
                      </div>

                      <div className="ml-8">
                        <label htmlFor="wardrobe-image-outfit-appropriateness" className="qt-label text-xs mb-1 block">
                          Appropriateness
                        </label>
                        <input
                          id="wardrobe-image-outfit-appropriateness"
                          type="text"
                          value={outfit.appropriateness}
                          onChange={(e) => setOutfit(prev => ({ ...prev, appropriateness: e.target.value }))}
                          className="qt-input text-sm w-full"
                          placeholder="e.g., formal, evening"
                          maxLength={200}
                        />
                      </div>

                      <div className="ml-8">
                        <label htmlFor="wardrobe-image-outfit-description" className="qt-label text-xs mb-1 block">
                          Description
                        </label>
                        <textarea
                          id="wardrobe-image-outfit-description"
                          value={outfit.description}
                          onChange={(e) => setOutfit(prev => ({ ...prev, description: e.target.value }))}
                          rows={2}
                          className="qt-textarea text-sm w-full"
                          placeholder="The overall look..."
                        />
                      </div>

                      <label className="ml-8 flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={outfit.replace}
                          onChange={(e) => setOutfit(prev => ({ ...prev, replace: e.target.checked }))}
                          className="qt-checkbox mt-0.5"
                        />
                        <span className="text-sm text-foreground">
                          Replace everything in its slots when worn
                          <span className="block text-xs qt-text-secondary">
                            Off layers the pieces over whatever is already on.
                          </span>
                        </span>
                      </label>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer flex-shrink-0">
            {state === 'upload' && (
              <FormActions
                onCancel={onClose}
                onSubmit={handleAnalyze}
                submitLabel="Analyze Image"
                cancelLabel="Cancel"
                isDisabled={!selectedFile}
              />
            )}
            {state === 'analyzing' && (
              <FormActions
                onCancel={() => {
                  setState('upload')
                  setError(null)
                }}
                onSubmit={() => {}}
                submitLabel="Analyzing..."
                cancelLabel="Cancel"
                isLoading={true}
                isDisabled={true}
              />
            )}
            {state === 'review' && (
              <FormActions
                onCancel={onClose}
                onSubmit={handleImport}
                submitLabel={`Import ${selectedCount} Item${selectedCount !== 1 ? 's' : ''}${willCreateOutfit ? ' + Outfit' : ''}`}
                cancelLabel="Cancel"
                isLoading={importing}
                isDisabled={selectedCount === 0 || outfitTitleMissing}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
