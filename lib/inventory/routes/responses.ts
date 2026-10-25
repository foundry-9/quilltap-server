/**
 * The Inventory routes' shared answer: one mapping from every refusal the
 * Inventory can raise to its HTTP response (with the refusal's `code` in
 * `details`), and {@link withInventoryErrors}, which applies it to a whole
 * handler.
 *
 * Server-only.
 *
 * @module lib/inventory/routes/responses
 */

import { NextResponse } from 'next/server';
import { badRequest, conflict, errorResponse, notFound } from '@/lib/api/responses';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import {
  InventoryFolderConflictError,
  InventoryFolderNotFoundError,
  InventoryFolderPathError,
  InventoryItemNotInLocationError,
} from '@/lib/inventory/folders';
import { InventoryRefusal } from '@/lib/inventory/errors';
import { InventorySvgError } from '@/lib/inventory/svg';
import { ForeignInventoryImageError } from '@/lib/inventory/item-images';
import { logger } from '@/lib/logger';

/** The response for an Inventory refusal, or rethrow anything else. */
export function inventoryErrorResponse(error: unknown): NextResponse {
  if (error instanceof InventoryRefusal) {
    return errorResponse(error.message, error.status, { code: error.code, ...error.details });
  }
  if (error instanceof InventorySvgError) return badRequest(error.message, { code: 'INVALID_SVG' });
  if (error instanceof InventoryFolderPathError) return badRequest(error.message);
  if (error instanceof InventoryItemNotInLocationError) return badRequest(error.message);
  if (error instanceof ForeignInventoryImageError) return badRequest("imageFileId must name one of this object's own pictures");
  if (error instanceof InventoryFolderNotFoundError) return notFound('Inventory folder');
  if (error instanceof InventoryFolderConflictError) return conflict(error.message);
  if (error instanceof CharacterArchivedError) {
    logger.info('[Inventory routes] Refused a write to an archived character', { context: 'inventory' });
    return conflict("An archived character's inventory cannot be changed");
  }
  throw error;
}

/**
 * Wrap a route handler so any Inventory refusal it throws answers through
 * {@link inventoryErrorResponse}. Anything else (a body that fails its Zod
 * schema, an unexpected error) propagates to the middleware as before.
 */
export function withInventoryErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  };
}
