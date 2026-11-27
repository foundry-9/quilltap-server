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
  modelBehavior: boolean
  imageGeneration: boolean
  documentStores: boolean
  scenarios: boolean
  wardrobe: boolean
  inventory: boolean
  atlas: boolean
}

interface UseProjectCardStateReturn {
  cardState: CardState
  toggleCard: (card: keyof CardState) => void
}

const STORAGE_KEY_PREFIX = 'quilltap_project_visited_'

function allCards(expanded: boolean): CardState {
  return {
    files: expanded,
    characters: expanded,
    settings: expanded,
    modelBehavior: expanded,
    imageGeneration: expanded,
    documentStores: expanded,
    scenarios: expanded,
    wardrobe: expanded,
    inventory: expanded,
    atlas: expanded,
  }
}

/**
 * Get initial card state based on whether user has visited this project before
 */
function getInitialState(projectId: string): CardState {
  // Only check localStorage on client
  if (typeof window === 'undefined') {
    return allCards(true)
  }

  const storageKey = `${STORAGE_KEY_PREFIX}${projectId}`
  const hasVisited = localStorage.getItem(storageKey)

  if (hasVisited) {
    // Not first visit - collapse all cards
    return allCards(false)
  }

  // First visit - keep cards expanded and mark as visited
  localStorage.setItem(storageKey, 'true')
  return allCards(true)
}

export function useProjectCardState(projectId: string): UseProjectCardStateReturn {
  // Use lazy initializer to get state from localStorage on first render
  const [cardState, setCardState] = useState<CardState>(() => getInitialState(projectId))

  const toggleCard = useCallback((card: keyof CardState) => {
    setCardState(prev => ({ ...prev, [card]: !prev[card] }))
  }, [])

  return {
    cardState,
    toggleCard,
  }
}
