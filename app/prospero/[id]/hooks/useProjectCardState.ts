'use client'

/**
 * useProjectCardState Hook
 *
 * Manages the expanded/collapsed state of project detail cards.
 * On first visit to a project, all cards are expanded.
 * On subsequent visits, all cards are collapsed by default.
 *
 * @module app/prospero/[id]/hooks/useProjectCardState
 */

import { useState, useCallback } from 'react'

interface CardState {
  files: boolean
  characters: boolean
  settings: boolean
}

interface UseProjectCardStateReturn {
  cardState: CardState
  toggleCard: (card: keyof CardState) => void
  isFirstVisit: boolean
}

const STORAGE_KEY_PREFIX = 'quilltap_project_visited_'

/**
 * Get initial card state based on whether user has visited this project before
 */
function getInitialState(projectId: string): { cardState: CardState; isFirstVisit: boolean } {
  // Only check localStorage on client
  if (typeof window === 'undefined') {
    return {
      cardState: { files: true, characters: true, settings: true },
      isFirstVisit: true,
    }
  }

  const storageKey = `${STORAGE_KEY_PREFIX}${projectId}`
  const hasVisited = localStorage.getItem(storageKey)

  if (hasVisited) {
    // Not first visit - collapse all cards
    return {
      cardState: { files: false, characters: false, settings: false },
      isFirstVisit: false,
    }
  }

  // First visit - keep cards expanded and mark as visited
  localStorage.setItem(storageKey, 'true')
  return {
    cardState: { files: true, characters: true, settings: true },
    isFirstVisit: true,
  }
}

export function useProjectCardState(projectId: string): UseProjectCardStateReturn {
  // Use lazy initializer to get state from localStorage on first render
  const [state] = useState(() => getInitialState(projectId))
  const [cardState, setCardState] = useState<CardState>(state.cardState)
  const [isFirstVisit] = useState(state.isFirstVisit)

  const toggleCard = useCallback((card: keyof CardState) => {
    setCardState(prev => ({ ...prev, [card]: !prev[card] }))
  }, [])

  return {
    cardState,
    toggleCard,
    isFirstVisit,
  }
}
