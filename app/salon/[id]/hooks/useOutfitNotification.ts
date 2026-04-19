'use client'

/**
 * useOutfitNotification Hook
 *
 * Manages pending outfit/wardrobe change notifications in localStorage.
 * When a character's outfit changes (via sidebar equip or gift), the
 * notification is stored here. The ChatComposer reads this state and
 * offers a "Notify" button that inserts the change description into
 * the message textarea.
 *
 * @module salon/hooks/useOutfitNotification
 */

import { useState, useCallback, useEffect } from 'react'
import { logger } from '@/lib/logger'

// ============================================================================
// TYPES
// ============================================================================

export interface OutfitNotificationEntry {
  /** 'clothing' for equip changes, 'wardrobe' for gifted items */
  type: 'clothing' | 'wardrobe'
  /** The outfit/item description text (markdown list) */
  description: string
}

/** Pending notifications keyed by character name */
export type OutfitNotifications = Record<string, OutfitNotificationEntry>

// ============================================================================
// HELPERS
// ============================================================================

function storageKey(chatId: string): string {
  return `quilltap-outfit-notify-${chatId}`
}

function readFromStorage(chatId: string): OutfitNotifications {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(storageKey(chatId))
    if (!raw) return {}
    return JSON.parse(raw) as OutfitNotifications
  } catch {
    return {}
  }
}

function writeToStorage(chatId: string, notifications: OutfitNotifications): void {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(notifications).length === 0) {
      localStorage.removeItem(storageKey(chatId))
    } else {
      localStorage.setItem(storageKey(chatId), JSON.stringify(notifications))
    }
  } catch (err) {
    logger.warn('[useOutfitNotification] Failed to write localStorage', {
      chatId, error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ============================================================================
// HOOK
// ============================================================================

export function useOutfitNotification(chatId: string) {
  const [notifications, setNotifications] = useState<OutfitNotifications>(() =>
    readFromStorage(chatId)
  )

  // Sync state when chatId changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch triggered on mount; return signature contract predates useSWR migration
    setNotifications(readFromStorage(chatId))
  }, [chatId])

  /**
   * Add or update a notification for a character.
   * For 'clothing' type, overwrites any existing entry (latest outfit wins).
   * For 'wardrobe' type, overwrites any existing entry for that character.
   */
  const addNotification = useCallback((
    characterName: string,
    type: 'clothing' | 'wardrobe',
    description: string,
  ) => {
    setNotifications(prev => {
      const next = { ...prev, [characterName]: { type, description } }
      writeToStorage(chatId, next)
      logger.debug('[useOutfitNotification] Added notification', {
        chatId, characterName, type, context: 'wardrobe',
      })
      return next
    })
  }, [chatId])

  /**
   * Consume all pending notifications, returning them and clearing state.
   */
  const consumeNotifications = useCallback((): OutfitNotifications => {
    const current = readFromStorage(chatId)
    writeToStorage(chatId, {})
    setNotifications({})
    logger.debug('[useOutfitNotification] Consumed notifications', {
      chatId, count: Object.keys(current).length, context: 'wardrobe',
    })
    return current
  }, [chatId])

  const hasPending = Object.keys(notifications).length > 0
  const pendingCount = Object.keys(notifications).length

  return {
    notifications,
    hasPending,
    pendingCount,
    addNotification,
    consumeNotifications,
  }
}
