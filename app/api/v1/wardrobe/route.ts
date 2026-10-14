/**
 * Quilltap General Wardrobe — collection endpoint.
 *
 * GET  /api/v1/wardrobe                     — every item in Quilltap General's `Wardrobe/` folder
 * POST /api/v1/wardrobe                     — create an item there
 * GET  /api/v1/wardrobe?action=instructions — read the General dressing instructions
 * POST /api/v1/wardrobe?action=instructions — write (or clear) them
 *
 * Handler bodies: `lib/wardrobe/routes/wardrobe-route-factory.ts`.
 */

import type { NextRequest } from 'next/server';
import { createWardrobeCollectionHandlers } from '@/lib/wardrobe/routes/wardrobe-route-factory';

const handlers = createWardrobeCollectionHandlers<Record<string, never>>({
  scope: 'general',
  paramsToId: () => null,
  logTag: '[Wardrobe Archetypes v1]',
  logIdKey: 'generalId',
});

const noParams = { params: Promise.resolve({} as Record<string, never>) };

export const GET = (req: NextRequest) => handlers.GET(req, noParams);
export const POST = (req: NextRequest) => handlers.POST(req, noParams);
