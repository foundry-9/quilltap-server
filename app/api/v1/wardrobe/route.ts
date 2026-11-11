/**
 * Quilltap General Wardrobe — collection endpoint.
 *
 * GET  /api/v1/wardrobe                     — every item in Quilltap General's `Wardrobe/` folder
 * POST /api/v1/wardrobe                     — create an item there
 * GET  /api/v1/wardrobe?action=instructions — read the General dressing instructions
 * POST /api/v1/wardrobe?action=instructions — write (or clear) them
 * GET  /api/v1/wardrobe?action=analyze-image — the vision profiles image analysis may use
 * POST /api/v1/wardrobe?action=analyze-image — propose items from a picture
 * POST /api/v1/wardrobe?action=preview-avatar — a one-off avatar for an outfit snapshot
 * POST /api/v1/wardrobe?action=move-to-tier | copy-to-tier — move or copy an item between tiers
 *
 * Handler bodies: `lib/wardrobe/routes/wardrobe-route-factory.ts`.
 */

import type { NextRequest } from 'next/server';
import { createWardrobeCollectionHandlers } from '@/lib/wardrobe/routes/wardrobe-route-factory';
import { handleAnalyzeImage, handleAnalyzeImageProfiles } from '@/lib/wardrobe/routes/analyze-image';
import { handlePreviewAvatarAction } from '@/lib/wardrobe/routes/preview-avatar';
import { handleWardrobeTransfer } from '@/lib/wardrobe/routes/transfer';

const handlers = createWardrobeCollectionHandlers<Record<string, never>>({
  scope: 'general',
  paramsToId: () => null,
  logTag: '[Wardrobe Archetypes v1]',
  logIdKey: 'generalId',
  // Cross-tier and image actions live on the General collection alone.
  extraGetActions: { 'analyze-image': handleAnalyzeImageProfiles },
  extraPostActions: {
    'analyze-image': handleAnalyzeImage,
    'preview-avatar': handlePreviewAvatarAction,
    'move-to-tier': handleWardrobeTransfer('move'),
    'copy-to-tier': handleWardrobeTransfer('copy'),
  },
});

const noParams = { params: Promise.resolve({} as Record<string, never>) };

export const GET = (req: NextRequest) => handlers.GET(req, noParams);
export const POST = (req: NextRequest) => handlers.POST(req, noParams);
