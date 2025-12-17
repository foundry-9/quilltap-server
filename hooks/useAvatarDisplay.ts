import { useAvatarDisplayContext, useAvatarDisplayContextOptional } from '@/components/providers/avatar-display-provider'
import type { AvatarDisplayStyle } from '@/lib/avatar-styles'

/**
 * Hook to get the current avatar display style setting from the user's preferences.
 *
 * This hook uses the AvatarDisplayContext to share state across all components,
 * ensuring that the avatar style is consistent throughout the application and
 * that only one API call is made to fetch the setting.
 *
 * Must be used within an AvatarDisplayProvider.
 */
export function useAvatarDisplay() {
  const ctx = useAvatarDisplayContext()

  return {
    style: ctx.style,
    loading: ctx.loading,
    error: ctx.error,
    updateAvatarDisplayStyle: ctx.updateStyle,
    syncAvatarDisplayStyle: ctx.syncStyle,
  }
}

/**
 * Optional version that returns default values if used outside provider context.
 * Useful for components that may be rendered before provider is mounted.
 */
export function useAvatarDisplayOptional(): {
  style: AvatarDisplayStyle
  loading: boolean
  error: string | null
  updateAvatarDisplayStyle: ((newStyle: AvatarDisplayStyle) => Promise<void>) | null
  syncAvatarDisplayStyle: ((newStyle: AvatarDisplayStyle) => void) | null
} {
  const ctx = useAvatarDisplayContextOptional()

  if (!ctx) {
    return {
      style: 'CIRCULAR',
      loading: false,
      error: null,
      updateAvatarDisplayStyle: null,
      syncAvatarDisplayStyle: null,
    }
  }

  return {
    style: ctx.style,
    loading: ctx.loading,
    error: ctx.error,
    updateAvatarDisplayStyle: ctx.updateStyle,
    syncAvatarDisplayStyle: ctx.syncStyle,
  }
}
