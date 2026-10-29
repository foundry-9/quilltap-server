/**
 * Quilltap General Inventory — item endpoint.
 *
 * GET    /api/v1/inventory/[itemId]                       — one General object, resolved
 * GET    /api/v1/inventory/[itemId]?action=dependents     — an archetype's instances, everywhere
 * PUT    /api/v1/inventory/[itemId]                       — edit it
 * PUT    /api/v1/inventory/[itemId]?action=clear-override — an instance inherits fields again
 * PUT    /api/v1/inventory/[itemId]?action=detach         — bake an instance into a standalone
 * DELETE /api/v1/inventory/[itemId][?force=true]          — delete it
 *
 * Handler bodies: `lib/inventory/routes/inventory-route-factory.ts`.
 */

import { createInventoryItemHandlers } from '@/lib/inventory/routes/inventory-route-factory';

export const { GET, PUT, DELETE } = createInventoryItemHandlers<{ itemId: string }>({
  scope: 'general',
  paramsToId: () => null,
  logTag: '[Inventory General v1]',
  logIdKey: 'generalId',
});
