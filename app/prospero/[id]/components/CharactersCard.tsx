'use client'

/**
 * Characters Card
 *
 * Expandable/scrollable card displaying the project character roster.
 *
 * The roster decides which characters may use their tools on the project's
 * files and its shared wardrobe (see `lib/projects/roster-access.ts`). It does
 * not decide who may chat in the project. When "Allow Any Character" is off,
 * the roster is curated by hand here — add from the picker, remove per card.
 *
 * Uses favorites-style character card layout and supports quick-hide filtering.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import Avatar from '@/components/ui/Avatar'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { Project } from '../types'
import { ChevronIcon } from '@/components/ui/ChevronIcon'
import { Icon } from '@/components/ui/icon'

interface CharacterOption {
  id: string
  name: string
  title?: string | null
  tags?: string[]
  defaultImage?: {
    id: string
    filepath: string
    url?: string | null
  } | null
}

interface CharactersCardProps {
  project: Project
  onAddCharacter: (characterId: string) => Promise<void>
  onRemoveCharacter: (characterId: string) => void
  onToggleAllowAnyCharacter: () => void
  expanded: boolean
  onToggle: () => void
}

export function CharactersCard({
  project,
  onAddCharacter,
  onRemoveCharacter,
  onToggleAllowAnyCharacter,
  expanded,
  onToggle,
}: CharactersCardProps) {
  const { shouldHideByIds } = useQuickHide()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)

  const rosterEditable = !project.allowAnyCharacter

  // Filter characters based on quick-hide rules, deduping any repeated ids
  const visibleCharacters = useMemo(() => {
    const seen = new Set<string>()
    return project.characterRoster.filter(char => {
      if (!char.id || seen.has(char.id)) return false
      seen.add(char.id)
      return !shouldHideByIds(char.tags || [])
    })
  }, [project.characterRoster, shouldHideByIds])

  // Every live (non-archived) character, fetched only while the picker is open.
  const { data: charactersData, isLoading: charactersLoading } = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) => apiFetch<{ characters: CharacterOption[] }>('/api/v1/characters', { signal }),
    enabled: expanded && rosterEditable && pickerOpen,
  })

  const candidates = useMemo(() => {
    const onRoster = new Set(project.characterRoster.map(c => c.id))
    const term = search.trim().toLowerCase()
    return (charactersData?.characters ?? [])
      .filter(c => !onRoster.has(c.id))
      .filter(c => !shouldHideByIds(c.tags || []))
      .filter(c => !term || c.name.toLowerCase().includes(term) || (c.title ?? '').toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [charactersData, project.characterRoster, search, shouldHideByIds])

  const handleAdd = async (characterId: string) => {
    setAddingId(characterId)
    try {
      await onAddCharacter(characterId)
    } finally {
      setAddingId(null)
    }
  }

  const closePicker = () => {
    setPickerOpen(false)
    setSearch('')
  }

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon name="characters" className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Characters</h3>
            <p className="qt-text-small qt-text-secondary">
              {project.allowAnyCharacter
                ? 'Open to every character'
                : `${visibleCharacters.length} character${visibleCharacters.length !== 1 ? 's' : ''} in roster`}
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t qt-border-default">
          {/* Allow Any Character Toggle */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 qt-bg-muted">
            <div>
              <h4 className="qt-label text-foreground">Allow Any Character</h4>
              <p className="qt-text-xs qt-text-secondary">
                {project.allowAnyCharacter
                  ? 'Every character may use the project files and shared wardrobe.'
                  : 'Only roster characters may use the project files and shared wardrobe.'}
              </p>
            </div>
            <button
              onClick={onToggleAllowAnyCharacter}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                project.allowAnyCharacter ? 'bg-primary' : 'qt-bg-muted'
              }`}
              role="switch"
              aria-checked={project.allowAnyCharacter}
              aria-label="Allow Any Character"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full qt-bg-toggle-knob transition-transform ${
                  project.allowAnyCharacter ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {!rosterEditable ? (
            <div className="p-4 text-center qt-text-secondary">
              <p className="qt-text-small">
                Any character in a project chat may read and edit its files and borrow from its wardrobe.
                Turn this off to choose who may.
              </p>
            </div>
          ) : (
            <>
              {/* Add-to-roster picker */}
              <div className="px-3 pt-3">
                {!pickerOpen ? (
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="qt-button qt-button-secondary qt-button-sm w-full"
                  >
                    Add character
                  </button>
                ) : (
                  <div className="rounded-lg qt-border qt-bg-surface p-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search characters…"
                        className="qt-input flex-1"
                        autoFocus
                        aria-label="Search characters to add"
                      />
                      <button
                        type="button"
                        onClick={closePicker}
                        className="qt-button qt-button-ghost qt-button-sm"
                      >
                        Done
                      </button>
                    </div>
                    <div className="mt-2 max-h-56 overflow-y-auto">
                      {charactersLoading ? (
                        <p className="p-2 qt-text-small qt-text-secondary">Loading characters…</p>
                      ) : candidates.length === 0 ? (
                        <p className="p-2 qt-text-small qt-text-secondary">
                          {search.trim() ? 'No characters match.' : 'Every character is already on the roster.'}
                        </p>
                      ) : (
                        <ul>
                          {candidates.map((char) => (
                            <li key={char.id}>
                              <button
                                type="button"
                                onClick={() => handleAdd(char.id)}
                                disabled={addingId !== null}
                                className="w-full flex items-center gap-2 p-2 rounded-md text-left hover:qt-bg-muted transition-colors disabled:opacity-50"
                              >
                                <Avatar name={char.name} src={char} size="xs" />
                                <span className="flex-1 min-w-0">
                                  <span className="block text-sm text-foreground truncate">{char.name}</span>
                                  {char.title && (
                                    <span className="block qt-text-xs qt-text-secondary truncate">{char.title}</span>
                                  )}
                                </span>
                                <span className="qt-text-xs qt-text-secondary">
                                  {addingId === char.id ? 'Adding…' : 'Add'}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {visibleCharacters.length === 0 ? (
                <div className="p-4 text-center qt-text-secondary">
                  <p>{project.characterRoster.length === 0 ? 'No characters in the roster yet.' : 'No visible characters (some may be hidden).'}</p>
                  {project.characterRoster.length === 0 && (
                    <p className="qt-text-small mt-1">
                      Until someone is added, no character may use the project files or shared wardrobe.
                    </p>
                  )}
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto p-3">
                  {/* Favorites-style grid layout */}
                  <div className="grid grid-cols-2 gap-2">
                    {visibleCharacters.map((char) => (
                      <div
                        key={char.id}
                        className="relative flex flex-col p-3 rounded-lg qt-border qt-bg-surface hover:qt-border-primary hover:qt-shadow-md transition-all group"
                      >
                        {/* Remove button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveCharacter(char.id)
                          }}
                          className="absolute top-1 right-1 p-1 rounded-full opacity-60 group-hover:opacity-100 focus:opacity-100 qt-text-secondary hover:qt-text-destructive hover:qt-bg-destructive/10 transition-all"
                          title="Remove from roster"
                          aria-label={`Remove ${char.name || 'character'} from roster`}
                        >
                          <Icon name="close" className="w-3.5 h-3.5" />
                        </button>

                        <Link
                          href={`/characters/${char.id}/view`}
                          className="flex flex-col items-center gap-2 hover:opacity-80 transition-opacity"
                        >
                          <Avatar
                            name={char.name || 'Unknown'}
                            src={char}
                            size="md"
                          />
                          <div className="text-center w-full">
                            <h4 className="text-sm font-semibold text-foreground truncate px-1">
                              {char.name || 'Unknown Character'}
                            </h4>
                            <p className="qt-text-xs qt-text-secondary">
                              {char.chatCount || 0} chat{char.chatCount !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
