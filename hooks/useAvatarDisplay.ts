import { useAvatarDisplayContext } from '@/components/providers/avatar-display-provider'

/**
 * Hook to get the current avatar display style setting from the user's preferences.
 *
 * The style comes from the shared chat-settings query, so every reader stays
 * in step with a change made anywhere.
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
  }
}

