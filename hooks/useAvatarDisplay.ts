import { useAvatarDisplayContext } from '@/components/providers/avatar-display-provider'

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

