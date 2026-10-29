'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import ImageDetailModal from '../ImageDetailModal'
import { GalleryGrid } from './GalleryGrid'
import { useWardrobeImages } from './hooks/useWardrobeImages'
import type { GalleryImage, WardrobeGalleryImage } from './types'

interface WardrobeImagesSectionProps {
  characterId: string
  entityName: string
  onRefresh?: () => void
  thumbnailSize: number
}

/**
 * The pictures drawn of the garments a character can reach — their own
 * wardrobe, their groups' wardrobes and Quilltap General.
 *
 * Read-only, and its own section for the same reason the avatar rolls are: these
 * belong to the wardrobe items, not to the character's album. Each tile is
 * captioned with the item it pictures and the wardrobe that item lives in.
 * Opening one offers the detail view's own save actions, so a picture can still
 * be kept in the album from there.
 *
 * Collapsed by default, and absent entirely when there is nothing to show.
 */
export function WardrobeImagesSection({
  characterId,
  entityName,
  onRefresh,
  thumbnailSize,
}: WardrobeImagesSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  const { images, total, loading, missingImages, handleImageError, downloadImage } =
    useWardrobeImages(characterId)

  const selected = selectedIndex >= 0 ? images[selectedIndex] : null

  const captionFor = (image: GalleryImage) => {
    const w = image as WardrobeGalleryImage
    return {
      title: w.itemArchived ? `${w.itemTitle} (archived)` : w.itemTitle,
      detail: w.locationLabel,
    }
  }

  const handleDownload = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    await downloadImage(image as WardrobeGalleryImage)
  }

  if (!loading && total === 0) return null

  return (
    <section className="mt-8 border-t qt-border-default pt-6">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        <Icon
          name={expanded ? 'chevron-down' : 'chevron-right'}
          className="w-4 h-4 qt-text-secondary"
        />
        <span className="qt-text-label">Wardrobe Pictures</span>
        <span className="qt-text-label-xs">
          {loading ? '…' : `${total} picture${total === 1 ? '' : 's'}`}
        </span>
      </button>

      <p className="qt-text-label-xs mt-1 ml-6">
        Every likeness the house has sketched of the garments within {entityName}&rsquo;s
        reach — from {entityName}&rsquo;s own wardrobe, the wardrobes of any company
        {' '}{entityName} keeps, and the Quilltap General collection. Each plate bears a
        little card naming the garment and the wardrobe it hangs in.
      </p>

      {expanded && (
        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 qt-border-primary"></div>
            </div>
          ) : (
            <GalleryGrid
              images={images}
              thumbnailSize={thumbnailSize}
              missingImages={missingImages}
              settingAvatar={null}
              deletingImage={null}
              confirmDelete={null}
              onImageClick={index => setSelectedIndex(index)}
              onImageError={handleImageError}
              onDownloadImage={handleDownload}
              entityName={entityName}
              captionFor={captionFor}
            />
          )}
        </div>
      )}

      {selected && (
        <ImageDetailModal
          isOpen={true}
          onClose={() => setSelectedIndex(-1)}
          image={{
            // A `files` row, so no `linkId`: the modal's save actions post
            // `{ fileId }` and the server re-links from the file's blob.
            id: selected.id,
            filename: selected.filename,
            filepath: selected.fullUrl,
            url: selected.fullUrl,
            mimeType: selected.mimeType ?? 'image/webp',
            size: selected.size,
            width: selected.width,
            height: selected.height,
            createdAt: selected.createdAt,
            tags: [],
          }}
          onPrev={selectedIndex > 0 ? () => setSelectedIndex(selectedIndex - 1) : undefined}
          onNext={
            selectedIndex < images.length - 1
              ? () => setSelectedIndex(selectedIndex + 1)
              : undefined
          }
          onAvatarSet={() => {
            onRefresh?.()
          }}
        />
      )}
    </section>
  )
}
