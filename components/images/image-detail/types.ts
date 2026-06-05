/**
 * TypeScript interfaces and types for ImageDetailModal
 */

export interface CharacterGalleryLink {
  characterId: string
  characterName: string
  linkId: string
}

export interface ImageData {
  id: string
  /**
   * When the image originates from a character/user vault gallery (Phase 3+
   * photos), `id` is a doc_mount_file_links id and `linkId` is set to the
   * same value. The save-to-gallery action sends `{ linkId }` instead of
   * `{ fileId }` so the server re-links from the existing blob rather than
   * looking up a non-existent images-v2 FileEntry.
   */
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
  characterGalleryLinks?: CharacterGalleryLink[]
}

export interface Character {
  id: string
  name: string
  defaultImageId?: string | null
}

export interface ImageDetailModalProps {
  isOpen: boolean
  onClose: () => void
  image: ImageData
  onPrev?: () => void
  onNext?: () => void
  onAvatarSet?: () => void // Callback when avatar is set to refresh parent
}

// EntityType is now only 'character' - personas have been migrated to characters with controlledBy: 'user'
export type EntityType = 'character'
