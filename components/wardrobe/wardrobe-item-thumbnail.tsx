'use client'

/**
 * A wardrobe item's current picture, as a small square thumbnail.
 *
 * Shared by every list that names a garment — the dialog's wardrobe rows
 * (40 px) and the slot / outfit pickers (28 px) — so two same-named garments
 * with different pictures are told apart at a glance. Renders nothing when the
 * item has no current picture; callers need not guard.
 *
 * The URL comes from `wardrobeImageThumbnailUrl`, the one place the thumbnail
 * route is spelled.
 *
 * With `onOpen` the thumbnail is its own button (open the picture full screen
 * in `WardrobeImageViewer`). Leave it off where the thumbnail already sits
 * inside a button — the pickers — since buttons do not nest.
 *
 * Design of record: docs/developer/features/complete/wardrobe-item-images.md §6.2–6.3
 *
 * @module components/wardrobe/wardrobe-item-thumbnail
 */

import { wardrobeImageThumbnailUrl } from '@/lib/wardrobe/item-images-client'

interface WardrobeItemThumbnailProps {
  /** The item's current picture (`WardrobeItem.imageFileId`). */
  fileId: string | null | undefined
  /** Edge length in pixels. */
  size: number
  /**
   * Alt text. Defaults to empty: beside the title the picture is decorative,
   * and an empty alt keeps the surrounding button's accessible name the title.
   */
  alt?: string
  className?: string
  /** Makes the thumbnail a button that opens the picture full screen. */
  onOpen?: () => void
  /** Accessible name for the button form; defaults to "View picture full size". */
  openLabel?: string
}

export function WardrobeItemThumbnail({
  fileId,
  size,
  alt = '',
  className = '',
  onOpen,
  openLabel = 'View picture full size',
}: WardrobeItemThumbnailProps) {
  if (!fileId) return null
  const img = (
    <img
      src={wardrobeImageThumbnailUrl(fileId)}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      data-testid="wardrobe-item-thumbnail"
      className={`flex-shrink-0 rounded object-cover border qt-border-default qt-bg-muted ${className}`}
      style={{ width: size, height: size }}
    />
  )
  if (!onOpen) return img
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex-shrink-0 rounded cursor-zoom-in hover:opacity-80 transition-opacity"
      title={openLabel}
      aria-label={openLabel}
      data-testid="wardrobe-item-thumbnail-open"
    >
      {img}
    </button>
  )
}
