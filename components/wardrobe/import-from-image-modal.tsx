'use client'

/**
 * Import From Image Modal
 *
 * A three-state modal for importing wardrobe items from a reference image:
 * 1. Upload state — file picker, the vision profile to read it with (preset
 *    to the one the server would pick), optional guidance notes, "Analyze" button
 * 2. Analyzing state — loading spinner while LLM processes the image
 * 3. Review state — the shared review pane (`proposal-review/ProposalReview`):
 *    editable item cards with select/deselect, plus an optional ensemble card
 *    that bundles the imported pieces into one composite outfit. The import is
 *    the shared `useProposalImport`: the pieces are created first and their
 *    returned ids become the outfit's `componentItemIds`.
 *
 * Unless the operator declines, the photograph itself is attached to every
 * piece (and the outfit) as its first picture, `kind=imported`. It is
 * uploaded once, with the first piece; the rest link that picture
 * (`?action=link-image`), so N pieces share one blob behind N links. A
 * failed attachment never aborts the import — the garment stands without it.
 *
 * @module components/wardrobe/import-from-image-modal
 */

import { useState, useRef, useCallback, useId, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { Icon } from '@/components/ui/icon'
import { activateOnKey } from '@/components/ui/activate-on-key'
import { BaseModal } from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast, showWarningToast } from '@/lib/toast'
import { fetchJson } from '@/lib/fetch-helpers'
import FormActions from '@/components/ui/FormActions'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { linkWardrobeItemImage, uploadWardrobeItemImage } from '@/lib/wardrobe/item-images-client'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import type { ProposedOutfit } from '@/lib/wardrobe/proposal/types'
import {
  EMPTY_OUTFIT,
  ProposalReview,
  summarizeReview,
  toOutfitDraft,
  toReviewItems,
  type OutfitDraft,
  type ReviewItem,
} from './proposal-review/ProposalReview'
import { useProposalImport } from './proposal-review/useProposalImport'

// ============================================================================
// TYPES
// ============================================================================

interface ImportFromImageModalProps {
  characterId: string
  onClose: () => void
  onImported: () => void
}

type ModalState = 'upload' | 'analyzing' | 'review'

interface VisionProfileOption {
  id: string
  name: string
  provider: string
  modelName: string
}

interface VisionProfilesResponse {
  profiles: VisionProfileOption[]
  /** What the analysis uses when nothing is chosen; null when no profile can see. */
  defaultProfileId: string | null
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
  const id = useId()
  const [state, setState] = useState<ModalState>('upload')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [guidance, setGuidance] = useState('')
  const [proposedItems, setProposedItems] = useState<ReviewItem[]>([])
  const [outfit, setOutfit] = useState<OutfitDraft>(EMPTY_OUTFIT)
  /** Keep the photograph as each created piece's first picture. */
  const [keepPhotograph, setKeepPhotograph] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** The operator's pick; null means "whatever the server would choose". */
  const [chosenProfileId, setChosenProfileId] = useState<string | null>(null)
  /** Which model read the photograph, shown on the review screen. */
  const [analyzedBy, setAnalyzedBy] = useState<string | null>(null)
  const visionProfilesQuery = useQuery({
    queryKey: queryKeys.wardrobe.visionProfiles,
    queryFn: ({ signal }) => apiFetch<VisionProfilesResponse>('/api/v1/wardrobe?action=analyze-image', { signal }),
  })
  const visionProfiles = useMemo(() => visionProfilesQuery.data?.profiles ?? [], [visionProfilesQuery.data])
  const selectedProfileId = chosenProfileId ?? visionProfilesQuery.data?.defaultProfileId ?? ''
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Every create posts to the character's own wardrobe, so that is the
  // container each new piece (and the outfit) lives in.
  const container = useMemo<WardrobeContainer>(() => ({ scope: 'character', id: characterId }), [characterId])
  const { importing, run: runImport } = useProposalImport({ container, logLabel: 'ImportFromImageModal' })
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
          imagePrompt: string
          types: WardrobeItemType[]
          appropriateness: string
        }>
        proposedOutfit: ProposedOutfit | null
        provider: string
        model: string
      }>('/api/v1/wardrobe?action=analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64,
          mimeType: selectedFile.type,
          guidance: guidance.trim() || undefined,
          profileId: selectedProfileId || undefined,
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

      const reader = visionProfiles.find(p => p.id === selectedProfileId)
      setAnalyzedBy(reader ? `${reader.name} (${reader.provider} • ${reader.modelName})` : `${result.data.provider} • ${result.data.model}`)
      setProposedItems(toReviewItems(items))
      setOutfit(toOutfitDraft(result.data.proposedOutfit, items.length))
      setState('review')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed'
      setError(message)
      setState('upload')
    }
  }, [selectedFile, guidance, selectedProfileId, visionProfiles])

  // ── Import ──────────────────────────────────────────────────────────────

  const { selectedCount, willCreateOutfit, outfitTitleMissing } = summarizeReview(proposedItems, outfit)

  const handleImport = useCallback(async () => {
    const itemsToImport = proposedItems.filter(i => i.selected)
    if (itemsToImport.length === 0) return

    const photograph = keepPhotograph ? selectedFile : null
    let pictureFailures = 0

    /** The photograph's file id once it has been uploaded to the first piece. */
    let photographFileId: string | null = null

    /**
     * Attach the photograph to a freshly created item; never throws. The bytes
     * go up once, with the first piece; every later piece links that picture
     * server-side rather than uploading it again.
     */
    const attachPhotograph = async (itemId: string, title: string): Promise<void> => {
      if (!photograph) return
      try {
        if (photographFileId) {
          await linkWardrobeItemImage(itemId, container, photographFileId)
        } else {
          const { image } = await uploadWardrobeItemImage(itemId, container, photograph, 'imported')
          photographFileId = image.fileId
        }
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
      const result = await runImport({
        pieces: itemsToImport,
        outfit: willCreateOutfit ? outfit : null,
        afterCreate: (item, title) => attachPhotograph(item.id, title),
      })

      const importedCount = result.created.length
      if (importedCount === 0) {
        showErrorToast('Failed to import wardrobe items')
        return
      }

      showSuccessToast(
        importedCount === 1
          ? '1 wardrobe item imported from image'
          : `${importedCount} wardrobe items imported from image`
      )

      switch (result.outfitOutcome) {
        case 'created':
          showSuccessToast(`Outfit "${outfit.title.trim()}" assembled from ${importedCount} pieces`)
          break
        case 'failed':
          showErrorToast('The pieces were imported, but the outfit could not be assembled')
          break
        case 'too-few':
          showErrorToast('Too few pieces were imported to assemble an outfit')
          break
        case 'none':
          break
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
    }
  }, [proposedItems, container, runImport, onImported, onClose, willCreateOutfit, outfit, keepPhotograph, selectedFile])

  // ── Render ──────────────────────────────────────────────────────────────

  // Opens over the wardrobe dialog; the shell stacks it on top by DOM order.
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Import from Image"
      showCloseButton
      maxWidth="wide"
      bodyClassName="qt-dialog-body-default space-y-4 flex-1 overflow-y-auto"
      footerClassName="qt-dialog-footer-default flex-shrink-0"
      footer={
        <>
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
        </>
      }
    >
      {/* Error display */}
      {error && (
        <div role="alert" className="qt-alert-error rounded px-3 py-2 text-sm">
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
              onKeyDown={activateOnKey}
              role="button"
              tabIndex={0}
              aria-label="Choose an image: drop one here or press to browse"
              className="border-2 border-dashed qt-border-default rounded-lg p-8 text-center cursor-pointer hover:qt-border-primary transition-colors"
            >
              <Icon name="image" className="w-12 h-12 mx-auto qt-text-secondary mb-3" />
              <p className="text-sm qt-text mb-1">
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

          {/* Which vision model reads the photograph */}
          <div>
            <label htmlFor={`${id}-vision-profile`} className="qt-label mb-1">
              Reading the photograph
            </label>
            <select
              id={`${id}-vision-profile`}
              value={selectedProfileId}
              onChange={(e) => setChosenProfileId(e.target.value || null)}
              disabled={state === 'analyzing' || visionProfilesQuery.isLoading || visionProfiles.length === 0}
              className="qt-select text-sm w-full"
            >
              {visionProfilesQuery.isLoading && <option value="">Consulting the roster of keen-eyed models…</option>}
              {!visionProfilesQuery.isLoading && visionProfiles.length === 0 && (
                <option value="">No profile can see pictures</option>
              )}
              {visionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName})
                  {profile.id === visionProfilesQuery.data?.defaultProfileId ? ' — the usual choice' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs qt-text-secondary mt-1">
              Only profiles whose model reads images and whose provider will actually deliver one are listed.
            </p>
          </div>

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
                <p className="text-sm qt-text">
                  {proposedItems.length} item{proposedItems.length !== 1 ? 's' : ''} identified
                </p>
                {analyzedBy && (
                  <p className="text-xs qt-text-secondary mt-1">Read by {analyzedBy}</p>
                )}
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
              <span className="text-sm qt-text block">
                The photograph will be kept as each piece&apos;s first picture
              </span>
              <span className="text-xs qt-text-secondary block mt-0.5">
                Pressed into every garment&apos;s album, and the outfit&apos;s too. Untick it to leave the albums blank.
              </span>
            </span>
          </label>

          <ProposalReview
            items={proposedItems}
            onItemsChange={setProposedItems}
            outfit={outfit}
            onOutfitChange={setOutfit}
          />
        </>
      )}
    </BaseModal>
  )
}
