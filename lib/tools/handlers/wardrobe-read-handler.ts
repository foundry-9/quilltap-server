/**
 * Read Wardrobe Item Tool Handler
 *
 * Resolves ONE wardrobe item across every tier — the character's own wardrobe,
 * their groups, the project, and Quilltap General — and returns its full detail,
 * including the Portrait Cue, default/replace flags, component list, archived
 * status, ownership, and which slots it's currently equipped in.
 *
 * `buildWardrobeReadOutput` is exported and reused by `wardrobe_update` so an
 * edit echoes back the same shape.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  WardrobeReadToolInput,
  WardrobeReadToolOutput,
  WardrobeReadWearResult,
} from '../wardrobe-read-tool';
import { validateWardrobeReadInput } from '../wardrobe-read-tool';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { resolveSharedWardrobeTiersForChat } from '@/lib/wardrobe/shared-tiers';
import type { SharedWardrobeTiers } from '@/lib/wardrobe/shared-tiers';
import {
  findEquippedSlots,
  isOwnWardrobeItem,
  normalizeNoItemSentinel,
  resolveWardrobeItemAcrossTiers,
  wardrobeItemNotFoundMessage,
} from './wardrobe-handler-shared';
import type { WardrobeRepos } from './wardrobe-handler-shared';
import { resolveWearers } from '@/lib/wardrobe/wear-history';
import { formatRelativeDays } from '@/lib/format-time';

export interface WardrobeReadToolContext {
  userId: string;
  chatId: string;
  characterId: string;
}

/**
 * Build the full read-shaped output for a resolved wardrobe item. Shared by
 * `wardrobe_read` and `wardrobe_update`.
 */
export async function buildWardrobeReadOutput(
  repos: WardrobeRepos,
  characterId: string,
  chatId: string,
  item: WardrobeItem,
  tiers: SharedWardrobeTiers,
): Promise<WardrobeReadToolOutput> {
  const isComposite = (item.componentItemIds?.length ?? 0) > 0;

  let componentTitles: string[] = [];
  if (isComposite) {
    const components = await repos.wardrobe.findByIdsForCharacter(characterId, item.componentItemIds, tiers);
    const titleById = new Map(components.map((c) => [c.id, c.title]));
    componentTitles = item.componentItemIds
      .map((cid) => titleById.get(cid))
      .filter((t): t is string => typeof t === 'string');
  }

  const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  const equipped = findEquippedSlots(item.id, equippedSlots);

  const wear = await buildWardrobeReadWear(repos, characterId, item.id);

  return {
    success: true,
    item_id: item.id,
    title: item.title,
    description: item.description ?? null,
    image_prompt: item.imagePrompt ?? null,
    types: item.types,
    appropriateness: item.appropriateness ?? null,
    is_default: item.isDefault ?? false,
    replace: item.replace ?? false,
    is_composite: isComposite,
    component_item_ids: item.componentItemIds ?? [],
    component_titles: componentTitles,
    archived: item.archivedAt != null,
    is_own: isOwnWardrobeItem(item, characterId),
    is_equipped: equipped.length > 0,
    equipped_slots: equipped,
    wear,
  };
}

/**
 * The item's wear history, each wearer named for the calling character:
 * themselves flagged `is_you`, anyone the ledger can no longer name flagged
 * `departed`. Names resolve raw (`resolveWearers`), so a broken vault costs a
 * label rather than the whole read.
 */
async function buildWardrobeReadWear(
  repos: WardrobeRepos,
  characterId: string,
  itemId: string,
): Promise<WardrobeReadWearResult> {
  const history = await repos.wardrobeWear.findHistory(itemId);
  const resolved = await resolveWearers(history.wearers, repos);

  logger.debug('Wardrobe read resolved wear history', {
    context: 'wardrobe-read-handler',
    characterId,
    itemId,
    wearCount: history.wearCount,
    wearerCount: history.wearers.length,
  });

  return {
    wear_count: history.wearCount,
    first_worn_at: history.firstWornAt,
    last_worn_at: history.lastWornAt,
    wearers: history.wearers.map((wearer, i) => ({
      character_id: wearer.characterId,
      name: resolved[i]?.name ?? '',
      is_you: wearer.characterId !== null && wearer.characterId === characterId,
      departed: resolved[i]?.kind !== 'character',
      wear_count: wearer.wearCount,
      first_worn_at: wearer.firstWornAt,
      last_worn_at: wearer.lastWornAt,
    })),
  };
}

/** How a wearer is named to the character reading the tool output. */
function wearerPhrase(wearer: WardrobeReadWearResult['wearers'][number]): string {
  if (wearer.is_you) return 'you';
  if (wearer.departed) return 'someone no longer in the household';
  return wearer.name;
}

/** "once", "twice", "4 times". */
function timesPhrase(count: number): string {
  if (count === 1) return 'once';
  if (count === 2) return 'twice';
  return `${count} times`;
}

/** An absolute date as "14 Mar 2026" (UTC, so a reader's locale cannot reshape it). */
function wearDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function relativeWearDate(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : formatRelativeDays(ms, nowMs);
}

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The `Wear` paragraph of `wardrobe_read`: "Worn 4 times, first 14 Mar 2026,
 * last 3 days ago by you. Also worn by Marguerite (once)." — or "Never worn."
 * `nowMs` pins the clock for the relative dates (tests); it defaults to now.
 */
export function formatWardrobeWearParagraph(
  wear: WardrobeReadWearResult | undefined,
  nowMs: number = Date.now(),
): string {
  if (!wear || wear.wear_count === 0 || wear.wearers.length === 0 || !wear.last_worn_at) {
    return 'Never worn.';
  }

  const [latest, ...others] = wear.wearers;
  const last = `${relativeWearDate(wear.last_worn_at, nowMs)} by ${wearerPhrase(latest)}`;
  const head =
    wear.wear_count === 1
      ? `Worn once, ${last}.`
      : `Worn ${wear.wear_count} times, first ${wearDate(wear.first_worn_at ?? wear.last_worn_at)}, last ${last}.`;

  if (others.length === 0) return head;
  const also = joinPhrases(others.map((w) => `${wearerPhrase(w)} (${timesPhrase(w.wear_count)})`));
  return `${head} Also worn by ${also}.`;
}

export function buildWardrobeReadFailure(error: string): WardrobeReadToolOutput {
  return {
    success: false,
    item_id: '',
    title: '',
    description: null,
    image_prompt: null,
    types: [],
    appropriateness: null,
    is_default: false,
    replace: false,
    is_composite: false,
    component_item_ids: [],
    component_titles: [],
    archived: false,
    is_own: false,
    is_equipped: false,
    equipped_slots: [],
    error,
  };
}

export async function executeWardrobeReadTool(
  input: unknown,
  context: WardrobeReadToolContext,
): Promise<WardrobeReadToolOutput> {
  const repos = getRepositories();

  const parsed = validateWardrobeReadInput(input);

  if (!parsed) {
    logger.warn('Wardrobe read tool validation failed', {
      context: 'wardrobe-read-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildWardrobeReadFailure('Invalid input: item_id or item_title is required.');
  }

  try {
    const { item_id, item_title } = parsed;
    const tiers = await resolveSharedWardrobeTiersForChat(context.chatId, context.characterId);

    const item = await resolveWardrobeItemAcrossTiers(
      repos,
      context.characterId,
      normalizeNoItemSentinel(item_id),
      normalizeNoItemSentinel(item_title),
      tiers,
    );
    if (!item) {
      return buildWardrobeReadFailure(wardrobeItemNotFoundMessage(item_id, item_title));
    }

    return await buildWardrobeReadOutput(repos, context.characterId, context.chatId, item, tiers);
  } catch (error) {
    logger.error('Wardrobe read tool execution failed', {
      context: 'wardrobe-read-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);
    return buildWardrobeReadFailure(
      error instanceof Error ? error.message : 'Unknown error during wardrobe read',
    );
  }
}

/**
 * Format wardrobe read results for inclusion in conversation context
 *
 * @param nowMs - Clock for the relative dates in the wear paragraph; defaults to now
 */
export function formatWardrobeReadResults(
  output: WardrobeReadToolOutput,
  nowMs: number = Date.now(),
): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  const lines: string[] = [`${output.title} (${output.item_id})`];
  lines.push(`  types: ${output.types.join(', ')}`);
  if (output.appropriateness) lines.push(`  appropriateness: ${output.appropriateness}`);
  if (output.description) lines.push(`  description: ${output.description}`);
  lines.push(`  portrait cue: ${output.image_prompt ?? '(none — falls back to title)'}`);
  if (output.is_composite) {
    lines.push(`  composite: ${output.component_titles.join(', ') || 'unresolved components'} (replace=${output.replace})`);
  }
  lines.push(`  default: ${output.is_default ? 'yes' : 'no'} | own: ${output.is_own ? 'yes' : 'no (shared — read-only)'}`);
  if (output.archived) lines.push('  archived: yes (hidden from listings, cannot be worn)');
  lines.push(`  equipped: ${output.is_equipped ? output.equipped_slots.join(', ') : 'no'}`);
  if (output.wear) lines.push(`  wear: ${formatWardrobeWearParagraph(output.wear, nowMs)}`);

  return lines.join('\n');
}
