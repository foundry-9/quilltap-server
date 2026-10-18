/**
 * Inventory — collection endpoint for a group's store.
 *
 * GET  /api/v1/groups/[id]/inventory                    — the tier's objects, resolved
 * GET  /api/v1/groups/[id]/inventory?action=folders     — its folders under `Inventory/`
 * GET  /api/v1/groups/[id]/inventory?action=archetypes  — archetypes reachable from here
 * POST /api/v1/groups/[id]/inventory                    — create an object, archetype or kit
 * POST /api/v1/groups/[id]/inventory?action=instantiate — make an instance of an archetype
 * POST …?action=create-folder | rename-folder | delete-folder | move-items | copy-items
 *
 * Handler bodies: `lib/inventory/routes/inventory-route-factory.ts`.
 */

import { createInventoryCollectionHandlers } from '@/lib/inventory/routes/inventory-route-factory';

export const { GET, POST } = createInventoryCollectionHandlers<{ id: string }>({
  scope: 'group',
  paramsToId: ({ id }) => id,
  logTag: '[Groups v1]',
  logIdKey: 'groupId',
});
