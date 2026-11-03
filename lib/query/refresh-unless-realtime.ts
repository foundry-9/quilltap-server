'use client'

/**
 * The refresh strategy for a write whose server path publishes a realtime
 * topic: after this tab's own write, refresh `keys` only while the realtime
 * socket is down. While it is up, the server's publish for that write
 * refreshes the same keys (`lib/realtime/topic-map.ts`), and refreshing here
 * as well would fetch everything twice. A socket that drops before the hint
 * arrives re-reads every realtime key when it reconnects (`RealtimeProvider`).
 *
 * Only for writes that really do publish: a write with no topic behind it
 * must invalidate unconditionally, or a connected tab never sees its own
 * change.
 *
 * @module lib/query/refresh-unless-realtime
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { getRealtimeStatus } from '@/lib/realtime/client'

export function refreshUnlessRealtime(queryClient: QueryClient, keys: readonly QueryKey[]): Promise<unknown> {
  if (getRealtimeStatus() === 'connected') return Promise.resolve()
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}
