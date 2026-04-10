'use client'

/**
 * Import From Image Modal
 *
 * A three-state modal for importing wardrobe items from a reference image:
 * 1. Upload state — file picker, optional guidance notes, "Analyze" button
 * 2. Analyzing state — loading spinner while LLM processes the image
 * 3. Review state — editable item cards with select/deselect, "Import Selected" button
 *
 * @module components/wardrobe/import-from-image-modal
 */

import { useState, useRef, useCallback } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { fetchJson } from '@/lib/fetch-helpers'
import FormActions from '@/components/ui/FormActions'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

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

type ModalState = 'upload' | 'analyzing' | 'review'

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
  const [importing, setImporting] = useState(false)
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

  const handleImport = useCallback(async () => {
    const itemsToImport = proposedItems.filter(i => i.selected)
    if (itemsToImport.length === 0) return

    setImporting(true)

    try {
      let importedCount = 0

      for (const item of itemsToImport) {
        const result = await fetchJson(
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

        if (result.ok) {
          importedCount++
        } else {
          console.warn('[ImportFromImageModal] Failed to create item:', item.title, result.error)
        }
      }

      if (importedCount > 0) {
        showSuccessToast(
          importedCount === 1
            ? '1 wardrobe item imported from image'
            : `${importedCount} wardrobe items imported from image`
        )
        onImported()
        onClose()
      } else {
        showErrorToast('Failed to import wardrobe items')
      }
    } catch (err) {
      showErrorToast('Failed to import wardrobe items')
    } finally {
      setImporting(false)
    }
  }, [proposedItems, characterId, onImported, onClose])

  // ── Render ──────────────────────────────────────────────────────────────

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
          {/* Header */}
          <div className="qt-dialog-header sticky top-0 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">Import from Image</h2>
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
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
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
                    <svg
                      className="w-12 h-12 mx-auto qt-text-secondary mb-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
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
                    Guidance Notes (optional)
                  </label>
                  <textarea
                    id="wardrobe-image-guidance"
                    value={guidance}
                    onChange={(e) => setGuidance(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    disabled={state === 'analyzing'}
                    placeholder='e.g., "Focus on the woman on the left", "This is a medieval fantasy setting", "Ignore the background characters"'
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
                        setError(null)
                      }}
                      className="qt-button-secondary qt-button-sm flex-shrink-0"
                    >
                      Re-analyze
                    </button>
                  </div>
                )}

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
                submitLabel={`Import ${selectedCount} Item${selectedCount !== 1 ? 's' : ''}`}
                cancelLabel="Cancel"
                isLoading={importing}
                isDisabled={selectedCount === 0}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
