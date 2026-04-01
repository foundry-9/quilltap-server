'use client'

/**
 * Characters Tab
 *
 * Displays project character roster with remove functionality.
 */

import Link from 'next/link'
import type { Project } from '../types'

interface CharactersTabProps {
  project: Project
  onRemoveCharacter: (characterId: string) => void
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export function CharactersTab({ project, onRemoveCharacter }: CharactersTabProps) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="qt-text-small">
          {project.allowAnyCharacter
            ? 'Any character can participate in chats for this project.'
            : 'Only characters in the roster can participate in project chats.'}
        </p>
      </div>

      {project.characterRoster.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No characters in the roster yet.</p>
          <p className="text-sm mt-2">Characters are added automatically when chats are associated with this project.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {project.characterRoster.map((char) => (
            <div key={char.id} className="qt-entity-card flex items-center justify-between">
              <div className="flex items-center gap-3">
                {char.avatarUrl ? (
                  <img src={char.avatarUrl} alt={char.name || 'Character'} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg font-semibold">
                    {char.name ? char.name.charAt(0).toUpperCase() : '?'}
                  </div>
                )}
                <div>
                  <Link href={`/characters/${char.id}/view`} className="font-medium hover:text-primary">
                    {char.name || 'Unknown Character'}
                  </Link>
                  <p className="qt-text-small">{char.chatCount || 0} chat{char.chatCount !== 1 ? 's' : ''} in project</p>
                </div>
              </div>
              <button
                onClick={() => onRemoveCharacter(char.id)}
                className="text-muted-foreground hover:text-destructive"
                title="Remove from roster"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
