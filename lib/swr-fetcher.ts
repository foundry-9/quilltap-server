/**
 * Shared SWR fetcher and provider config.
 *
 * Default JSON fetcher that throws on non-2xx so SWR's `error` state fires.
 * Use via <SWRConfig value={{ fetcher: swrFetcher }}> at the app root, or
 * pass inline: useSWR(url, swrFetcher).
 */

export class SwrFetchError extends Error {
  status: number
  info?: unknown

  constructor(message: string, status: number, info?: unknown) {
    super(message)
    this.name = 'SwrFetchError'
    this.status = status
    this.info = info
  }
}

export async function swrFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    let info: unknown = undefined
    try {
      info = await res.json()
    } catch {
      // response body wasn't JSON
    }
    throw new SwrFetchError(
      `Request to ${url} failed: ${res.status} ${res.statusText}`,
      res.status,
      info
    )
  }
  return res.json() as Promise<T>
}
