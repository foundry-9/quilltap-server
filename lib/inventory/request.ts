/**
 * The Inventory's client-side request helper: POST / PUT / DELETE JSON,
 * turning a refusal into an {@link InventoryRequestError} carrying the
 * server's `code` (`ARCHETYPE_IN_USE`, `CAP_EXCEEDED`, …) so a surface can
 * open the right warning instead of a bare toast.
 *
 * Client-safe. Re-exported from `lib/hooks/use-inventory`.
 *
 * @module lib/inventory/request
 */

import { apiFetch, apiErrorMessage, ApiFetchError } from '@/lib/query/fetcher'

/** A refused write, with the server's code and details. */
export class InventoryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly details: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'InventoryRequestError'
  }
}

/** POST / PUT / DELETE JSON, turning a refusal into an {@link InventoryRequestError}. */
export async function inventoryRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  try {
    return await apiFetch<T>(url, {
      method,
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (error instanceof ApiFetchError) {
      const info = (error.info ?? {}) as { details?: Record<string, unknown> }
      const details = info.details ?? {}
      throw new InventoryRequestError(
        apiErrorMessage(error, 'The Inventory would not oblige'),
        error.status,
        typeof details.code === 'string' ? details.code : null,
        details,
      )
    }
    throw error
  }
}
