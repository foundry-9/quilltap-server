'use client'

import { useSearchParams } from 'next/navigation'

/**
 * Reads the `section` query parameter from the URL for deep-linking
 * to a specific CollapsibleCard within a settings tab.
 *
 * Usage: `/settings?tab=chat&section=token-display`
 */
export function useSettingsSection(): string | null {
  const searchParams = useSearchParams()
  return searchParams.get('section') || null
}
