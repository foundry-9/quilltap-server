/**
 * QueryClient factory for TanStack Query.
 *
 * A factory rather than a module-level singleton: a fresh client per provider
 * mount keeps SSR and test isolation clean (matches TanStack's Next.js
 * guidance). The defaults preserve the behaviour the app had under
 * `<SWRConfig>`: window-focus revalidation stays off, and a modest `staleTime`
 * keeps reads from refetching on every mount.
 */

import { QueryClient } from '@tanstack/react-query'

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // matches the app's "fresh enough" feel
        refetchOnWindowFocus: false, // preserve the old SWRConfig behaviour
        retry: 1,
      },
    },
  })
}
