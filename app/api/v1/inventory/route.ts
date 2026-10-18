/**
 * Quilltap General Inventory — collection endpoint.
 *
 * GET  /api/v1/inventory                    — every object in Quilltap General's `Inventory/`
 * GET  /api/v1/inventory?action=folders     — its folders
 * GET  /api/v1/inventory?action=archetypes  — General's archetypes
 * POST /api/v1/inventory                    — create an object, archetype or kit there
 * POST /api/v1/inventory?action=instantiate — make an instance of an archetype there
 * POST …?action=create-folder | rename-folder | delete-folder | move-items | copy-items
 *
 * Handler bodies: `lib/inventory/routes/inventory-route-factory.ts`.
 */

import type { NextRequest } from 'next/server';
import { createInventoryCollectionHandlers } from '@/lib/inventory/routes/inventory-route-factory';

const handlers = createInventoryCollectionHandlers<Record<string, never>>({
  scope: 'general',
  paramsToId: () => null,
  logTag: '[Inventory General v1]',
  logIdKey: 'generalId',
});

const noParams = { params: Promise.resolve({} as Record<string, never>) };

export const GET = (req: NextRequest) => handlers.GET(req, noParams);
export const POST = (req: NextRequest) => handlers.POST(req, noParams);
