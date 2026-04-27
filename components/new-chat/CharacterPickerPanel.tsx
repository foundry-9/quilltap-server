'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import type {
  Character,
  ConnectionProfile,
  SelectedCharacter,
} from './types'
import { USER_CONTROLLED_PROFILE } from './types'

interface CharacterPickerPanelProps {
  characters: Character[]
  profiles: ConnectionProfile[]
  selectedCharacters: SelectedCharacter[]
  onSelectedCharactersChange: React.Dispatch<React.SetStateAction<SelectedCharacter[]>>
  onCharactersChanged?: () => void
  disabled?: boolean
  autoFocusSearch?: boolean
}

function getAvatarSrc(character: Character): string | null {
  if (character.defaultImage) {
    const filepath = character.defaultImage.filepath
    return character.defaultImage.url || (filepath.startsWith('/') ? filepath : '/' + filepath)
  }
  return character.avatarUrl || null
}

export function CharacterPickerPanel({
  characters,
  profiles,
  selectedCharacters,
  onSelectedCharactersChange,
  onCharactersChanged,
  disabled,
  autoFocusSearch,
}: CharacterPickerPanelProps) {
  const { style } = useAvatarDisplay()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (autoFocusSearch && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [autoFocusSearch])

  const selectedIds = useMemo(
    () => new Set(selectedCharacters.map((sc) => sc.character.id)),
    [selectedCharacters]
  )

  const starredCount = useMemo(
    () => characters.filter((c) => c.isFavorite).length,
    [characters]
  )
  // Show at least 3 rows, at least as many as the user has starred, and never fewer
  // than the number currently selected (so the list auto-grows as you pick characters).
  const visibleRows = Math.max(starredCount, 3, selectedCharacters.length)
  const ROW_HEIGHT_PX = 80
  const listHeightPx = visibleRows * ROW_HEIGHT_PX

  const filtered = useMemo(() => {
    let result = characters
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.title?.toLowerCase().includes(q) ?? false)
      )
    }
    return [...result].sort((a, b) => {
      const aFav = a.isFavorite ? 1 : 0
      const bFav = b.isFavorite ? 1 : 0
      if (bFav !== aFav) return bFav - aFav
      const aUser = a.controlledBy === 'user' ? 1 : 0
      const bUser = b.controlledBy === 'user' ? 1 : 0
      if (bUser !== aUser) return bUser - aUser
      const aCount = a._count?.chats ?? 0
      const bCount = b._count?.chats ?? 0
      if (bCount !== aCount) return bCount - aCount
      const nameCmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      if (nameCmp !== 0) return nameCmp
      const aTitle = a.title?.toLowerCase() ?? ''
      const bTitle = b.title?.toLowerCase() ?? ''
      return aTitle.localeCompare(bTitle)
    })
  }, [characters, searchQuery])

  const handleSelect = (character: Character) => {
    onCharactersChanged?.()
    if (selectedIds.has(character.id)) {
      onSelectedCharactersChange((prev) => prev.filter((sc) => sc.character.id !== character.id))
    } else {
      const connectionProfileId = character.defaultConnectionProfileId || profiles[0]?.id || ''
      const defaultPrompt = character.defaultSystemPromptId
        ? character.systemPrompts?.find((p) => p.id === character.defaultSystemPromptId)
        : character.systemPrompts?.find((p) => p.isDefault) || character.systemPrompts?.[0]
      onSelectedCharactersChange((prev) => [
        ...prev,
        {
          character,
          connectionProfileId,
          selectedSystemPromptId: defaultPrompt?.id || null,
          controlledBy: 'llm',
        },
      ])
    }
  }

  const handleRemove = (characterId: string) => {
    onCharactersChanged?.()
    onSelectedCharactersChange((prev) => prev.filter((sc) => sc.character.id !== characterId))
  }

  const handleProfileChange = (characterId: string, profileId: string) => {
    const isUser = profileId === USER_CONTROLLED_PROFILE
    onSelectedCharactersChange((prev) =>
      prev.map((sc) =>
        sc.character.id === characterId
          ? {
              ...sc,
              connectionProfileId: isUser ? '' : profileId,
              controlledBy: isUser ? 'user' : 'llm',
            }
          : sc
      )
    )
  }

  const handleSystemPromptChange = (characterId: string, promptId: string | null) => {
    onSelectedCharactersChange((prev) =>
      prev.map((sc) =>
        sc.character.id === characterId ? { ...sc, selectedSystemPromptId: promptId } : sc
      )
    )
  }

  return (
    <div className="new-chat-character-picker grid grid-cols-1 gap-6 lg:grid-cols-2 items-stretch">
      <div className="flex flex-col rounded-xl border qt-border-default qt-bg-card p-6">
        <h2 className="mb-4 qt-section-title">Select Characters</h2>
        <div className="mb-4 flex-shrink-0">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search characters..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border qt-border-default bg-background px-4 py-2 text-foreground placeholder:qt-text-secondary focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div
          className="space-y-2 overflow-y-auto"
          style={{ height: `${listHeightPx}px` }}
        >
          {filtered.length === 0 ? (
            <div className="py-8 text-center qt-text-small">
              {searchQuery ? 'No characters match your search' : 'No characters available'}
            </div>
          ) : (
            filtered.map((character) => {
              const isSelected = selectedIds.has(character.id)
              const avatarSrc = getAvatarSrc(character)
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => handleSelect(character)}
                  disabled={disabled}
                  className={
                    'w-full flex items-center gap-3 rounded-lg border p-3 transition ' +
                    (isSelected
                      ? 'qt-border-primary qt-bg-primary/10'
                      : 'qt-border-default qt-bg-card hover:qt-border-primary/50 hover:qt-bg-muted/50')
                  }
                >
                  {avatarSrc ? (

                    <img src={avatarSrc} alt={character.name} className={getAvatarClasses(style, 'sm').imageClass} />
                  ) : (
                    <div
                      className={getAvatarClasses(style, 'sm').wrapperClass}
                      style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}
                    >
                      <span className={getAvatarClasses(style, 'sm').fallbackClass}>
                        {character.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 text-left">
                    <div className="qt-text-primary">{character.name}</div>
                    {character.title && <div className="qt-text-small">{character.title}</div>}
                  </div>
                  <div
                    className={
                      'flex h-6 w-6 items-center justify-center rounded-full border-2 ' +
                      (isSelected
                        ? 'qt-border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground')
                    }
                  >
                    {isSelected && (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className="rounded-xl border qt-border-default qt-bg-card p-6">
        <h2 className="mb-4 qt-section-title">Selected Characters ({selectedCharacters.length})</h2>
        {selectedCharacters.length === 0 ? (
          <div className="py-8 text-center qt-text-small">Click on characters to add them to the chat</div>
        ) : (
          <div className="space-y-4">
            {selectedCharacters.map((sc, index) => {
              const avatarSrc = getAvatarSrc(sc.character)
              return (
                <div key={sc.character.id} className="rounded-lg border qt-border-default qt-bg-muted/30 p-4">
                  <div className="flex items-start gap-3">
                    {avatarSrc ? (

                      <img src={avatarSrc} alt={sc.character.name} className={getAvatarClasses(style, 'sm').imageClass} />
                    ) : (
                      <div
                        className={getAvatarClasses(style, 'sm').wrapperClass}
                        style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}
                      >
                        <span className={getAvatarClasses(style, 'sm').fallbackClass}>
                          {sc.character.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="qt-text-primary">{sc.character.name}</span>
                        {index === 0 && (
                          <span className="rounded qt-bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                            Speaks First
                          </span>
                        )}
                      </div>
                      {sc.character.title && <div className="qt-text-small">{sc.character.title}</div>}
                      <div className="mt-3">
                        <label className="mb-1 block text-xs font-medium qt-text-xs">Connection Profile</label>
                        <select
                          value={sc.controlledBy === 'user' ? USER_CONTROLLED_PROFILE : sc.connectionProfileId}
                          onChange={(e) => handleProfileChange(sc.character.id, e.target.value)}
                          disabled={disabled}
                          className="w-full rounded-lg border qt-border-default bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">Select profile...</option>
                          <option value={USER_CONTROLLED_PROFILE}>Play As (User)</option>
                          {profiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                              {profile.modelName ? ' (' + profile.modelName + ')' : ''}
                            </option>
                          ))}
                        </select>
                        {sc.connectionProfileId && sc.controlledBy !== 'user' && (() => {
                          const selectedProfile = profiles.find((p) => p.id === sc.connectionProfileId)
                          return selectedProfile?.provider ? (
                            <div className="mt-1">
                              <ProviderModelBadge provider={selectedProfile.provider} modelName={selectedProfile.modelName} size="sm" />
                            </div>
                          ) : null
                        })()}
                      </div>
                      {sc.character.systemPrompts && sc.character.systemPrompts.length > 0 && (
                        <div className="mt-2">
                          <label className="mb-1 block text-xs font-medium qt-text-xs">System Prompt</label>
                          <select
                            value={sc.selectedSystemPromptId || ''}
                            onChange={(e) =>
                              handleSystemPromptChange(sc.character.id, e.target.value || null)
                            }
                            disabled={disabled}
                            className="w-full rounded-lg border qt-border-default bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="">Use Default</option>
                            {sc.character.systemPrompts.map((prompt) => (
                              <option key={prompt.id} value={prompt.id}>
                                {prompt.name}
                                {prompt.isDefault ? ' (Default)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(sc.character.id)}
                      disabled={disabled}
                      className="rounded p-1 qt-text-secondary hover:qt-bg-destructive/10 hover:qt-text-destructive"
                      title="Remove character"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
