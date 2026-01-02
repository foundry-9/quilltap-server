/**
 * TypeScript interfaces and types for ImageDetailModal
 */

export interface ImageData {
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

export interface TagActionParams {
  imageId: string
  // CHARACTER is the only type for new tags; PERSONA kept in schema for legacy data
  entityType: 'CHARACTER'
  entityId: string
}
