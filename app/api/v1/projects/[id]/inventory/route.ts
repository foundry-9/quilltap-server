/**
 * Inventory — collection endpoint for a project's store.
 *
 * GET  /api/v1/projects/[id]/inventory                    — the tier's objects, resolved
 * GET  /api/v1/projects/[id]/inventory?action=folders     — its folders under `Inventory/`
 * GET  /api/v1/projects/[id]/inventory?action=archetypes  — archetypes reachable from here
 * POST /api/v1/projects/[id]/inventory                    — create an object, archetype or kit
 * POST /api/v1/projects/[id]/inventory?action=instantiate — make an instance of an archetype
 * POST …?action=create-folder | rename-folder | delete-folder | move-items | copy-items
 *
 * Handler bodies: `lib/inventory/routes/inventory-route-factory.ts`.
 */

import { createInventoryCollectionHandlers } from '@/lib/inventory/routes/inventory-route-factory';

export const { GET, POST } = createInventoryCollectionHandlers<{ id: string }>({
  scope: 'project',
  paramsToId: ({ id }) => id,
  logTag: '[Projects v1]',
  logIdKey: 'projectId',
});
