'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import DeletedImagePlaceholder from '../DeletedImagePlaceholder'
import { ImageActions } from './ImageActions'
import { ImageMetadata } from './ImageMetadata'
import { useImageActions } from './hooks/useImageActions'
import type { ImageDetailModalProps, Character, Persona } from './types'

export default function ImageDetailModal({
  isOpen,
  onClose,
  image,
  onPrev,
  onNext,
  onAvatarSet,
}: ImageDetailModalProps) {
  const [characters, setCharacters] = useState<Character[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loadingEntities, setLoadingEntities] = useState(true)
  const [taggedCharacterIds, setTaggedCharacterIds] = useState<Set<string>>(new Set())
  const [taggedPersonaIds, setTaggedPersonaIds] = useState<Set<string>>(new Set())
  const [imageMissing, setImageMissing] = useState(false)

  const {
    taggingInProgress,
    settingAvatar,
    toggleCharacterTag,
    togglePersonaTag,
    setAsAvatar,
    handleDownload,
  } = useImageActions(image, characters, personas, onAvatarSet)

  // Load characters and personas on mount
  useEffect(() => {
    const loadEntities = async () => {
      try {
        clientLogger.debug('Loading characters and personas')
        setLoadingEntities(true)
        const [charsRes, personasRes] = await Promise.all([
          fetch('/api/characters'),
          fetch('/api/personas'),
        ])

        if (charsRes.ok) {
          const charsData = await charsRes.json()
          setCharacters(charsData.characters || [])
        }
        if (personasRes.ok) {
          const personasData = await personasRes.json()
          setPersonas(personasData.personas || [])
        }
      } catch (error) {
        clientLogger.error('Failed to load entities:', {
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setLoadingEntities(false)
      }
    }

    if (isOpen) {
      loadEntities()
    }
  }, [isOpen])

  // Update tagged entities when image changes
  useEffect(() => {
    if (image.tags) {
      const charIds = new Set<string>()
      const personaIds = new Set<string>()

      image.tags.forEach((tag) => {
        const tagId = tag.tagId
        if (characters.some((c) => c.id === tagId)) {
          charIds.add(tagId)
        }
        if (personas.some((p) => p.id === tagId)) {
          personaIds.add(tagId)
        }
      })

      setTaggedCharacterIds(charIds)
      setTaggedPersonaIds(personaIds)
    } else {
      setTaggedCharacterIds(new Set())
      setTaggedPersonaIds(new Set())
    }
  }, [image, characters, personas])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' && onPrev) {
        onPrev()
      } else if (e.key === 'ArrowRight' && onNext) {
        onNext()
      }
    },
    [onClose, onPrev, onNext]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  const filepath = image.url || image.filepath
  const imageSrc = filepath.startsWith('/') ? filepath : `/${filepath}`

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <ImageActions
        handleDownload={handleDownload}
        onClose={onClose}
        onPrev={onPrev}
        onNext={onNext}
      />

      {/* Image container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center justify-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {imageMissing ? (
          <DeletedImagePlaceholder
            imageId={image.id}
            filename={image.filename}
            onCleanup={onClose}
            width={600}
            height={400}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={image.filename}
            className="max-w-full max-h-[70vh] w-auto h-auto object-contain"
            onError={() => setImageMissing(true)}
          />
        )}

        {/* Tag buttons panel */}
        {!imageMissing && (
          <ImageMetadata
            characters={characters}
            personas={personas}
            loadingEntities={loadingEntities}
            taggedCharacterIds={taggedCharacterIds}
            taggedPersonaIds={taggedPersonaIds}
            taggingInProgress={taggingInProgress}
            settingAvatar={settingAvatar}
            onToggleCharacterTag={toggleCharacterTag}
            onTogglePersonaTag={togglePersonaTag}
            onSetAsAvatar={setAsAvatar}
          />
        )}
      </div>

      {/* Filename at bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm bg-black/50 px-3 py-1 rounded">
        {image.filename}
      </div>
    </div>
  )
}
