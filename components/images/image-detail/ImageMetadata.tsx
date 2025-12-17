'use client'

import { Character, Persona } from './types'

interface ImageMetadataProps {
  characters: Character[]
  personas: Persona[]
  loadingEntities: boolean
  taggedCharacterIds: Set<string>
  taggedPersonaIds: Set<string>
  taggingInProgress: Set<string>
  settingAvatar: Set<string>
  onToggleCharacterTag: (characterId: string) => void
  onTogglePersonaTag: (personaId: string) => void
  onSetAsAvatar: (entityType: 'character' | 'persona', entityId: string) => void
}

export function ImageMetadata({
  characters,
  personas,
  loadingEntities,
  taggedCharacterIds,
  taggedPersonaIds,
  taggingInProgress,
  settingAvatar,
  onToggleCharacterTag,
  onTogglePersonaTag,
  onSetAsAvatar,
}: ImageMetadataProps) {
  return (
    <div className="qt-panel bg-black/70 backdrop-blur-sm w-full max-w-2xl">
      <div className="flex flex-col gap-4">
        {/* Character tags */}
        {!loadingEntities && characters.length > 0 && (
          <div>
            <h3 className="text-white font-semibold mb-3">Tag to Character</h3>
            <div className="flex flex-col gap-2">
              {characters.map((character) => {
                const isTagged = taggedCharacterIds.has(character.id)
                const isLoading = taggingInProgress.has(`char-${character.id}`)
                const isAvatar = character.defaultImageId === character.id
                const isSettingAvatar = settingAvatar.has(`character-${character.id}-avatar`)

                return (
                  <div key={character.id} className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleCharacterTag(character.id)
                      }}
                      disabled={isLoading}
                      className={`flex-1 px-4 py-2 rounded transition-all font-medium text-sm flex items-center justify-between ${
                        isTagged
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90 ring-2 ring-ring'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span>{isLoading ? '...' : character.name}</span>
                      {isAvatar && (
                        <span className="ml-2 text-xs bg-green-500 px-2 py-0.5 rounded">Avatar</span>
                      )}
                    </button>
                    {isTagged && !isAvatar && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSetAsAvatar('character', character.id)
                        }}
                        disabled={isSettingAvatar}
                        className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
                        title="Set as avatar"
                      >
                        {isSettingAvatar ? '...' : 'Set Avatar'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Persona tags */}
        {!loadingEntities && personas.length > 0 && (
          <div>
            <h3 className="text-white font-semibold mb-3">Tag to Persona</h3>
            <div className="flex flex-col gap-2">
              {personas.map((persona) => {
                const isTagged = taggedPersonaIds.has(persona.id)
                const isLoading = taggingInProgress.has(`persona-${persona.id}`)
                const isAvatar = persona.defaultImageId === persona.id
                const isSettingAvatar = settingAvatar.has(`persona-${persona.id}-avatar`)

                return (
                  <div key={persona.id} className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePersonaTag(persona.id)
                      }}
                      disabled={isLoading}
                      className={`flex-1 px-4 py-2 rounded transition-all font-medium text-sm flex items-center justify-between ${
                        isTagged
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90 ring-2 ring-ring'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span>{isLoading ? '...' : persona.name}</span>
                      {isAvatar && (
                        <span className="ml-2 text-xs bg-green-500 px-2 py-0.5 rounded">Avatar</span>
                      )}
                    </button>
                    {isTagged && !isAvatar && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSetAsAvatar('persona', persona.id)
                        }}
                        disabled={isSettingAvatar}
                        className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
                        title="Set as avatar"
                      >
                        {isSettingAvatar ? '...' : 'Set Avatar'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {loadingEntities && (
          <p className="text-gray-300 text-sm">Loading characters and personas...</p>
        )}
      </div>
    </div>
  )
}
