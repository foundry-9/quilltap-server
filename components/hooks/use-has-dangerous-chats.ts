'use client'

/**
 * useHasDangerousChats
 *
 * Lightweight hook that checks whether any dangerous chats exist.
 * Used by the sidebar footer to decide whether to show the quick-hide button.
 *
 * @module components/hooks/use-has-dangerous-chats
 */

import { useState, useEffect } from 'react'

export function useHasDangerousChats() {
  const [hasDangerousChats, setHasDangerousChats] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const res = await fetch('/api/v1/chats?action=has-dangerous')
        if (res.ok && !cancelled) {
          const data = await res.json()
          setHasDangerousChats(data.hasDangerous === true)
        }
      } catch {
        // Silently ignore — worst case the quick-hide button doesn't appear
      }
    }

    check()
    return () => { cancelled = true }
  }, [])

  return { hasDangerousChats }
}
