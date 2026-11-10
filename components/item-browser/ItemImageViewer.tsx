'use client'

/**
 * A Wardrobe item's, Inventory object's or Atlas entry's picture, full screen.
 *
 * The shared `FullScreenImageViewer` frame with three buttons: Save (the
 * Salon's `SaveImageDialog`, offered every document store, filing a copy in
 * the chosen store's `photos/` — the Wardrobe and the Inventory only; the
 * save dialog has no Atlas target), Download, and Copy. Opened from a row
 * thumbnail and from the item editor's picture section, where Previous / Next
 * walk the item's pictures.
 *
 * When the picture's bytes are missing, the frame's Remove deletes it through
 * the kind's images route (`delete-image`) rather than the generic image
 * delete, which knows nothing about the item's links or its current-picture
 * pointer (bug 194), and refreshes the kind's queries.
 *
 * It sits at `z-[90]`, above the browser dialogs (`z-[60]`) and the item
 * editors (`z-[70]`/`z-[80]`); the save dialog it opens rides at `z-[100]`,
 * and while that dialog is up the viewer leaves the keyboard alone so Escape
 * closes only the dialog.
 *
 * Design of record: docs/developer/features/complete/wardrobe-item-images.md
 *
 * @module components/item-browser/ItemImageViewer
 */

import { useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { FullScreenImageViewer } from '@/components/images/FullScreenImageViewer'
import { SaveImageDialog } from '@/app/salon/[id]/components/SaveImageDialog'
import { downloadImageUrl } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { queryKeys } from '@/lib/query/keys'
import { deleteWardrobeItemImage, wardrobeImageUrl } from '@/lib/wardrobe/item-images-client'
import { inventoryImagesUrl } from '@/lib/inventory/container'
import { inventoryRequest } from '@/lib/inventory/request'
import { atlasImagesUrl } from '@/lib/atlas/container'
import { atlasRequest } from '@/lib/atlas/request'
import type { ItemKind } from '@/lib/folder-browser/item-kind'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'

interface KindSpec {
  /** The filename stem when a title has nothing usable in it. */
  fallbackStem: string
  /** What the console calls the picture. */
  label: string
  /** Remove a picture whose bytes are gone, through the kind's own route. */
  deleteMissing(itemId: string, container: WardrobeContainer, fileId: string): Promise<unknown>
  /** What to refresh once it is gone. */
  refreshKey: QueryKey
}

const KIND_SPECS: Record<ItemKind, KindSpec> = {
  wardrobe: {
    fallbackStem: 'wardrobe_item',
    label: 'wardrobe picture',
    deleteMissing: deleteWardrobeItemImage,
    refreshKey: queryKeys.wardrobe.all,
  },
  inventory: {
    fallbackStem: 'inventory_object',
    label: 'inventory picture',
    deleteMissing: (itemId, container, fileId) =>
      inventoryRequest(inventoryImagesUrl(container, itemId, 'delete-image'), 'POST', { fileId }),
    refreshKey: queryKeys.inventory.all,
  },
  atlas: {
    fallbackStem: 'atlas_entry',
    label: 'atlas picture',
    deleteMissing: (entryId, container, fileId) =>
      atlasRequest(atlasImagesUrl(container, entryId, 'delete-image'), 'POST', { fileId }),
    refreshKey: queryKeys.atlas.all,
  },
}

export interface ItemImageViewerProps {
  kind: ItemKind
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
export function pictureFilename(title: string, fallbackStem: string): string {
  const stem = title.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `${stem || fallbackStem}.webp`
}

export function ItemImageViewer({
  kind,
  onClose,
  itemId,
  itemTitle,
  container,
  fileId,
  note,
  onPrev,
  onNext,
}: Readonly<ItemImageViewerProps>) {
  const spec = KIND_SPECS[kind]
  const [saving, setSaving] = useState(false)
  const src = wardrobeImageUrl(fileId)
  const filename = pictureFilename(itemTitle, spec.fallbackStem)
  const queryClient = useQueryClient()

  // The Salon's save dialog knows the Wardrobe's and the Inventory's images
  // routes; an Atlas picture is downloaded or copied instead.
  const saveKind = kind === 'atlas' ? null : kind

  const handleMissingCleanup = async () => {
    await spec.deleteMissing(itemId, container, fileId)
    await queryClient.invalidateQueries({ queryKey: spec.refreshKey })
  }

  /** Run an action, toasting its failure (and, given `done`, its success). */
  const guard = async (verb: string, fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn()
      if (done) showSuccessToast(done)
    } catch (error) {
      console.error(`Failed to ${verb} ${spec.label}:`, {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(verb === 'copy' ? 'Failed to copy image to clipboard' : `Failed to ${verb} image`)
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
          ...(saveKind ? [{ icon: 'bookmark' as const, label: 'Save to a document store', onClick: () => setSaving(true) }] : []),
          { icon: 'download', label: 'Download', onClick: () => void guard('download', () => downloadImageUrl(src, filename)) },
          {
            icon: 'copy',
            label: 'Copy to clipboard',
            onClick: () => void guard('copy', () => copyImageToClipboard(src), 'Image copied to clipboard'),
          },
        ]}
        caption={
          <>
            <div>{itemTitle}</div>
            {note && <div className="text-xs opacity-80">{note}</div>}
          </>
        }
      />
      {saving && saveKind && (
        <SaveImageDialog
          isOpen={true}
          onClose={() => setSaving(false)}
          target={{ kind: saveKind, itemId, container, fileId }}
          attachments={[{ id: fileId, filename, filepath: src, mimeType: 'image/webp' }]}
          overlayClassName="z-[100]"
          onSaved={(info) => showSuccessToast(`Saved to ${info.mountPoint}`)}
        />
      )}
    </>
  )
}
