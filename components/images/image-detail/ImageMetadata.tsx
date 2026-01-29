'use client'

import { useMemo } from 'react'
import { Character } from './types'

interface ImageMetadataProps {
  imageId: string
  characters: Character[]
  loadingEntities: boolean
  taggedCharacterIds: Set<string>
  taggingInProgress: Set<string>
  settingAvatar: Set<string>
  onToggleCharacterTag: (characterId: string) => void
  onSetAsAvatar: (entityType: 'character', entityId: string) => void
}

export function ImageMetadata({
  imageId,
  characters,
  loadingEntities,
  taggedCharacterIds,
  taggingInProgress,
  settingAvatar,
  onToggleCharacterTag,
  onSetAsAvatar,
}: ImageMetadataProps) {
  // Split characters into tagged and untagged lists
  const { taggedCharacters, untaggedCharacters } = useMemo(() => {
    const tagged: Character[] = []
    const untagged: Character[] = []

    characters.forEach((character) => {
      if (taggedCharacterIds.has(character.id)) {
        tagged.push(character)
      } else {
        untagged.push(character)
      }
    })

    // Sort both lists alphabetically by name
    tagged.sort((a, b) => a.name.localeCompare(b.name))
    untagged.sort((a, b) => a.name.localeCompare(b.name))

    return { taggedCharacters: tagged, untaggedCharacters: untagged }
  }, [characters, taggedCharacterIds])

  return (
    <div className="qt-panel bg-black/70 backdrop-blur-sm w-full max-w-2xl">
      <div className="flex flex-col gap-4">
        {loadingEntities && (
          <p className="text-gray-300 text-sm">Loading characters...</p>
        )}

        {/* Section 1: Tagged Characters */}
        {!loadingEntities && taggedCharacters.length > 0 && (
          <div>
            <h3 className="text-white font-semibold mb-3">Tagged to Characters</h3>
            <div className="flex flex-col gap-2">
              {taggedCharacters.map((character) => {
                const isLoading = taggingInProgress.has(`char-${character.id}`)
                const isAvatar = character.defaultImageId === imageId
                const isSettingAvatar = settingAvatar.has(`character-${character.id}-avatar`)

                return (
                  <div
                    key={character.id}
                    className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded"
                  >
                    <span className="flex-1 text-white font-medium text-sm">
                      {character.name}
                    </span>
                    {isAvatar ? (
                      <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                        Avatar
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSetAsAvatar('character', character.id)
                        }}
                        disabled={isSettingAvatar}
                        className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium transition-colors disabled:opacity-50"
                        title="Set as avatar"
                      >
                        {isSettingAvatar ? '...' : 'Set Avatar'}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleCharacterTag(character.id)
                      }}
                      disabled={isLoading}
                      className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"
                      title="Remove tag"
                    >
                      {isLoading ? '...' : '×'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Section 2: Add Character Dropdown */}
        {!loadingEntities && untaggedCharacters.length > 0 && (
          <div>
            <label
              htmlFor="add-character-tag"
              className="block text-white font-semibold mb-2"
            >
              Add to character
            </label>
            <select
              id="add-character-tag"
              className="qt-select w-full"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onToggleCharacterTag(e.target.value)
                }
              }}
            >
              <option value="" disabled>
                Select a character...
              </option>
              {untaggedCharacters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* No characters available message */}
        {!loadingEntities && characters.length === 0 && (
          <p className="text-gray-400 text-sm">No characters available for tagging.</p>
        )}
      </div>
    </div>
  )
}
