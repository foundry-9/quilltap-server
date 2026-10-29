/**
 * Self-Inventory — the `holdings` section (GATHER half).
 *
 * Counts what is within the character's reach, read through the same doors the
 * tools themselves use, so a count never disagrees with what the character can
 * actually touch:
 *  - wardrobe: `loadWearablePool` (roster-gated project tier, archived dropped),
 *  - Inventory: `loadInventoryContext` (the character's own reach, roster-gated),
 *  - custom tools: `resolveCustomToolRoster` (shadowing, gates and `disabled`).
 * Each part fails soft on its own.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { loadWearablePool } from '@/lib/wardrobe/pool';
import { isComposite } from '@/lib/schemas/wardrobe.types';
import { loadInventoryContext } from '@/lib/inventory/context';
import { resolveCustomToolRoster } from '@/lib/pascal/custom-tools';
import type { MountTier } from '@/lib/mount-index/tiered-mount-pool';
import type { Character } from '@/lib/schemas/types';
import type {
  SelfInventoryHoldingsCustomTools,
  SelfInventoryHoldingsIncludedParts,
  SelfInventoryHoldingsInventory,
  SelfInventoryHoldingsSection,
  SelfInventoryHoldingsWardrobe,
  SelfInventorySection,
  SelfInventoryTierCounts,
} from '../../self-inventory-tool';
import { getErrorMessage, type SelfInventoryToolContext } from './helpers';

type TierScope = keyof SelfInventoryTierCounts;

function emptyTierCounts(): SelfInventoryTierCounts {
  return { character: 0, group: 0, project: 0, general: 0 };
}

/** Tally items by their origin scope; an item with no origin is the character's own. */
function countByTier(scopes: Iterable<TierScope | undefined>): SelfInventoryTierCounts {
  const counts = emptyTierCounts();
  for (const scope of scopes) counts[scope ?? 'character'] += 1;
  return counts;
}

/** A custom tool's mount tier, in the wardrobe/Inventory vocabulary. */
function tierScopeOf(tier: MountTier): TierScope {
  switch (tier) {
    case 'global':
      return 'general';
    case 'participant':
      return 'character';
    default:
      return tier;
  }
}

async function buildHoldingsWardrobe(
  characterId: string,
  context: SelfInventoryToolContext
): Promise<SelfInventoryHoldingsWardrobe> {
  const pool = await loadWearablePool(getRepositories(), characterId, undefined, { chatId: context.chatId });
  const wearable = pool.wearable();
  const outfits = wearable.filter((item) => isComposite(item)).length;
  return {
    available: true,
    garments: wearable.length - outfits,
    outfits,
    byTier: countByTier(wearable.map((item) => item.origin.scope)),
  };
}

async function buildHoldingsInventory(
  characterId: string,
  context: SelfInventoryToolContext
): Promise<SelfInventoryHoldingsInventory> {
  const inventory = await loadInventoryContext(getRepositories(), characterId, context.chatId);
  // `pool.items` also carries the character's own archived objects (so a
  // reference to one can be answered); a count of what is in reach skips them.
  const live = inventory.pool.items.filter((item) => !item.archivedAt);
  let objects = 0;
  let kits = 0;
  let archetypes = 0;
  for (const item of live) {
    if (item.isArchetype) archetypes += 1;
    else if (item.kind === 'kit') kits += 1;
    else objects += 1;
  }
  return {
    available: true,
    objects,
    kits,
    archetypes,
    carriedHere: inventory.equippedIds.size,
    byTier: countByTier(live.map((item) => item.origin?.scope)),
  };
}

async function buildHoldingsCustomTools(
  character: Character,
  context: SelfInventoryToolContext
): Promise<SelfInventoryHoldingsCustomTools> {
  const repos = getRepositories();
  const settings = await repos.chatSettings.findByUserId(context.userId);
  if (settings?.customTools === false) {
    return { available: false, message: 'Custom tools are switched off for this instance.' };
  }

  const projectId =
    context.projectId ?? (await repos.chats.findById(context.chatId))?.projectId ?? null;
  const roster = await resolveCustomToolRoster({
    userId: context.userId,
    chatId: context.chatId,
    characterId: character.id,
    characterMountPointId: character.characterDocumentMountPointId ?? null,
    projectId,
    metadata: character.metadata ?? null,
  });
  const tools = [...roster.tools.values()];
  return {
    available: true,
    count: tools.length,
    names: tools.map((entry) => entry.definition.name).sort((a, b) => a.localeCompare(b)),
    byTier: countByTier(tools.map((entry) => tierScopeOf(entry.tier))),
  };
}

export function resolveHoldingsIncludedParts(
  requested: Set<SelfInventorySection>
): SelfInventoryHoldingsIncludedParts | null {
  const wantsAll = requested.has('holdings');
  const wardrobe = wantsAll || requested.has('holdings.wardrobe');
  const inventory = wantsAll || requested.has('holdings.inventory');
  const customTools = wantsAll || requested.has('holdings.customTools');
  if (!wardrobe && !inventory && !customTools) return null;
  return { wardrobe, inventory, customTools };
}

export async function buildHoldingsSection(
  character: Character,
  context: SelfInventoryToolContext,
  parts: SelfInventoryHoldingsIncludedParts
): Promise<SelfInventoryHoldingsSection> {
  const unavailable = (err: unknown) => ({ available: false as const, message: getErrorMessage(err) });
  const [wardrobe, inventory, customTools] = await Promise.all([
    parts.wardrobe ? buildHoldingsWardrobe(character.id, context).catch(unavailable) : undefined,
    parts.inventory ? buildHoldingsInventory(character.id, context).catch(unavailable) : undefined,
    parts.customTools ? buildHoldingsCustomTools(character, context).catch(unavailable) : undefined,
  ]);

  logger.debug('self_inventory: holdings resolved', {
    context: 'self-inventory-handler',
    characterId: character.id,
    wardrobe: wardrobe?.available ?? null,
    inventory: inventory?.available ?? null,
    customTools: customTools?.available ?? null,
  });

  return {
    includedParts: parts,
    ...(wardrobe && { wardrobe }),
    ...(inventory && { inventory }),
    ...(customTools && { customTools }),
  };
}
