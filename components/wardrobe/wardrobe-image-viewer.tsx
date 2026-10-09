'use client'

/**
 * A wardrobe item's picture, full screen.
 *
 * The shared `FullScreenImageViewer` frame with three buttons: Save (the
 * Salon's `SaveImageDialog`, offered every document store, filing a copy in
 * the chosen store's `photos/`), Download, and Copy. Opened from the row
 * thumbnail and from the item editor's Picture section, where Previous/Next
 * walk the item's picture history.
 *
 * When the picture's bytes are missing, the frame's Remove deletes it through
 * the images route's `delete-image` action rather than the generic image
 * delete, and refreshes the wardrobe queries (bug 194).
 *
 * It sits at `z-[90]`, above the wardrobe dialog (`z-[60]`) and the item
 * editor (`z-[70]`/`z-[80]`); the save dialog it opens rides at `z-[100]`,
 * and while that dialog is up the viewer leaves the keyboard alone so Escape
 * closes only the dialog.
 *
 * Design of record: docs/developer/features/complete/wardrobe-item-images.md
 *
 * @module components/wardrobe/wardrobe-image-viewer
 */

import { useState } from 'react'
import { FullScreenImageViewer } from '@/components/images/FullScreenImageViewer'
import { SaveImageDialog } from '@/app/salon/[id]/components/SaveImageDialog'
import { downloadImageUrl } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useQueryClient } from '@tanstack/react-query'
import { deleteWardrobeItemImage, wardrobeImageUrl } from '@/lib/wardrobe/item-images-client'
import { queryKeys } from '@/lib/query/keys'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'

interface WardrobeImageViewerProps {
  onClose: () => void
  itemId: string
  itemTitle: string
  /** The item's home container — the images route is addressed through it. */
  container: WardrobeContainer
  /** The picture on show. */
  fileId: string
  /** Optional caption line under the title (e.g. "Current picture"). */
  note?: string | null
  onPrev?: () => void
  onNext?: () => void
}

/** `Blue Velvet Gown` → `Blue_Velvet_Gown.webp` — the stored pictures are WebP. */
function pictureFilename(title: string): string {
  const stem = title.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `${stem || 'wardrobe_item'}.webp`
}

export function WardrobeImageViewer({
  onClose,
  itemId,
  itemTitle,
  container,
  fileId,
  note,
  onPrev,
  onNext,
}: Readonly<WardrobeImageViewerProps>) {
  const [saving, setSaving] = useState(false)
  const src = wardrobeImageUrl(fileId)
  const filename = pictureFilename(itemTitle)

  const queryClient = useQueryClient()

  /**
   * The bytes are gone: remove the picture through the wardrobe's own route,
   * which drops the mount link and the `files` row and moves the item's
   * current pointer on — the generic image delete knows none of that (bug
   * 194) — then refresh every wardrobe read that might still show it.
   */
  const handleMissingCleanup = async () => {
    await deleteWardrobeItemImage(itemId, container, fileId)
    await queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.all })
  }

  const handleDownload = async () => {
    try {
      await downloadImageUrl(src, filename)
    } catch (error) {
      console.error('Failed to download wardrobe picture:', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to download image')
    }
  }

  const handleCopy = async () => {
    try {
      await copyImageToClipboard(src)
      showSuccessToast('Image copied to clipboard')
    } catch (error) {
      console.error('Failed to copy wardrobe picture:', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to copy image to clipboard')
    }
  }

  return (
    <>
      <FullScreenImageViewer
        isOpen={true}
        onClose={onClose}
        src={src}
        alt={`Picture of ${itemTitle}`}
        imageId={fileId}
        filename={filename}
        onMissingCleanup={handleMissingCleanup}
        onPrev={onPrev}
        onNext={onNext}
        keyboardActive={!saving}
        zIndexClassName="z-[90]"
        actions={[
          { icon: 'bookmark', label: 'Save to a document store', onClick: () => setSaving(true) },
          { icon: 'download', label: 'Download', onClick: () => void handleDownload() },
          { icon: 'copy', label: 'Copy to clipboard', onClick: () => void handleCopy() },
        ]}
        caption={
          <>
            <div>{itemTitle}</div>
            {note && <div className="text-xs opacity-80">{note}</div>}
          </>
        }
      />
      {saving && (
        <SaveImageDialog
          isOpen={true}
          onClose={() => setSaving(false)}
          target={{ kind: 'wardrobe', itemId, container, fileId }}
          attachments={[{ id: fileId, filename, filepath: src, mimeType: 'image/webp' }]}
          overlayClassName="z-[100]"
          onSaved={(info) => showSuccessToast(`Saved to ${info.mountPoint}`)}
        />
      )}
    </>
  )
}
