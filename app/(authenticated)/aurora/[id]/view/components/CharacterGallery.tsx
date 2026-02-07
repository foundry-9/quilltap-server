'use client'

import { EmbeddedPhotoGallery } from '@/components/images/EmbeddedPhotoGallery'
import { Character } from '../types'

interface CharacterGalleryProps {
  characterId: string
  character: Character | null
  onAvatarChange: (imageId: string | null) => void
  onRefresh: () => Promise<void>
}

export function CharacterGallery({
  characterId,
  character,
  onAvatarChange,
  onRefresh,
}: CharacterGalleryProps) {
  return (
    <EmbeddedPhotoGallery
      entityType="character"
      entityId={characterId}
      entityName={character?.name || 'Character'}
      currentAvatarId={character?.defaultImageId}
      onAvatarChange={(imageId: string | null) => {
        onAvatarChange(imageId ?? null)
        onRefresh()
      }}
      onRefresh={onRefresh}
    />
  )
}
