'use client'

/**
 * Avatar Display Provider
 *
 * The avatar display style (circular vs rectangular) for the whole app, read
 * off the shared chat-settings row (`useChatSettingsQuery`) and written
 * through `useChatSettingsMutation`. Because the style lives in the query
 * cache, a change made anywhere — this provider's `updateStyle` or the
 * settings card — re-renders every avatar at once; there is no private copy
 * to keep in step.
 *
 * Must sit inside `QueryProvider`.
 *
 * @module components/providers/avatar-display-provider
 */

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react'
import type { AvatarDisplayStyle } from '@/lib/avatar-styles'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { useChatSettingsMutation } from '@/hooks/useChatSettingsMutation'
import { ApiFetchError } from '@/lib/query/fetcher'

interface AvatarDisplayContextValue {
  /** Current avatar display style */
  style: AvatarDisplayStyle
  /** Whether the style is still being loaded */
  loading: boolean
  /** Error message if the read failed (an unauthenticated read is not an error) */
  error: string | null
  /** Update the avatar display style (persists to the API; rolls back on failure) */
  updateStyle: (newStyle: AvatarDisplayStyle) => Promise<void>
}

const AvatarDisplayContext = createContext<AvatarDisplayContextValue | null>(null)

export function AvatarDisplayProvider({ children }: { children: React.ReactNode }) {
  const { data, isPending, error: readError } = useChatSettingsQuery(
    (settings) => settings.avatarDisplayStyle,
  )
  const { save } = useChatSettingsMutation()

  // Default to circular until the row arrives, or when it cannot be read.
  const style: AvatarDisplayStyle = data ?? 'CIRCULAR'
  const loading = isPending && !readError
  const error = readError && !(readError instanceof ApiFetchError && readError.status === 401)
    ? readError.message
    : null

  // Mirror the style into the CSS variable the avatar frames read.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const radius = style === 'RECTANGULAR' ? 'var(--radius-md)' : '9999px'
      document.documentElement.style.setProperty('--qt-avatar-radius', radius)
    }
  }, [style])

  const updateStyle = useCallback(
    async (newStyle: AvatarDisplayStyle) => {
      await save({ avatarDisplayStyle: newStyle }, { failure: 'Failed to update avatar display style' })
    },
    [save],
  )

  const value = useMemo<AvatarDisplayContextValue>(
    () => ({ style, loading, error, updateStyle }),
    [style, loading, error, updateStyle],
  )

  return (
    <AvatarDisplayContext.Provider value={value}>
      {children}
    </AvatarDisplayContext.Provider>
  )
}

/**
 * Hook to access the avatar display context.
 * Must be used within an AvatarDisplayProvider.
 */
export function useAvatarDisplayContext() {
  const ctx = useContext(AvatarDisplayContext)
  if (!ctx) {
    throw new Error('useAvatarDisplayContext must be used within an AvatarDisplayProvider')
  }
  return ctx
}
