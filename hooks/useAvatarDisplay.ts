import { useEffect, useState } from 'react'
import type { AvatarDisplayStyle } from '@/lib/avatar-styles'
import { clientLogger } from '@/lib/client-logger'

/**
 * Hook to get the current avatar display style setting from the user's preferences
 * Fetches from the API on mount and provides the style preference
 */
export function useAvatarDisplay() {
  const [style, setStyle] = useState<AvatarDisplayStyle>('CIRCULAR')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchAvatarDisplayStyle = async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/chat-settings')
        if (!res.ok) {
          // 401 is expected when not logged in - don't log as error
          if (res.status === 401) {
            clientLogger.debug('Not authenticated, using default avatar display style')
            setStyle('CIRCULAR')
            return
          }
          throw new Error(`Failed to fetch chat settings: ${res.status} ${res.statusText}`)
        }

        // Parse JSON separately to catch parse errors
        let data
        try {
          data = await res.json()
        } catch (parseErr) {
          clientLogger.warn('Failed to parse chat settings response as JSON, using defaults')
          setStyle('CIRCULAR')
          return
        }

        setStyle((data.avatarDisplayStyle || 'CIRCULAR') as AvatarDisplayStyle)
      } catch (err) {
        // Network errors (like CORS, offline, etc.) are expected in some cases
        // Don't log them at error level to avoid console noise
        if (err instanceof TypeError && err.message.includes('fetch')) {
          clientLogger.debug('Network error fetching avatar display style, using defaults', {
            message: err.message
          })
          setStyle('CIRCULAR')
          return
        }

        // Robust error extraction - handle various error types
        let errorMessage = 'Unknown error'
        if (err instanceof Error) {
          errorMessage = err.message || err.name || 'Error (no message)'
        } else if (typeof err === 'string') {
          errorMessage = err || 'Empty string error'
        } else if (err !== null && err !== undefined) {
          try {
            const stringified = JSON.stringify(err)
            errorMessage = stringified !== '{}' ? stringified : 'Empty object error'
          } catch {
            errorMessage = String(err) || 'Unstringifiable error'
          }
        }
        clientLogger.warn('Error fetching avatar display style', {
          error: errorMessage,
          errorType: err?.constructor?.name || typeof err
        })
        setError(errorMessage)
        // Default to circular on error
        setStyle('CIRCULAR')
      } finally {
        setLoading(false)
      }
    }

    fetchAvatarDisplayStyle()
  }, [])

  const updateAvatarDisplayStyle = async (newStyle: AvatarDisplayStyle) => {
    const previousStyle = style
    try {
      setStyle(newStyle)
      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarDisplayStyle: newStyle }),
      })

      if (!res.ok) {
        throw new Error(`Failed to update avatar display style: ${res.status} ${res.statusText}`)
      }

      // Parse JSON separately to catch parse errors
      let data
      try {
        data = await res.json()
      } catch {
        // Update succeeded but response parse failed - keep the optimistic update
        clientLogger.warn('Failed to parse update response, keeping optimistic style')
        return
      }

      setStyle((data.avatarDisplayStyle || 'CIRCULAR') as AvatarDisplayStyle)
    } catch (err) {
      // Robust error extraction - handle various error types
      let errorMessage = 'Unknown error'
      if (err instanceof Error) {
        errorMessage = err.message || err.name || 'Error (no message)'
      } else if (typeof err === 'string') {
        errorMessage = err || 'Empty string error'
      } else if (err !== null && err !== undefined) {
        try {
          const stringified = JSON.stringify(err)
          errorMessage = stringified !== '{}' ? stringified : 'Empty object error'
        } catch {
          errorMessage = String(err) || 'Unstringifiable error'
        }
      }
      clientLogger.error('Error updating avatar display style', {
        error: errorMessage,
        errorType: err?.constructor?.name || typeof err,
        attemptedStyle: newStyle
      })
      setError(errorMessage)
      // Revert to previous style on error
      setStyle(previousStyle)
    }
  }

  return { style, loading, error, updateAvatarDisplayStyle }
}
