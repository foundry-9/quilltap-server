/**
 * The Atlas's client-side request helper: POST / PUT / DELETE JSON, turning a
 * refusal into an {@link AtlasRequestError} carrying the server's `code`
 * (`NAME_TAKEN`, `INVALID_SHAPE`, …) so a surface can say something readable
 * instead of a bare toast.
 *
 * Client-safe. Re-exported from `lib/hooks/use-atlas`.
 *
 * @module lib/atlas/request
 */

import { apiFetch, apiErrorMessage, ApiFetchError } from '@/lib/query/fetcher'

/** A refused write, with the server's code and details. */
export class AtlasRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly details: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AtlasRequestError'
  }
}

/** POST / PUT / DELETE JSON, turning a refusal into an {@link AtlasRequestError}. */
export async function atlasRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  try {
    return await apiFetch<T>(url, {
      method,
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (error instanceof ApiFetchError) {
      const info = (error.info ?? {}) as { details?: Record<string, unknown> }
      const details = info.details ?? {}
      throw new AtlasRequestError(
        apiErrorMessage(error, 'The Atlas would not oblige'),
        error.status,
        typeof details.code === 'string' ? details.code : null,
        details,
      )
    }
    throw error
  }
}
