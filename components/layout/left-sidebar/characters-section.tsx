'use client'

/**
 * Characters Section
 *
 * Displays favorite characters and top conversation participants in the sidebar.
 * Uses SidebarDataProvider for centralized data fetching and refresh.
 *
 * @module components/layout/left-sidebar/characters-section
 */

import Link from 'next/link'
import { useSidebar } from '@/components/providers/sidebar-provider'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useSidebarData, type SidebarCharacter } from '@/components/providers/sidebar-data-provider'
import { SidebarSection } from './sidebar-section'
import { ViewAllLink } from './sidebar-item'
import Avatar from '@/components/ui/Avatar'

/**
 * Star icon (for favorites)
 */
function StarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function CharacterItem({
  character,
  isCollapsed,
}: {
  character: SidebarCharacter
  isCollapsed: boolean
}) {
  // Build avatar source object for Avatar component
  const avatarSrc = character.avatarUrl
    ? { avatarUrl: character.avatarUrl }
    : character.defaultImage
      ? { defaultImage: { filepath: character.defaultImage } }
      : null

  return (
    <Link
      href={`/characters/${character.id}`}
      className={`qt-left-sidebar-item ${isCollapsed ? 'justify-center px-0' : ''}`}
      title={isCollapsed ? character.name : undefined}
    >
      <Avatar
        name={character.name}
        src={avatarSrc}
        size="xs"
        styleOverride="CIRCULAR"
      />
      {!isCollapsed && (
        <>
          <span className="qt-left-sidebar-item-label flex-1">{character.name}</span>
          {character.isFavorite && (
            <StarIcon className="w-3 h-3 text-yellow-500 flex-shrink-0" />
          )}
        </>
      )}
    </Link>
  )
}

export function CharactersSection() {
  const { isCollapsed } = useSidebar()
  const { shouldHideByIds } = useQuickHide()
  const { characters, loading } = useSidebarData()

  // Don't show section if loading or no characters
  if (loading) {
    return (
      <SidebarSection id="characters" title="Characters">
        <div className="px-2 py-1 text-xs text-muted-foreground animate-pulse">
          {!isCollapsed && 'Loading...'}
        </div>
      </SidebarSection>
    )
  }

  // Filter out characters with hidden tags
  const visibleCharacters = characters.filter(
    character => !shouldHideByIds(character.tags)
  )

  if (visibleCharacters.length === 0) {
    return (
      <SidebarSection id="characters" title="Characters">
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {!isCollapsed && 'No characters yet'}
        </div>
        <ViewAllLink href="/characters" label="Create one" />
      </SidebarSection>
    )
  }

  return (
    <SidebarSection id="characters" title="Characters">
      {visibleCharacters.slice(0, 5).map(character => (
        <CharacterItem
          key={character.id}
          character={character}
          isCollapsed={isCollapsed}
        />
      ))}
      <ViewAllLink href="/characters" />
    </SidebarSection>
  )
}
