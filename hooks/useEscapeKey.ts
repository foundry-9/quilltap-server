'use client'

import { useEffect } from 'react'

/**
 * Dismiss a dialog/popover when the user presses Escape.
 *
 * Pass `enabled = false` to gate the listener (e.g. while an in-flight
 * operation makes dismissing unsafe). The handler is bound on every render
 * where `onEscape` changes, so the callback should be memoised if it captures
 * frequently-changing state.
 */
export function useEscapeKey(onEscape: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [onEscape, enabled])
}
