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
 * Design of record: docs/developer/features/wardrobe-item-images.md §6.2–6.3
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
}

export function WardrobeItemThumbnail({
  fileId,
  size,
  alt = '',
  className = '',
}: WardrobeItemThumbnailProps) {
  if (!fileId) return null
  return (
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
}
