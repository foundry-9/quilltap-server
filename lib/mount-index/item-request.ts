/**
 * The item families' client-side request helper: POST / PUT / DELETE JSON,
 * turning a refusal into a family-named error carrying the server's `code`
 * (`NAME_TAKEN`, `CAP_EXCEEDED`, …) so a surface can say something readable
 * instead of a bare toast. The Atlas and the Inventory bind it in their
 * `request.ts`.
 *
 * Client-safe.
 *
 * @module lib/mount-index/item-request
 */

import { apiFetch, apiErrorMessage, ApiFetchError } from '@/lib/query/fetcher'

/** Bind the helper for one family: its error's name and the fallback message. */
export function createItemRequest(errorName: string, fallbackMessage: string) {
  /** A refused write, with the server's code and details. */
  class ItemRequestError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code: string | null,
      readonly details: Record<string, unknown>,
    ) {
      super(message)
      this.name = errorName
    }
  }

  /** POST / PUT / DELETE JSON, turning a refusal into the family's request error. */
  async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
    try {
      return await apiFetch<T>(url, {
        method,
        ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
    } catch (error) {
      if (error instanceof ApiFetchError) {
        const info = (error.info ?? {}) as { details?: Record<string, unknown> }
        const details = info.details ?? {}
        throw new ItemRequestError(
          apiErrorMessage(error, fallbackMessage),
          error.status,
          typeof details.code === 'string' ? details.code : null,
          details,
        )
      }
      throw error
    }
  }

  return { RequestError: ItemRequestError, request }
}
