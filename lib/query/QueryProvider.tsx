'use client'

/**
 * Client-side TanStack Query provider.
 *
 * Holds the QueryClient in `useState` so it survives re-renders but is recreated
 * on remount (and, importantly, is created per request rather than shared across
 * server requests). Mounts the devtools only in development.
 */

import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { makeQueryClient } from './query-client'

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        // `buttonPosition="relative"` drops the toggle out of its own fixed
        // overlay so this wrapper places it. We sit it in the bottom-right,
        // raised above the Next.js dev indicator (pinned bottom-right in
        // next.config.js) so the two don't stack on top of each other.
        <div style={{ position: 'fixed', bottom: 56, right: 16, zIndex: 99998 }}>
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="relative" />
        </div>
      )}
    </QueryClientProvider>
  )
}
