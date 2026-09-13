'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import ImageDetailModal from '../ImageDetailModal'
import { GalleryGrid } from './GalleryGrid'
import { useAvatarRolls } from './hooks/useAvatarRolls'
import type { AvatarRoll, GalleryImage } from './types'

interface AvatarRollsSectionProps {
  characterId: string
  entityName: string
  onAvatarChange?: (imageId: string | null) => void
  onRefresh?: () => void
  thumbnailSize: number
}

/**
 * The plates the house has already developed for this character.
 *
 * A separate section rather than more tiles in the album, because these are a
 * different kind of thing: the album is what someone chose to keep, and this
 * is the avatar cache's working stock — one image per configuration of outfit,
 * provider, profile and model, reused so the same sitting is never paid for
 * twice. Every action the album offers works here, plus one the album has no
 * use for: keeping a plate *into* the album.
 *
 * Collapsed by default. A character in long service accumulates a great many
 * of these, and they should not push the album off the page.
 */
export function AvatarRollsSection({
  characterId,
  entityName,
  onAvatarChange,
  onRefresh,
  thumbnailSize,
}: AvatarRollsSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const {
    rolls,
    total,
    loading,
    missingRolls,
    busyRollId,
    handleRollError,
    saveRollToAlbum,
    setRollAsAvatar,
    deleteRoll,
    downloadRoll,
  } = useAvatarRolls(characterId)

  useEffect(() => {
    if (confirmDelete) {
      const timer = setTimeout(() => setConfirmDelete(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [confirmDelete])

  const selectedRoll = selectedIndex >= 0 ? rolls[selectedIndex] : null
  const albumMemberIds = new Set(rolls.filter(r => r.albumLinkId).map(r => r.id))
  // The grid badges whichever tile matches `currentAvatarId`. A portrait
  // pointer is an album link id, never a roll's file id, so hand the grid the
  // roll the server already resolved as the portrait rather than the raw
  // `defaultImageId` — which would match nothing here.
  const portraitRollId = rolls.find(r => r.isPortrait)?.id

  const handleSetAvatar = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    await setRollAsAvatar(image as AvatarRoll, onAvatarChange)
    onRefresh?.()
  }

  const handleSaveToAlbum = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    await saveRollToAlbum(image as AvatarRoll)
    onRefresh?.()
  }

  const handleDownload = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    await downloadRoll(image)
  }

  const handleDelete = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation()
    if (confirmDelete !== image.id) {
      setConfirmDelete(image.id)
      return
    }
    setConfirmDelete(null)
    // The server clears every pointer at the plate before the bytes go, so a
    // portrait or a chat seat resolved to it needs re-reading afterwards.
    await deleteRoll(image as AvatarRoll)
    setSelectedIndex(-1)
    onRefresh?.()
  }

  // A destructive click should know what it is destroying: the plate is
  // discarded, a kept copy is not, and any conversation showing it is unbound.
  const describeDelete = (image: GalleryImage) => {
    const roll = image as AvatarRoll
    const parts = ['Discard this plate']
    if (roll.usedInChatCount > 0) {
      parts.push(`in use in ${roll.usedInChatCount} conversation${roll.usedInChatCount === 1 ? '' : 's'}`)
    }
    if (roll.albumLinkId) {
      parts.push('the album copy stays')
    }
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join('; ')})` : parts[0]
  }

  // Nothing has been drawn for this character yet: say nothing at all rather
  // than adding an empty shelf to the page.
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
        <span className="qt-text-label">Avatar Rolls</span>
        <span className="qt-text-label-xs">
          {loading ? '…' : `${total} plate${total === 1 ? '' : 's'}`}
        </span>
      </button>

      <p className="qt-text-label-xs mt-1 ml-6">
        Portraits the house has already developed for {entityName} — one plate per
        configuration of outfit, provider and model, kept so the same sitting need
        never be paid for twice. Keep one in the album, hang it as the portrait,
        take a copy away, or discard it and let the next sitting be drawn afresh.
      </p>

      {expanded && (
        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 qt-border-primary"></div>
            </div>
          ) : (
            <GalleryGrid
              images={rolls}
              thumbnailSize={thumbnailSize}
              currentAvatarId={portraitRollId}
              missingImages={missingRolls}
              settingAvatar={null}
              deletingImage={null}
              confirmDelete={confirmDelete}
              onImageClick={index => setSelectedIndex(index)}
              onImageError={handleRollError}
              onSetAvatar={handleSetAvatar}
              onDownloadImage={handleDownload}
              onDeleteImage={handleDelete}
              entityName={entityName}
              onSaveToAlbum={handleSaveToAlbum}
              albumMemberIds={albumMemberIds}
              busyImageId={busyRollId}
              deleteTitleFor={describeDelete}
            />
          )}
        </div>
      )}

      {selectedRoll && (
        <ImageDetailModal
          isOpen={true}
          onClose={() => setSelectedIndex(-1)}
          image={{
            // A roll is an images-v2 row, so no `linkId`: the modal's
            // save-to-gallery actions post `{ fileId }` and the server
            // re-links from the blob the file already names.
            id: selectedRoll.id,
            filename: selectedRoll.filename,
            filepath: selectedRoll.filepath,
            url: selectedRoll.url,
            mimeType: selectedRoll.mimeType ?? 'image/webp',
            size: selectedRoll.size,
            width: selectedRoll.width,
            height: selectedRoll.height,
            createdAt: selectedRoll.createdAt,
            tags: [],
          }}
          onPrev={selectedIndex > 0 ? () => setSelectedIndex(selectedIndex - 1) : undefined}
          onNext={
            selectedIndex < rolls.length - 1
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
