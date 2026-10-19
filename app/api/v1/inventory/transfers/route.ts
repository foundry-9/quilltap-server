/**
 * Inventory transfer API.
 *
 * POST /api/v1/inventory/transfers
 *   `{ action: 'move' | 'copy', itemId, from: { scope, id }, to: { scope, id } }`
 *   Moves or copies one Inventory object between tiers.
 *
 * The rules (id kept on a move, `canCopy` on a copy, kits kept whole,
 * pictures carried) live in `transferInventoryItem`
 * (`lib/inventory/transfers.ts`), which `inventory_give` shares.
 */

import { createContextHandler } from '@/lib/api/middleware';
import { badRequest, notFound, successResponse } from '@/lib/api/responses';
import { inventoryTransferSchema } from '@/lib/schemas/inventory.types';
import { resolveInventoryLocation } from '@/lib/inventory/location';
import { transferInventoryItem } from '@/lib/inventory/transfers';
import { inventoryErrorResponse } from '@/lib/inventory/routes/responses';

export const POST = createContextHandler(async (req, { user, repos }) => {
  const body = inventoryTransferSchema.parse(await req.json());
  try {
    const source = await resolveInventoryLocation(body.from.scope, body.from.id, repos, user.id);
    const record = source ? await source.findItem(body.itemId) : null;
    if (!source || !record) return notFound('Inventory object');

    const destination = await resolveInventoryLocation(body.to.scope, body.to.id, repos, user.id, { ensure: true });
    if (!destination) return badRequest('Invalid destination');

    const { item } = await transferInventoryItem(repos, { action: body.action, source, destination, record, userId: user.id });
    return successResponse({ item });
  } catch (error) {
    return inventoryErrorResponse(error);
  }
});
