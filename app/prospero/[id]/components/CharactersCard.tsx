'use client'

/**
 * Characters Card
 *
 * Expandable/scrollable card displaying project character roster.
 * Uses favorites-style character card layout.
 * Supports quick-hide filtering.
 */

import { useMemo } from 'react'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import type { Project } from '../types'

interface CharactersCardProps {
  project: Project
  onRemoveCharacter: (characterId: string) => void
  onToggleAllowAnyCharacter: () => void
  expanded: boolean
  onToggle: () => void
}

function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export function CharactersCard({ project, onRemoveCharacter, onToggleAllowAnyCharacter, expanded, onToggle }: CharactersCardProps) {
  const { shouldHideByIds } = useQuickHide()

  // Filter characters based on quick-hide rules
  const visibleCharacters = useMemo(() => {
    return project.characterRoster.filter(char => {
      return !shouldHideByIds(char.tags || [])
    })
  }, [project.characterRoster, shouldHideByIds])


  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <UsersIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Characters</h3>
            <p className="qt-text-small qt-text-secondary">
              {visibleCharacters.length} character{visibleCharacters.length !== 1 ? 's' : ''} in roster
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t qt-border-default">
          {/* Allow Any Character Toggle */}
          <div className="flex items-center justify-between px-4 py-3 qt-bg-muted">
            <div>
              <h4 className="text-sm font-medium text-foreground">Allow Any Character</h4>
              <p className="qt-text-xs qt-text-secondary">
                {project.allowAnyCharacter
                  ? 'Any character can join project chats.'
                  : 'Only roster characters can participate.'}
              </p>
            </div>
            <button
              onClick={onToggleAllowAnyCharacter}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                project.allowAnyCharacter ? 'bg-primary' : 'qt-bg-muted'
              }`}
              role="switch"
              aria-checked={project.allowAnyCharacter}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full qt-bg-toggle-knob transition-transform ${
                  project.allowAnyCharacter ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {visibleCharacters.length === 0 ? (
            <div className="p-4 text-center qt-text-secondary">
              <p>{project.characterRoster.length === 0 ? 'No characters in the roster yet.' : 'No visible characters (some may be hidden).'}</p>
              {project.characterRoster.length === 0 && (
                <p className="qt-text-small mt-1">Characters are added when chats are associated.</p>
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
                      className="absolute top-1 right-1 p-1 rounded-full opacity-0 group-hover:opacity-100 qt-text-secondary hover:qt-text-destructive hover:qt-bg-destructive/10 transition-all"
                      title="Remove from roster"
                    >
                      <CloseIcon className="w-3.5 h-3.5" />
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
        </div>
      )}
    </div>
  )
}
