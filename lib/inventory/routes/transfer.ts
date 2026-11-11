/**
 * Inventory transfer — the handler behind
 * `POST /api/v1/inventory?action=move-to-tier` / `?action=copy-to-tier`
 * `{ itemId, from: { scope, id }, to: { scope, id } }`
 * (and, for one release, the old `POST /api/v1/inventory/transfers`, which took
 * `action` in the body).
 *
 * The rules (id kept on a move, `canCopy` on a copy, kits kept whole,
 * pictures carried) live in `transferInventoryItem`
 * (`lib/inventory/transfers.ts`), which `inventory_give` shares.
 *
 * @module lib/inventory/routes/transfer
 */

import type { NextRequest } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { badRequest, notFound, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { inventoryTransferSchema } from '@/lib/schemas/inventory.types';
import { resolveInventoryLocation } from '@/lib/inventory/location';
import { transferInventoryItem } from '@/lib/inventory/transfers';
import { withInventoryErrors } from '@/lib/inventory/routes/responses';

/** `mode` comes from the action; `'from-body'` is the deprecated path. */
export function handleInventoryTransfer(mode: 'move' | 'copy' | 'from-body') {
  return withInventoryErrors(async (req: NextRequest, { user, repos }: RequestContext) => {
    const raw = (await req.json()) as Record<string, unknown>;
    const body = inventoryTransferSchema.parse(mode === 'from-body' ? raw : { ...raw, action: mode });
    const source = await resolveInventoryLocation(body.from.scope, body.from.id, repos, user.id);
    const record = source ? await source.findItem(body.itemId) : null;
    if (!source || !record) return notFound('Inventory object');

    const destination = await resolveInventoryLocation(body.to.scope, body.to.id, repos, user.id, { ensure: true });
    if (!destination) return badRequest('Invalid destination');

    const { item } = await transferInventoryItem(repos, { action: body.action, source, destination, record, userId: user.id });
    logger.debug('[Inventory transfer] Done', { action: body.action, itemId: body.itemId, to: body.to.scope });
    return successResponse({ item });
  });
}
