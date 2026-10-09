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
import { isComposite as itemIsComposite } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { WearablePool } from '@/lib/wardrobe/pool';
import { findInPool } from '@/lib/wardrobe/wear-ops';
import {
  findEquippedSlots,
  loadToolPool,
  normalizeNoItemSentinel,
  wardrobeItemNotFoundMessage,
  type WardrobeToolContext,
} from './wardrobe-handler-shared';
import type { WardrobeRepos } from './wardrobe-handler-shared';
import { resolveWearers } from '@/lib/wardrobe/wear-history';
import { formatWornRelative } from '@/lib/wardrobe/wear-display';
import { formatWardrobeImageHandle } from '@/lib/wardrobe/tool-image-generation';

/** Every wardrobe tool runs in the same context (see `WardrobeToolContext`). */
export type WardrobeReadToolContext = WardrobeToolContext;

/**
 * Build the full read-shaped output for a resolved wardrobe item. Shared by
 * `wardrobe_read` and `wardrobe_update`.
 */
export async function buildWardrobeReadOutput(
  repos: WardrobeRepos,
  pool: WearablePool,
  chatId: string,
  item: WardrobeItem,
): Promise<WardrobeReadToolOutput> {
  const characterId = pool.characterId;
  const isComposite = itemIsComposite(item);
  const componentTitles = isComposite ? pool.getMany(item.componentItemIds).map((c) => c.title) : [];

  const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  const equipped = findEquippedSlots(item.id, equippedSlots);

  const wear = await buildWardrobeReadWear(repos, characterId, item.id);

  return {
    success: true,
    item_id: item.id,
    title: item.title,
    description: item.description ?? null,
    image_prompt: item.imagePrompt ?? null,
    image_file_id: item.imageFileId ?? null,
    types: item.types,
    appropriateness: item.appropriateness ?? null,
    is_default: item.isDefault ?? false,
    replace: item.replace ?? false,
    is_composite: isComposite,
    component_item_ids: item.componentItemIds ?? [],
    component_titles: componentTitles,
    archived: item.archivedAt != null,
    is_own: pool.owns(item),
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
  return Number.isNaN(ms) ? iso : formatWornRelative(ms, nowMs);
}

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The `Wear` paragraph of `wardrobe_read`, from the reader's side first and
 * the household's second (bug 184 — a shared item's total must never read as
 * the reader's own):
 *
 *  - "Never worn."
 *  - "You have worn it 4 times, first 14 Mar 2026, last 3 days ago."
 *  - "You have worn it 13 times, first 25 Jun 2026, last today. Worn 116
 *    times in all; also by Laura (25 times) and Sunny (once)."
 *  - "You have worn it twice, first 14 Mar 2026, last 6 months ago. Worn 3
 *    times in all, most recently 2 weeks ago by Marguerite; also by
 *    Marguerite (once)."
 *  - "You have never worn it. Worn 115 times by others, first 13 Jun 2026,
 *    last yesterday by Laura: Laura (25 times) and Charlie (14 times)."
 *
 * `nowMs` pins the clock for the relative dates (tests); it defaults to now.
 */
export function formatWardrobeWearParagraph(
  wear: WardrobeReadWearResult | undefined,
  nowMs: number = Date.now(),
): string {
  if (!wear || wear.wear_count === 0 || wear.wearers.length === 0 || !wear.last_worn_at) {
    return 'Never worn.';
  }

  const you = wear.wearers.find((w) => w.is_you);
  const others = wear.wearers.filter((w) => !w.is_you);
  const latest = wear.wearers[0];
  const othersList = joinPhrases(others.map((w) => `${wearerPhrase(w)} (${timesPhrase(w.wear_count)})`));

  if (you) {
    const mine =
      you.wear_count === 1
        ? `You have worn it once, ${relativeWearDate(you.last_worn_at, nowMs)}.`
        : `You have worn it ${timesPhrase(you.wear_count)}, first ${wearDate(you.first_worn_at)}, last ${relativeWearDate(you.last_worn_at, nowMs)}.`;
    if (others.length === 0) return mine;
    const mostRecent = latest.is_you
      ? ''
      : `, most recently ${relativeWearDate(latest.last_worn_at, nowMs)} by ${wearerPhrase(latest)}`;
    return `${mine} Worn ${timesPhrase(wear.wear_count)} in all${mostRecent}; also by ${othersList}.`;
  }

  const last = `${relativeWearDate(wear.last_worn_at, nowMs)} by ${wearerPhrase(latest)}`;
  if (wear.wear_count === 1) return `You have never worn it. Worn once, ${last}.`;
  const head = `You have never worn it. Worn ${timesPhrase(wear.wear_count)} by others, first ${wearDate(wear.first_worn_at ?? wear.last_worn_at)}, last ${last}`;
  return others.length > 1 ? `${head}: ${othersList}.` : `${head}.`;
}

export function buildWardrobeReadFailure(error: string): WardrobeReadToolOutput {
  return {
    success: false,
    item_id: '',
    title: '',
    description: null,
    image_prompt: null,
    image_file_id: null,
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
    const pool = await loadToolPool(repos, context.chatId, context.characterId);

    const item = findInPool(pool, {
      itemId: normalizeNoItemSentinel(item_id),
      itemTitle: normalizeNoItemSentinel(item_title),
    });
    if (!item) {
      return buildWardrobeReadFailure(wardrobeItemNotFoundMessage(item_id, item_title));
    }

    return await buildWardrobeReadOutput(repos, pool, context.chatId, item);
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
  lines.push(`  picture: ${output.image_file_id ? formatWardrobeImageHandle(output.image_file_id) : '(none)'}`);
  if (output.is_composite) {
    lines.push(`  composite: ${output.component_titles.join(', ') || 'unresolved components'} (replace=${output.replace})`);
  }
  lines.push(`  default: ${output.is_default ? 'yes' : 'no'} | own: ${output.is_own ? 'yes' : 'no (shared — read-only)'}`);
  if (output.archived) lines.push('  archived: yes (hidden from listings, cannot be worn)');
  lines.push(`  equipped: ${output.is_equipped ? output.equipped_slots.join(', ') : 'no'}`);
  if (output.wear) lines.push(`  wear: ${formatWardrobeWearParagraph(output.wear, nowMs)}`);

  return lines.join('\n');
}
