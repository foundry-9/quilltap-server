/**
 * Shared fetcher for TanStack Query.
 *
 * Mirrors the throw-on-non-2xx semantics of `lib/swr-fetcher.ts` so components
 * that branch on `error.status` keep working when they move from SWR to
 * `useQuery`. Use as `queryFn: ({ signal }) => apiFetch<T>(url, { signal })` so
 * TanStack's cancellation `AbortSignal` is forwarded and in-flight reads abort
 * when a query is no longer observed.
 */

export class ApiFetchError extends Error {
  status: number
  info?: unknown

  constructor(message: string, status: number, info?: unknown) {
    super(message)
    this.name = 'ApiFetchError'
    this.status = status
    this.info = info
  }
}

export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let info: unknown = undefined
    try {
      info = await res.json()
    } catch {
      // response body wasn't JSON
    }
    throw new ApiFetchError(
      `Request to ${url} failed: ${res.status} ${res.statusText}`,
      res.status,
      info
    )
  }
  // 204 No Content (and other empty bodies) have nothing to parse.
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}
