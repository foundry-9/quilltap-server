/**
 * The Inventory's client-side request helper: POST / PUT / DELETE JSON,
 * turning a refusal into an {@link InventoryRequestError} carrying the
 * server's `code` (`ARCHETYPE_IN_USE`, `CAP_EXCEEDED`, …) so a surface can
 * open the right warning. A binding of `createItemRequest`
 * (`lib/mount-index/item-request.ts`).
 *
 * Client-safe. Re-exported from `lib/hooks/use-inventory`.
 *
 * @module lib/inventory/request
 */

import { createItemRequest } from '@/lib/mount-index/item-request'

const bound = createItemRequest('InventoryRequestError', 'The Inventory would not oblige')

/** A refused write, with the server's code and details. */
export const InventoryRequestError = bound.RequestError
export type InventoryRequestError = InstanceType<typeof InventoryRequestError>

/** POST / PUT / DELETE JSON, turning a refusal into an {@link InventoryRequestError}. */
export const inventoryRequest = bound.request
