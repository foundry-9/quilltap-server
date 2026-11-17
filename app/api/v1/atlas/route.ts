/**
 * Quilltap General Atlas — collection endpoint.
 *
 * GET  /api/v1/atlas                  — every entry in Quilltap General's `Atlas/`
 * GET  /api/v1/atlas?action=folders   — its folders
 * GET  /api/v1/atlas?action=overlaps  — terms its entries share with other entries or characters
 * POST /api/v1/atlas                  — create an entry there
 * POST …?action=duplicate | create-folder | rename-folder | delete-folder | move-items | copy-items
 * POST …?action=move-to-tier | copy-to-tier — between tiers
 * POST …?action=draft-from-lore — Brahma drafts an entry from the lore (SSE; files nothing)
 * GET  …?action=lore-defaults&scope=&id= — the connection profile Brahma would draft with
 *
 * Handler bodies: `lib/atlas/routes/atlas-route-factory.ts`.
 */

import type { NextRequest } from 'next/server';
import { createAtlasCollectionHandlers } from '@/lib/atlas/routes/atlas-route-factory';
import { handleAtlasTransfer } from '@/lib/atlas/routes/transfer';
import { handleAtlasLoreDefaults, handleAtlasLoreDraft } from '@/lib/atlas/routes/lore-draft';

const handlers = createAtlasCollectionHandlers<Record<string, never>>({
  scope: 'general',
  paramsToId: () => null,
  logTag: '[Atlas General v1]',
  logIdKey: 'generalId',
  // Cross-tier moves live on the General collection alone.
  extraPostActions: {
    'move-to-tier': handleAtlasTransfer('move'),
    'copy-to-tier': handleAtlasTransfer('copy'),
    // Brahma drafts an entry from the lore, for any tier (the target is in the body).
    'draft-from-lore': handleAtlasLoreDraft,
  },
  extraGetActions: {
    'lore-defaults': handleAtlasLoreDefaults,
  },
});

const noParams = { params: Promise.resolve({} as Record<string, never>) };

export const GET = (req: NextRequest) => handlers.GET(req, noParams);
export const POST = (req: NextRequest) => handlers.POST(req, noParams);
