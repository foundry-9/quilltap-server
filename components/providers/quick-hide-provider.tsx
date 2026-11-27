'use client'

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react'
import { useSession } from '@/components/providers/session-provider'
import { useTagsQuery } from '@/lib/hooks/use-tags'
import { booleanCodec, usePersistentState, type PersistentStateCodec } from '@/hooks/usePersistentState'
import { conciergeStateUsesUncensoredRoute, type ConciergeState } from '@/lib/services/dangerous-content/chat-override'

interface QuickHideTag {
  id: string
  name: string
}

interface QuickHideContextValue {
  quickHideTags: QuickHideTag[]
  hiddenTagIds: Set<string>
  hideDangerousChats: boolean
  /**
   * When true, /salon includes autonomous rooms even when the user-level
   * visibility default would otherwise hide them. Persisted in localStorage
   * so the choice survives reloads.
   */
  includeAutonomousRooms: boolean
  /**
   * When true, the Salon withholds every image it would paint — the story
   * background, avatars in the transcript and the participant sidebar, and
   * attached or embedded images. Off by default; persisted in localStorage.
   */
  hideSalonImages: boolean
  loading: boolean
  toggleTag: (tagId: string) => void
  toggleHideDangerousChats: () => void
  toggleIncludeAutonomousRooms: () => void
  toggleHideSalonImages: () => void
  clearAllHidden: () => void
  shouldHideByIds: (tagIds?: Array<string | null | undefined>) => boolean
  /**
   * THE quick-hide rule for a chat, in one place. "Dangerous Chats" hides
   * whatever takes the uncensored route — an Unmoderated chat, whether the
   * Concierge or the operator put it there — never a Moderated or Locked chat
   * that merely carries the classifier's telemetry underneath.
   */
  shouldHideChat: (chat: { characterTags?: Array<string | null | undefined>; conciergeState?: ConciergeState }) => boolean
}

const STORAGE_KEY = 'quilltap.quickHide.activeTags'
const DANGER_STORAGE_KEY = 'quilltap.quickHide.hideDangerous'
const AUTONOMOUS_STORAGE_KEY = 'quilltap.quickHide.includeAutonomousRooms'
const SALON_IMAGES_STORAGE_KEY = 'quilltap.quickHide.hideSalonImages'

const QuickHideContext = createContext<QuickHideContextValue | null>(null)

/** The hidden tag ids, stored as a JSON array of strings. */
const tagIdSetCodec: PersistentStateCodec<Set<string>> = {
  parse: (raw) => {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === 'string')) : undefined
  },
  serialize: (ids) => JSON.stringify(Array.from(ids)),
}

/** The tags marked for the quick-hide menu, from the shared tag list. */
function toQuickHideTags(tags: Array<{ id: string; name: string; quickHide?: boolean }>): QuickHideTag[] {
  return tags.filter((tag) => Boolean(tag.quickHide)).map((tag) => ({ id: tag.id, name: tag.name }))
}

const NO_TAGS: QuickHideTag[] = []

export function QuickHideProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const authenticated = status === 'authenticated'
  const tagsQuery = useTagsQuery({ enabled: authenticated, select: toQuickHideTags })
  const loadedTags = authenticated ? tagsQuery.data : undefined
  const quickHideTags = loadedTags ?? NO_TAGS
  const loading = tagsQuery.isLoading
  const [hiddenTagIds, setHiddenTagIds] = usePersistentState(STORAGE_KEY, new Set<string>(), tagIdSetCodec)
  const [hideDangerousChats, setHideDangerousChats] = usePersistentState(DANGER_STORAGE_KEY, false, booleanCodec)
  const [includeAutonomousRooms, setIncludeAutonomousRooms] = usePersistentState(AUTONOMOUS_STORAGE_KEY, false, booleanCodec)
  const [hideSalonImages, setHideSalonImages] = usePersistentState(SALON_IMAGES_STORAGE_KEY, false, booleanCodec)

  useEffect(() => {
    if (tagsQuery.error) {
      console.warn('Unable to load quick-hide tags', { error: tagsQuery.error.message })
    }
  }, [tagsQuery.error])

  // A hidden tag that is no longer a quick-hide tag stops hiding anything.
  useEffect(() => {
    if (!loadedTags) return
    // Prunes the stored selection against the tag list once it arrives.
    setHiddenTagIds(prev => {
      const allowed = new Set(loadedTags.map(tag => tag.id))
      const next = new Set([...prev].filter(id => allowed.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [loadedTags, setHiddenTagIds])

  const toggleTag = useCallback((tagId: string) => {
    setHiddenTagIds((prev) => {
      const next = new Set(prev)
      const wasHidden = next.has(tagId)
      if (wasHidden) {
        next.delete(tagId)
      } else {
        next.add(tagId)
      }
      return next
    })
  }, [setHiddenTagIds])

  const toggleHideDangerousChats = useCallback(() => {
    setHideDangerousChats(prev => !prev)
  }, [setHideDangerousChats])

  const toggleIncludeAutonomousRooms = useCallback(() => {
    setIncludeAutonomousRooms(prev => !prev)
  }, [setIncludeAutonomousRooms])

  const toggleHideSalonImages = useCallback(() => {
    setHideSalonImages(prev => !prev)
  }, [setHideSalonImages])

  const clearAllHidden = useCallback(() => {
    setHiddenTagIds(new Set())
    setHideDangerousChats(false)
    setHideSalonImages(false)
    // Note: includeAutonomousRooms is an "include" toggle (adds items),
    // not a "hide" toggle, so it is not reset by Clear All Hidden.
  }, [setHiddenTagIds, setHideDangerousChats, setHideSalonImages])

  const shouldHideByIds = useCallback(
    (tagIds?: Array<string | null | undefined>) => {
      if (!tagIds || tagIds.length === 0) {
        return false
      }
      for (const tagId of tagIds) {
        if (tagId && hiddenTagIds.has(tagId)) {
          return true
        }
      }
      return false
    },
    [hiddenTagIds]
  )

  const shouldHideChat = useCallback(
    (chat: { characterTags?: Array<string | null | undefined>; conciergeState?: ConciergeState }) => {
      if (shouldHideByIds(chat.characterTags)) {
        return true
      }
      if (hideDangerousChats && chat.conciergeState && conciergeStateUsesUncensoredRoute(chat.conciergeState)) {
        return true
      }
      return false
    },
    [shouldHideByIds, hideDangerousChats]
  )

  const value = useMemo<QuickHideContextValue>(
    () => ({
      quickHideTags,
      hiddenTagIds,
      hideDangerousChats,
      includeAutonomousRooms,
      hideSalonImages,
      loading,
      toggleTag,
      toggleHideDangerousChats,
      toggleIncludeAutonomousRooms,
      toggleHideSalonImages,
      clearAllHidden,
      shouldHideByIds,
      shouldHideChat,
    }),
    [quickHideTags, hiddenTagIds, hideDangerousChats, includeAutonomousRooms, hideSalonImages, loading, toggleTag, toggleHideDangerousChats, toggleIncludeAutonomousRooms, toggleHideSalonImages, clearAllHidden, shouldHideByIds, shouldHideChat]
  )

  return <QuickHideContext.Provider value={value}>{children}</QuickHideContext.Provider>
}

export function useQuickHide() {
  const ctx = useContext(QuickHideContext)
  if (!ctx) {
    throw new Error('useQuickHide must be used within a QuickHideProvider')
  }
  return ctx
}
