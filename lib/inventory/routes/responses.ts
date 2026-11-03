/**
 * The Inventory routes' shared answer: the Inventory's own refusals
 * ({@link INVENTORY_ITEM_ERRORS}: an `InventoryRefusal` is its `status` with
 * its `code` in `details`, a bad SVG or a foreign picture a `400`), mapped
 * through the item routes' one error mapping (`itemErrorResponse` /
 * `withItemErrors` in `lib/mount-index/item-folder-routes.ts`), which adds
 * the folder refusals and the archived-character `409` every kind shares.
 * {@link inventoryErrorResponse} and {@link withInventoryErrors} are that
 * mapping bound to the Inventory, for the routes outside the factory.
 *
 * Server-only.
 *
 * @module lib/inventory/routes/responses
 */

import type { NextResponse } from 'next/server';
import { badRequest, errorResponse } from '@/lib/api/responses';
import { InventoryRefusal } from '@/lib/inventory/errors';
import { InventorySvgError } from '@/lib/inventory/svg';
import { ForeignInventoryImageError } from '@/lib/inventory/item-images';
import { itemErrorResponse, withItemErrors, type ItemErrorKind } from '@/lib/mount-index/item-folder-routes';

/** The Inventory's own refusals, beside the folder and tombstone ones every kind shares. */
export const INVENTORY_ITEM_ERRORS: ItemErrorKind = {
  noun: 'inventory',
  refusals: (error) => {
    if (error instanceof InventoryRefusal) {
      return errorResponse(error.message, error.status, { code: error.code, ...error.details });
    }
    if (error instanceof InventorySvgError) return badRequest(error.message, { code: 'INVALID_SVG' });
    if (error instanceof ForeignInventoryImageError) return badRequest("imageFileId must name one of this object's own pictures");
    return null;
  },
};

/** The response for an Inventory refusal, or rethrow anything else. */
export function inventoryErrorResponse(error: unknown): NextResponse {
  return itemErrorResponse(INVENTORY_ITEM_ERRORS, error);
}

/**
 * Wrap a route handler so any Inventory refusal it throws answers through
 * {@link inventoryErrorResponse}. Anything else (a body that fails its Zod
 * schema, an unexpected error) propagates to the middleware as before.
 */
export const withInventoryErrors = withItemErrors(INVENTORY_ITEM_ERRORS);
