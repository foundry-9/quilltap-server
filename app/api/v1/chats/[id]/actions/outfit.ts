/**
 * Chats API v1 - Outfit Actions
 *
 * GET /api/v1/chats/[id]?action=outfit         — Get equipped outfit state
 * GET /api/v1/chats/[id]?action=outfit-summary — Per-character resolved title summary
 * POST /api/v1/chats/[id]?action=equip         — Mutate equipped state
 *
 * The POST body's put-on modes go through `lib/wardrobe/wear-ops.ts` — the
 * same resolution and refusals as the `wardrobe_wear` tool (an archived item
 * is never put on, bug 191) — and every mode commits through
 * `applyDisplacement`. `remove_from_slot` takes one item out of ONE slot; the
 * `wardrobe_take_off` tool's `remove` loops it over every slot the item covers.
 * The operator is dressing the character, so the project roster doesn't apply.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { serverError, notFound, badRequest } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { applyDisplacement } from '@/lib/wardrobe/outfit-displacement';
import { isComposite, WARDROBE_SLOT_TYPES, EquippedSlotsSchema, WardrobeItemTypeEnum, bySlot } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { loadCastPools, loadWearablePool, type WearablePool } from '@/lib/wardrobe/pool';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { notifyWardrobeChanged } from '@/lib/wardrobe/outfit-change-effects';
import { wornBundlesFor, type WornBundle } from '@/lib/wardrobe/slot-ops';
import { resolveWearable, wearItem, type PutOnMode } from '@/lib/wardrobe/wear-ops';
import { newlyWornArchivedItems, wearRefusal } from '@/lib/wardrobe/wearable';

const equipBodySchema = z
  .object({
    characterId: z.string().min(1, 'characterId is required'),
    // `wear` honors the item's `replace` flag; `replace` force-swaps the slots
    // it covers. `equip` is a deprecated alias for `wear`.
    mode: z.enum(['wear', 'replace', 'equip', 'add_to_slot', 'remove_from_slot', 'clear_slot', 'set_all']),
    slot: WardrobeItemTypeEnum.optional(),
    itemId: z.string().nullable().optional(),
    /** Required when mode === 'set_all'. Replaces every slot atomically. */
    slots: EquippedSlotsSchema.optional(),
    /**
     * `set_all` only: bundles the client dissolved into `slots` (the dialog
     * stages bundles as their leaves). A claim, not a fact — the server
     * validates each against the character's reachable tiers, expands it to
     * its leaves, and the wear ledger credits it only if one of those leaves
     * was newly put on.
     */
    wornBundleIds: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.mode === 'add_to_slot' ||
        value.mode === 'remove_from_slot' ||
        value.mode === 'clear_slot') &&
      !value.slot
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slot'],
        message: `slot is required for mode "${value.mode}"`,
      });
    }
    if (
      (value.mode === 'wear' ||
        value.mode === 'replace' ||
        value.mode === 'equip' ||
        value.mode === 'add_to_slot') &&
      !value.itemId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itemId'],
        message: `itemId is required for mode "${value.mode}"`,
      });
    }
    if (value.mode === 'set_all' && !value.slots) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slots'],
        message: 'slots is required for mode "set_all"',
      });
    }
  });

/**
 * GET ?action=outfit — Return the full equipped outfit state for this chat
 */
export async function handleGetOutfit(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {

    const equippedOutfit = await repos.chats.getEquippedOutfit(chatId);

    return NextResponse.json({ equippedOutfit: equippedOutfit ?? {} });
  } catch (error) {
    logger.error('[Chats v1] Error fetching equipped outfit', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch equipped outfit');
  }
}

/**
 * GET ?action=outfit-summary — Return per-character equipped outfit with
 * resolved item titles. Each character's slots resolve against their own
 * wearable pool (the project and General tiers read once for the cast) by the
 * canonical rule: composites expanded, each leaf routed into every slot its
 * own `types` cover. Shape:
 *
 *   { summary: { [characterId]: { [slot]: [{ itemId, title }, ...] } } }
 */
export async function handleGetOutfitSummary(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    const equippedOutfit = (await repos.chats.getEquippedOutfit(chatId)) ?? {};
    const characterIds = Object.keys(equippedOutfit);
    const pools = await loadCastPools(repos, chat.projectId, characterIds);

    type SummaryEntry = { itemId: string; title: string };
    const summary: Record<string, Record<string, SummaryEntry[]>> = {};

    for (const [characterId, slots] of Object.entries(equippedOutfit)) {
      const pool = pools.get(characterId);
      if (!slots || !pool) {
        summary[characterId] = bySlot<SummaryEntry[]>(() => []);
        continue;
      }
      const { leafItemsBySlot } = resolveEquippedOutfitForCharacter(pool, slots);
      summary[characterId] = bySlot((slot) =>
        leafItemsBySlot[slot].map((leaf) => ({ itemId: leaf.id, title: leaf.title })),
      );
    }

    logger.debug('[Chats v1] Built outfit summary', {
      chatId,
      characterCount: characterIds.length,
      context: 'wardrobe',
    });
    return NextResponse.json({ summary });
  } catch (error) {
    logger.error('[Chats v1] Error fetching equipped outfit summary', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch equipped outfit summary');
  }
}

/**
 * Turn a `set_all` request's `wornBundleIds` into the ledger's composite
 * credit. Ids the character cannot reach, and items that are not composites,
 * are dropped (a client cannot credit a garment it cannot see); each survivor
 * is expanded to its leaves over the pool.
 */
function resolveWornBundles(pool: WearablePool, wornBundleIds: string[]): WornBundle[] {
  const ids = Array.from(new Set(wornBundleIds));
  if (ids.length === 0) return [];
  const result = pool
    .getMany(ids)
    .filter(isComposite)
    .flatMap((bundle) => wornBundlesFor(bundle, pool.byId));
  if (result.length !== ids.length) {
    logger.debug('[Chats v1] Some claimed worn bundles were not credited', {
      characterId: pool.characterId,
      claimed: ids.length,
      resolved: result.length,
      context: 'wardrobe',
    });
  }
  return result;
}

/** Commit a whole fitting at once (the dialog's Done / "Wear this fitting"). */
async function setAll(
  { repos }: RequestContext,
  chatId: string,
  pool: WearablePool,
  slots: EquippedSlots,
  wornBundleIds: string[],
): Promise<NextResponse | EquippedSlots> {
  const characterId = pool.characterId;
  // Every id must be something this character can reach, and none may be an
  // archived item being newly put on.
  const allIds = Array.from(new Set(WARDROBE_SLOT_TYPES.flatMap((key) => slots[key])));
  const found = pool.getMany(allIds);
  if (found.length !== allIds.length) {
    const foundIds = new Set(found.map((i) => i.id));
    const missing = allIds.find((id) => !foundIds.has(id));
    return badRequest(`Wardrobe item ${missing} not available to this character`);
  }
  const current = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  const archived = newlyWornArchivedItems(found, current);
  if (archived.length > 0) {
    logger.info('[Chats v1] Refused a fitting that puts on an archived item', {
      chatId, characterId, itemIds: archived.map((i) => i.id), context: 'wardrobe',
    });
    return badRequest(wearRefusal(archived[0])!);
  }
  const wornBundles = resolveWornBundles(pool, wornBundleIds);
  await repos.wardrobeWear.commitEquippedOutfit({
    chatId,
    characterId,
    nextSlots: slots,
    wornBundles,
    source: 'ui',
  });
  logger.info('[Chats v1] Equipped outfit replaced (set_all)', {
    chatId, characterId, wornBundleCount: wornBundles.length, context: 'wardrobe',
  });
  return slots;
}

/**
 * POST ?action=equip — Mutate equipped state for a character in this chat.
 *
 * Body: `{ characterId, mode, slot?, itemId? }` — `wear` (alias `equip`),
 * `replace` and `add_to_slot` put an item on; `remove_from_slot` and
 * `clear_slot` take off; `set_all` commits a whole fitting.
 */
export async function handleEquipSlot(
  req: NextRequest,
  chatId: string,
  ctx: RequestContext
): Promise<NextResponse> {
  const { repos } = ctx;
  try {
    const body = await req.json();
    const { characterId, mode, slot, itemId, slots: bodySlots, wornBundleIds } = equipBodySchema.parse(body);

    let updatedSlots: EquippedSlots;

    if (mode === 'remove_from_slot' || mode === 'clear_slot') {
      updatedSlots = await applyDisplacement(repos, chatId, characterId, {
        mode,
        slot: slot as WardrobeItemType,
        itemId: mode === 'remove_from_slot' ? itemId ?? undefined : undefined,
      });
      logger.info('[Chats v1] Wardrobe slot changed', {
        chatId, characterId, mode, slot, itemId: itemId ?? null, context: 'wardrobe',
      });
    } else {
      const pool = await loadWearablePool(repos, characterId, undefined, { chatId, operator: true });
      if (mode === 'set_all') {
        const outcome = await setAll(ctx, chatId, pool, bodySlots!, wornBundleIds ?? []);
        if (outcome instanceof NextResponse) return outcome;
        updatedSlots = outcome;
      } else {
        const putOn: PutOnMode = mode === 'equip' ? 'wear' : mode;
        const resolved = resolveWearable(pool, { itemId }, putOn, slot);
        if (!resolved.ok) {
          logger.info('[Chats v1] Refused to put on a wardrobe item', {
            chatId, characterId, mode, itemId, reason: resolved.reason, context: 'wardrobe',
          });
          return resolved.reason === 'not_found' ? notFound('Wardrobe item') : badRequest(resolved.message);
        }
        const outcome = await wearItem(repos, chatId, pool, resolved.item, putOn, slot, 'ui');
        updatedSlots = outcome.slots;
        logger.info('[Chats v1] Wardrobe item put on', {
          chatId, characterId, mode: putOn, itemId: resolved.item.id,
          slotsAffected: outcome.slotsAffected, effect: outcome.effect, context: 'wardrobe',
        });
      }
    }

    await notifyWardrobeChanged(
      repos,
      { userId: ctx.user.id, chatId, characterId },
      '[Chats v1] outfit-equip',
    );

    return NextResponse.json({ equippedSlots: updatedSlots });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues.map((e: { message: string }) => e.message).join(', '));
    }
    logger.error('[Chats v1] Error equipping wardrobe slot', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to equip wardrobe slot');
  }
}
