'use client'

/**
 * PhotoGalleryModal — one grid, three subjects.
 *
 * `mode="character"` and `mode="user-character"` show a vault's `photos/`
 * album. `mode="chat"` shows the **chat gallery**: every image in one
 * conversation, whatever produced it — the backdrops the Lantern painted, the
 * portraits Aurora repainted, the cast's own standing portraits, pictures a
 * character summoned, photographs the reader attached, pictures brought out of
 * an album, and pictures woven into the prose. That listing comes from the
 * single server-side enumerator (`lib/photos/chat-gallery.ts`) through
 * `useChatGallery`, which is the same query the sidebar's `Gallery (N)` reads —
 * so the count and the grid are one answer and cannot disagree.
 *
 * The modal renders through a portal to `document.body`. Inside the tabbed
 * workspace `.qt-workspace` is an isolated stacking context, and a
 * `fixed inset-0` child of it is trapped under the toolbar.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/icon'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { useImageNavigation } from '@/hooks/useImageNavigation'
import { downloadGalleryEntry } from '@/lib/download-utils'
import { useChatGallery } from '@/app/salon/[id]/hooks/useChatGallery'
import type { ChatGalleryEntry, ChatGallerySource } from '@/lib/photos/chat-gallery'
import ChatGalleryImageViewModal from '@/components/chat/ChatGalleryImageViewModal'
import { SaveImageDialog } from '@/app/salon/[id]/components/SaveImageDialog'
import ImageDetailModal from './ImageDetailModal'
import DeletedImagePlaceholder from './DeletedImagePlaceholder'

interface GalleryImage {
  id: string
  linkId?: string
  filename: string
  filepath: string
  url?: string
  mimeType: string
  size: number
  width?: number
  height?: number
  createdAt: string
  tags?: Array<{
    id?: string
    tagType: string
    tagId: string
  }>
}

type BaseGalleryProps = {
  isOpen: boolean
  onClose: () => void
}

type ChatGalleryProps = BaseGalleryProps & {
  mode: 'chat'
  chatId: string
  onImageDeleted?: (fileId: string) => void
  /** Scroll the transcript to a message, from the detail view's Jump link. */
  onJumpToMessage?: (messageId: string) => void
}

type CharacterGalleryProps = BaseGalleryProps & {
  mode: 'character'
  characterId: string
  characterName: string
}

type UserCharacterGalleryProps = BaseGalleryProps & {
  mode: 'user-character'
  userCharacterId: string
  userCharacterName: string
}

type PhotoGalleryModalProps = ChatGalleryProps | CharacterGalleryProps | UserCharacterGalleryProps

const THUMBNAIL_SIZES = [80, 100, 120, 150, 180, 200]
const DEFAULT_THUMBNAIL_INDEX = 2 // 120px

/** Chip labels, in the order the chips are shown. */
const SOURCE_LABELS: Record<ChatGallerySource, string> = {
  'story-background': 'Backgrounds',
  avatar: 'Avatars',
  portrait: 'Portraits',
  generated: 'Generated',
  attachment: 'Attached',
  kept: 'Kept',
  inline: 'Inline',
}

const SOURCE_ORDER: readonly ChatGallerySource[] = [
  'story-background',
  'avatar',
  'portrait',
  'generated',
  'attachment',
  'kept',
  'inline',
]

/** `'all'` is the resting state; a chip narrows to one source. */
type SourceFilter = ChatGallerySource | 'all'

export default function PhotoGalleryModal(props: PhotoGalleryModalProps) {
  const { mode, isOpen, onClose } = props
  const chatId = mode === 'chat' ? props.chatId : undefined
  const characterId = mode === 'character' ? props.characterId : undefined
  const userCharacterId = mode === 'user-character' ? props.userCharacterId : undefined

  const [albumImages, setAlbumImages] = useState<GalleryImage[]>([])
  const [albumLoading, setAlbumLoading] = useState(true)
  const [thumbnailSizeIndex, setThumbnailSizeIndex] = useState(DEFAULT_THUMBNAIL_INDEX)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [saveTargetId, setSaveTargetId] = useState<string | null>(null)

  const onImageDeleted = mode === 'chat' ? props.onImageDeleted : undefined

  // The chat gallery rides its own query — shared with the sidebar count, and
  // refreshed by the `chats` realtime topic when a background job lands a new
  // backdrop or avatar.
  const {
    entries: galleryEntries,
    counts: galleryCounts,
    total: galleryTotal,
    isLoading: galleryLoading,
    invalidate: invalidateGallery,
  } = useChatGallery(chatId, { enabled: isOpen && mode === 'chat' })

  const thumbnailSize = THUMBNAIL_SIZES[thumbnailSizeIndex]

  const entries = useMemo(
    () =>
      sourceFilter === 'all'
        ? galleryEntries
        : galleryEntries.filter((e) => e.source === sourceFilter),
    [galleryEntries, sourceFilter],
  )

  const itemCount = mode === 'chat' ? entries.length : albumImages.length
  const selectedEntry = mode === 'chat' && selectedIndex >= 0 ? entries[selectedIndex] : null
  const selectedImage = mode !== 'chat' && selectedIndex >= 0 ? albumImages[selectedIndex] : null
  const saveTarget = saveTargetId
    ? galleryEntries.find((e) => e.id === saveTargetId) ?? null
    : null

  const title =
    mode === 'chat'
      ? 'Chat Photos'
      : mode === 'character'
      ? `${props.characterName}'s Photos`
      : `${(props as UserCharacterGalleryProps).userCharacterName}'s Photos`

  const emptyStateText =
    mode === 'chat'
      ? sourceFilter === 'all'
        ? 'No photos in this chat'
        : `No ${SOURCE_LABELS[sourceFilter].toLowerCase()} in this chat`
      : 'No photos in this character\'s album'

  const loadAlbum = useCallback(async () => {
    if (!isOpen || mode === 'chat') return
    try {
      setAlbumLoading(true)
      const targetId = mode === 'character' ? (characterId as string) : (userCharacterId as string)
      const response = await fetch(`/api/v1/characters/${targetId}/photos?limit=200`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load photos')
      }

      const albumEntries = data.entries || []
      setAlbumImages(
        albumEntries.map((entry: any) => ({
          id: entry.linkId,
          linkId: entry.linkId,
          filename: entry.fileName,
          filepath: entry.blobUrl,
          url: entry.blobUrl,
          mimeType: entry.mimeType || 'image/webp',
          size: entry.fileSizeBytes || 0,
          createdAt: entry.keptAt,
          tags: [],
        })),
      )
    } catch (error) {
      console.error('Failed to load gallery items:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to load gallery items')
    } finally {
      setAlbumLoading(false)
    }
  }, [isOpen, mode, characterId, userCharacterId])

  // Load album items when the modal opens. The chat gallery loads itself.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on open; parent renders unconditionally
      loadAlbum()
    }
  }, [isOpen, loadAlbum])

  // Reset transient state when the modal closes.
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on close; parent renders unconditionally
      setSelectedIndex(-1)
      setSourceFilter('all')
      setSaveTargetId(null)
    }
  }, [isOpen])

  // Keyboard navigation (Escape only when no image is selected)
  useImageNavigation({
    isOpen,
    onClose,
    handleEscape: selectedIndex === -1 && !saveTargetId,
  })

  const handleZoomIn = () => {
    if (thumbnailSizeIndex < THUMBNAIL_SIZES.length - 1) {
      setThumbnailSizeIndex((prev) => prev + 1)
    }
  }

  const handleZoomOut = () => {
    if (thumbnailSizeIndex > 0) {
      setThumbnailSizeIndex((prev) => prev - 1)
    }
  }

  const handlePrev = () => {
    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
  }

  const handleNext = () => {
    setSelectedIndex((prev) => (prev < itemCount - 1 ? prev + 1 : prev))
  }

  const handleDownload = useCallback(async (entry: ChatGalleryEntry) => {
    try {
      await downloadGalleryEntry(entry)
    } catch (error) {
      console.error('Failed to download image:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast('Failed to download image')
    }
  }, [])

  const handleDeleteEntry = useCallback(
    async (entry: ChatGalleryEntry) => {
      // The bin is only offered where the chat owns the record, and
      // `/chat-files/[id]` only understands a `files.id`. Both guards, because
      // an entry arriving here without them would be a bug, not a user action.
      if (!entry.deletable || entry.idKind !== 'file') return
      if (!(await showConfirmation('Permanently delete this photo? This cannot be undone.'))) return

      try {
        const response = await fetch(`/api/v1/chat-files/${entry.id}`, { method: 'DELETE' })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to delete image')
        }

        showSuccessToast('Image deleted')
        setSelectedIndex(-1)
        invalidateGallery()
        onImageDeleted?.(entry.id)
      } catch (error) {
        console.error('Failed to delete image:', { error: error instanceof Error ? error.message : String(error) })
        showErrorToast(error instanceof Error ? error.message : 'Failed to delete image')
      }
    },
    [invalidateGallery, onImageDeleted],
  )

  const handleCloseDetail = () => {
    setSelectedIndex(-1)
  }

  if (!isOpen) return null

  const maxColumns = Math.floor(800 / (thumbnailSize + 8)) || 1
  const visibleColumns = Math.min(itemCount || 1, maxColumns)
  const containerWidth = visibleColumns * (thumbnailSize + 8)
  const loading = mode === 'chat' ? galleryLoading : albumLoading

  const renderFilterChips = () => {
    if (mode !== 'chat') return null
    const chips = SOURCE_ORDER.filter((source) => (galleryCounts[source] ?? 0) > 0)
    // One kind of picture is not a filter — it is the whole gallery.
    if (chips.length < 2) return null

    return (
      <div
        className="qt-tab-group px-4 pt-3"
        role="group"
        aria-label="Filter by where the picture came from"
      >
        <button
          type="button"
          onClick={() => setSourceFilter('all')}
          aria-pressed={sourceFilter === 'all'}
          className={'qt-tab' + (sourceFilter === 'all' ? ' qt-tab-active' : '')}
        >
          All ({galleryTotal})
        </button>
        {chips.map((source) => (
          <button
            key={source}
            type="button"
            onClick={() => setSourceFilter(source)}
            aria-pressed={sourceFilter === source}
            className={'qt-tab' + (sourceFilter === source ? ' qt-tab-active' : '')}
          >
            {SOURCE_LABELS[source]} ({galleryCounts[source]})
          </button>
        ))}
      </div>
    )
  }

  const renderChatEntry = (entry: ChatGalleryEntry, index: number) => {
    const isMissing = missingImages.has(entry.id)

    if (isMissing) {
      return (
        <div
          key={entry.id}
          className="relative rounded overflow-hidden"
          style={{ width: thumbnailSize, height: thumbnailSize }}
        >
          <DeletedImagePlaceholder
            imageId={entry.id}
            filename={entry.filename}
            onCleanup={invalidateGallery}
            className="w-full h-full absolute inset-0 !p-2"
          />
        </div>
      )
    }

    return (
      <div
        key={entry.id}
        className="relative group rounded overflow-hidden"
        style={{ width: thumbnailSize, height: thumbnailSize }}
      >
        <button
          type="button"
          onClick={() => setSelectedIndex(index)}
          className="relative w-full h-full overflow-hidden rounded hover:ring-2 hover:ring-ring focus:ring-2 focus:ring-ring focus:outline-none transition-all"
          title={entry.filename}
        >
          <img
            src={entry.url}
            alt={entry.filename}
            className="w-full h-full object-cover"
            onError={() => setMissingImages((prev) => new Set(prev).add(entry.id))}
          />
          {entry.isCurrent && (
            <span className="absolute top-1 left-1 qt-bg-success qt-text-on-success text-xs px-1.5 py-0.5 rounded font-medium">
              current
            </span>
          )}
        </button>

        {/* Hover actions — the same shape and the same qt-* classes the
            character gallery's thumbnails use. */}
        <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setSaveTargetId(entry.id)
            }}
            className="p-1.5 rounded-full qt-shadow-md qt-bg-card qt-text-secondary hover:qt-bg-primary hover:qt-text-on-primary transition-colors"
            title="Save to a photo album"
            aria-label="Save to a photo album"
          >
            <Icon name="bookmark" className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void handleDownload(entry)
            }}
            className="p-1.5 rounded-full qt-shadow-md qt-bg-card qt-text-secondary hover:qt-bg-primary hover:qt-text-on-primary transition-colors"
            title="Download image"
            aria-label="Download image"
          >
            <Icon name="download" className="w-4 h-4" />
          </button>
          {entry.deletable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void handleDeleteEntry(entry)
              }}
              className="p-1.5 rounded-full qt-shadow-md qt-bg-card qt-text-secondary hover:qt-bg-destructive hover:qt-text-on-destructive transition-colors"
              title="Delete image"
              aria-label="Delete image"
            >
              <Icon name="trash" className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderAlbumImage = (image: GalleryImage, index: number) => {
    let src = image.url || image.filepath
    if (!src.startsWith('/')) src = `/${src}`
    const isMissing = missingImages.has(image.id)
    const Container = isMissing ? 'div' : 'button'
    const containerProps = isMissing
      ? {}
      : { onClick: () => setSelectedIndex(index), type: 'button' as const }

    return (
      <Container
        key={image.id}
        {...containerProps}
        className="relative rounded overflow-hidden hover:ring-2 hover:ring-ring focus:ring-2 focus:ring-ring focus:outline-none transition-all"
        style={{ width: thumbnailSize, height: thumbnailSize }}
      >
        {isMissing ? (
          <DeletedImagePlaceholder
            imageId={image.id}
            filename={image.filename}
            onCleanup={loadAlbum}
            className="w-full h-full absolute inset-0 !p-2"
          />
        ) : (
          <img
            src={src}
            alt={image.filename}
            className="w-full h-full object-cover"
            onError={() => setMissingImages((prev) => new Set(prev).add(image.id))}
          />
        )}
      </Container>
    )
  }

  const renderItems = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <p className="qt-text-secondary">Loading images...</p>
        </div>
      )
    }

    if (itemCount === 0) {
      return (
        <div className="flex items-center justify-center py-12">
          <p className="qt-text-secondary">{emptyStateText}</p>
        </div>
      )
    }

    return (
      <div className="flex flex-wrap gap-2 justify-center" style={{ maxWidth: `${containerWidth}px` }}>
        {mode === 'chat'
          ? entries.map(renderChatEntry)
          : albumImages.map(renderAlbumImage)}
      </div>
    )
  }

  const modal = (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center qt-bg-overlay backdrop-blur-sm p-4" onClick={onClose}>
        <div
          className="qt-dialog flex flex-col max-h-[90vh] max-w-[90vw]"
          style={{ minWidth: '300px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="qt-dialog-header border-b qt-border-default">
            <h2 className="qt-heading-4 text-foreground">{title}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleZoomOut}
                disabled={thumbnailSizeIndex === 0}
                className="p-2 qt-text-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                title="Smaller thumbnails"
              >
                <Icon name="zoom-out" className="w-5 h-5" />
              </button>
              <button
                onClick={handleZoomIn}
                disabled={thumbnailSizeIndex === THUMBNAIL_SIZES.length - 1}
                className="p-2 qt-text-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                title="Larger thumbnails"
              >
                <Icon name="zoom-in" className="w-5 h-5" />
              </button>
              <button
                onClick={onClose}
                className="p-2 qt-text-secondary hover:text-foreground"
                title="Close"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>
          </div>

          {renderFilterChips()}

          <div className="flex-1 overflow-y-auto p-4">{renderItems()}</div>
        </div>
      </div>

      {selectedEntry && (
        <ChatGalleryImageViewModal
          isOpen={true}
          onClose={handleCloseDetail}
          entry={selectedEntry}
          onPrev={selectedIndex > 0 ? handlePrev : undefined}
          onNext={selectedIndex < itemCount - 1 ? handleNext : undefined}
          onDelete={() => handleDeleteEntry(selectedEntry)}
          onSave={() => setSaveTargetId(selectedEntry.id)}
          onJumpToMessage={
            mode === 'chat' && props.onJumpToMessage
              ? (messageId) => {
                  props.onJumpToMessage?.(messageId)
                  handleCloseDetail()
                  onClose()
                }
              : undefined
          }
        />
      )}

      {selectedImage && (
        <ImageDetailModal
          isOpen={true}
          onClose={handleCloseDetail}
          image={selectedImage}
          onPrev={selectedIndex > 0 ? handlePrev : undefined}
          onNext={selectedIndex < itemCount - 1 ? handleNext : undefined}
        />
      )}

      {mode === 'chat' && saveTarget && (
        <SaveImageDialog
          isOpen={true}
          onClose={() => setSaveTargetId(null)}
          chatId={props.chatId}
          target={{ kind: 'chat', fileId: saveTarget.id }}
          attachments={[
            {
              id: saveTarget.id,
              filename: saveTarget.filename,
              filepath: saveTarget.url,
              mimeType: saveTarget.mimeType,
            },
          ]}
          onSaved={(info) => {
            showSuccessToast(`Saved to ${info.mountPoint}`)
            invalidateGallery()
          }}
        />
      )}
    </>
  )

  // Portal to the body: inside the tabbed workspace `.qt-workspace` is an
  // isolated stacking context, and a `fixed inset-0` child of it renders
  // *under* the toolbar rather than over the page.
  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}
