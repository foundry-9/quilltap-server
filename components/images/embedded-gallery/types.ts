/**
 * Types and interfaces for the embedded photo gallery
 */

export interface GalleryImage {
  id: string
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

export interface GalleryTag {
  id?: string
  tagType: string
  tagId: string
}

// EntityType is now only 'character' - personas have been migrated to characters with controlledBy: 'user'
export type EntityType = 'character'

export interface EmbeddedPhotoGalleryProps {
  entityType: EntityType
  entityId: string
  entityName: string
  currentAvatarId?: string
  onAvatarChange?: (imageId: string | null) => void
  onRefresh?: () => void // Callback to refresh parent data without calling API
}

export interface GalleryImageProps {
  image: GalleryImage
  index: number
  isTagged: boolean
  isAvatar: boolean
  isUpdating: boolean
  isDeletingImage: boolean
  isConfirmingDelete: boolean
  isMissingImage: boolean
  thumbnailSize: number
  onImageClick: (index: number) => void
  onImageError: () => void
  onToggleTag: (e: React.MouseEvent) => void
  onSetAvatar: (e: React.MouseEvent) => void
  onDeleteImage: (e: React.MouseEvent) => void
  entityName: string
}
