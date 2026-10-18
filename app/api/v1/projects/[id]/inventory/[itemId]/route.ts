/**
 * Inventory — item endpoint for a project's store.
 *
 * GET    /api/v1/projects/[id]/inventory/[itemId]                       — one object, resolved
 * GET    /api/v1/projects/[id]/inventory/[itemId]?action=dependents     — an archetype's instances, everywhere
 * PUT    /api/v1/projects/[id]/inventory/[itemId]                       — edit it (`archived` archives)
 * PUT    /api/v1/projects/[id]/inventory/[itemId]?action=clear-override — an instance inherits fields again
 * PUT    /api/v1/projects/[id]/inventory/[itemId]?action=detach         — bake an instance into a standalone
 * DELETE /api/v1/projects/[id]/inventory/[itemId][?force=true]          — delete (force bakes an archetype's instances first)
 *
 * Handler bodies: `lib/inventory/routes/inventory-route-factory.ts`.
 */

import { createInventoryItemHandlers } from '@/lib/inventory/routes/inventory-route-factory';

export const { GET, PUT, DELETE } = createInventoryItemHandlers<{ id: string; itemId: string }>({
  scope: 'project',
  paramsToId: ({ id }) => id,
  logTag: '[Projects v1]',
  logIdKey: 'projectId',
});
