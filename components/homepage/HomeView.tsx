'use client'

/**
 * HomeView
 *
 * Presentational home dashboard: a greeting and quick actions, then three
 * bands sized to what they hold — the conversation last touched beside the
 * ones before it, the company of characters, and the projects shelf. Purely
 * props-driven — no data fetching of its own (`HomeViewContainer` feeds it).
 * See `docs/developer/features/complete/tabbed-workspace.md`.
 *
 * @module components/homepage/HomeView
 */

import type { CSSProperties } from 'react'
import {
  WelcomeSection,
  QuickActionsRow,
  ChatsBand,
  ProjectsSection,
  CharactersSection,
} from '@/components/homepage'
import type { RecentChat, HomepageProject, HomepageCharacter } from '@/components/homepage'

export interface HomeViewProps {
  displayName: string
  recentChats: RecentChat[]
  projects: HomepageProject[]
  characters: HomepageCharacter[]
  /** Every character the wall could show, the ones in `characters` included. */
  characterTotal?: number
  /**
   * A dynamic-background collage URL. Marking the root with
   * `--story-background-url` is what tells the theme's page background
   * (`--qt-page-background-image`) to stand aside, as it does for a story
   * background; the workspace backdrop paints the picture itself.
   */
  backgroundUrl?: string | null
}

export function HomeView({
  displayName,
  recentChats,
  projects,
  characters,
  characterTotal,
  backgroundUrl,
}: HomeViewProps) {
  return (
    <div
      className={backgroundUrl ? 'qt-homepage-container qt-homepage-backdrop' : 'qt-homepage-container'}
      style={backgroundUrl ? { '--story-background-url': `url('${backgroundUrl}')` } as CSSProperties : undefined}
    >
      {/* Greeting and quick actions, on one line */}
      <header className="qt-homepage-header">
        <WelcomeSection displayName={displayName} firstVisit={recentChats.length === 0} />
        <QuickActionsRow />
      </header>

      {/* Bands, each as tall as what it holds; the page scrolls */}
      <div className="qt-homepage-grid">
        <ChatsBand chats={recentChats} />
        <CharactersSection characters={characters} total={characterTotal ?? characters.length} />
        <ProjectsSection projects={projects} />
      </div>
    </div>
  )
}
