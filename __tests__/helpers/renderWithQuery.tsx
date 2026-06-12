/**
 * Test harness for components/hooks that read through TanStack Query.
 *
 * Mounts a fresh `QueryClient` per render with retries off and `gcTime: 0`, the
 * deterministic, isolated-per-test analogue of the old SWR wrapper
 * `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>`.
 * `fetch` is still mocked globally via `jest-fetch-mock` (see `jest.setup.ts`),
 * so endpoint stubs don't change — only the wrapper does.
 */

import React, { type ReactElement, type ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithQuery(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient }
) {
  const queryClient = options?.queryClient ?? createTestQueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...options }),
  }
}
