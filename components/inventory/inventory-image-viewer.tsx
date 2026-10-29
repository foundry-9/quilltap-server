'use client'

/**
 * An Inventory object's picture, full screen — the shared
 * `FullScreenImageViewer` frame with Save (to any document store's
 * `photos/`), Download and Copy, as the wardrobe's viewer has. Opened from
 * the editor's Pictures section, where Previous / Next walk the pictures.
 *
 * @module components/inventory/inventory-image-viewer
 */

import { useState } from 'react'
import { FullScreenImageViewer } from '@/components/images/FullScreenImageViewer'
import { SaveImageDialog } from '@/app/salon/[id]/components/SaveImageDialog'
import { downloadImageUrl } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { InventoryContainer } from '@/lib/inventory/container'

interface InventoryImageViewerProps {
  onClose: () => void
  itemId: string
  itemTitle: string
  container: InventoryContainer
  fileId: string
  onPrev?: () => void
  onNext?: () => void
}

function pictureFilename(title: string): string {
  const stem = title.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `${stem || 'inventory_object'}.webp`
}

export function InventoryImageViewer({ onClose, itemId, itemTitle, container, fileId, onPrev, onNext }: Readonly<InventoryImageViewerProps>) {
  const [saving, setSaving] = useState(false)
  const src = `/api/v1/files/${fileId}`
  const filename = pictureFilename(itemTitle)

  const guard = (label: string, fn: () => Promise<void>, done?: string) => async () => {
    try {
      await fn()
      if (done) showSuccessToast(done)
    } catch (error) {
      console.error(`Failed to ${label} inventory picture:`, { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(`Failed to ${label} image`)
    }
  }

  return (
    <>
      <FullScreenImageViewer
        isOpen
        onClose={onClose}
        src={src}
        alt={`Picture of ${itemTitle}`}
        imageId={fileId}
        filename={filename}
        onPrev={onPrev}
        onNext={onNext}
        keyboardActive={!saving}
        zIndexClassName="z-[90]"
        actions={[
          { icon: 'bookmark', label: 'Save to a document store', onClick: () => setSaving(true) },
          { icon: 'download', label: 'Download', onClick: () => void guard('download', () => downloadImageUrl(src, filename))() },
          { icon: 'copy', label: 'Copy to clipboard', onClick: () => void guard('copy', async () => { await copyImageToClipboard(src) }, 'Image copied to clipboard')() },
        ]}
        caption={<div>{itemTitle}</div>}
      />
      {saving && (
        <SaveImageDialog
          isOpen
          onClose={() => setSaving(false)}
          target={{ kind: 'inventory', itemId, container, fileId }}
          attachments={[{ id: fileId, filename, filepath: src, mimeType: 'image/webp' }]}
          overlayClassName="z-[100]"
          onSaved={(info) => showSuccessToast(`Saved to ${info.mountPoint}`)}
        />
      )}
    </>
  )
}
