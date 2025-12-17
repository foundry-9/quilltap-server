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

export interface Persona {
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

export type EntityType = 'character' | 'persona'

export interface TagActionParams {
  imageId: string
  entityType: 'CHARACTER' | 'PERSONA'
  entityId: string
}
