/**
 * Reading the wardrobe wear ledger for people and characters.
 *
 * The ledger itself (`repos.wardrobeWear`) answers in ids and timestamps. This
 * module is the one place those become something a reader can use:
 *
 *   - {@link attachWear} — the `wear` response annotation every wardrobe
 *     collection GET carries, from **one** `findSummaries` call. Like `origin`
 *     (`withOrigin`, `lib/wardrobe/wardrobe-container.ts`) it is a read-time
 *     annotation, never a field of `WardrobeItemSchema` and never accepted on
 *     write.
 *   - {@link resolveWearers} — wearer ids to names (and avatars, for the
 *     editor). Reads are raw (`characters.findByIdRaw`), as in
 *     `lib/chat/speaker-names.ts`: a broken vault costs a label, not a 500.
 *     Shared by the `?action=wear-history` item routes and `wardrobe_read`.
 *   - {@link buildWearHistoryPayload} — the body of `?action=wear-history`.
 *
 * Server-only (repositories, logger).
 *
 * Design of record: docs/developer/features/wardrobe-wear-ledger.md §5
 *
 * @module lib/wardrobe/wear-history
 */

import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { enrichWithDefaultImage } from '@/lib/api/middleware/enrichment';
import type {
  WardrobeWearHistory,
  WardrobeWearSummary,
  WardrobeWearer,
} from '@/lib/schemas/wardrobe-wear.types';
import { neverWornSummary } from '@/lib/schemas/wardrobe-wear.types';


/** The label for a wearer whose character can no longer be read. */
export const DEPARTED_WEARER_LABEL = 'a departed character';

/** The label for the ledger's unattributed row (wearer deleted and folded, or unresolvable on import). */
export const UNATTRIBUTED_WEARER_LABEL = 'unattributed';

/** A collection-read item carrying its wear summary. */
export type WithWear<T> = T & { wear: WardrobeWearSummary };

/**
 * Tag every item in a collection read with its wear summary, from a single
 * `findSummaries` call. Order and every other field are preserved; an item the
 * ledger has never seen carries the canonical zero summary.
 */
export async function attachWear<T extends { id: string }>(
  items: readonly T[],
  repos: Pick<RepositoryContainer, 'wardrobeWear'>,
): Promise<WithWear<T>[]> {
  if (items.length === 0) return [];
  const summaries = await repos.wardrobeWear.findSummaries(items.map((item) => item.id));
  logger.debug('Attached wear summaries to wardrobe read', {
    itemCount: items.length,
    wornCount: Array.from(summaries.values()).filter((s) => s.wearCount > 0).length,
    context: 'wardrobe',
  });
  return items.map((item) => ({
    ...item,
    wear: summaries.get(item.id) ?? neverWornSummary(),
  }));
}

/** How a wearer resolved. */
export type WearerKind = 'character' | 'departed' | 'unattributed';

/** One wearer, resolved for display. Index-aligned with the history's `wearers`. */
export interface ResolvedWearer {
  /** null for the unattributed row. */
  characterId: string | null;
  name: string;
  avatarUrl: string | null;
  kind: WearerKind;
}

/**
 * Resolve each wearer to a display name (and, when asked, an avatar URL).
 * Never throws: a missing character is {@link DEPARTED_WEARER_LABEL}, a read
 * that fails is labelled the same way (and logged), and the null wearer is
 * {@link UNATTRIBUTED_WEARER_LABEL}.
 */
export async function resolveWearers(
  wearers: ReadonlyArray<Pick<WardrobeWearer, 'characterId'>>,
  repos: RepositoryContainer,
  opts: { avatars?: boolean } = {},
): Promise<ResolvedWearer[]> {
  const resolved: ResolvedWearer[] = [];
  for (const wearer of wearers) {
    const characterId = wearer.characterId;
    if (!characterId) {
      resolved.push({ characterId: null, name: UNATTRIBUTED_WEARER_LABEL, avatarUrl: null, kind: 'unattributed' });
      continue;
    }

    let character;
    try {
      character = await repos.characters.findByIdRaw(characterId);
    } catch (error) {
      logger.warn('Could not read wearer; labelling as departed', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
        context: 'wardrobe',
      });
      character = null;
    }

    if (!character?.name) {
      resolved.push({ characterId, name: DEPARTED_WEARER_LABEL, avatarUrl: null, kind: 'departed' });
      continue;
    }

    let avatarUrl: string | null = null;
    if (opts.avatars) {
      try {
        avatarUrl = (await enrichWithDefaultImage(character.defaultImageId, repos))?.filepath ?? null;
      } catch (error) {
        logger.warn('Could not resolve wearer avatar', {
          characterId,
          error: error instanceof Error ? error.message : String(error),
          context: 'wardrobe',
        });
      }
    }

    resolved.push({ characterId, name: character.name, avatarUrl, kind: 'character' });
  }
  return resolved;
}

/** The body of an item route's `?action=wear-history`. */
export interface WardrobeWearHistoryPayload {
  history: WardrobeWearHistory;
  /** Index-aligned with `history.wearers`. */
  wearers: Array<{ characterId: string | null; name: string; avatarUrl: string | null }>;
  /** null when never worn or when the chat has since been deleted. */
  lastWornChat: { id: string; title: string } | null;
}

/**
 * Build the `?action=wear-history` body for one item: the ledger's history,
 * each wearer named, and the chat it was last worn in when that chat still
 * exists. The caller has already established the item exists in its tier.
 */
export async function buildWearHistoryPayload(
  itemId: string,
  repos: RepositoryContainer,
): Promise<WardrobeWearHistoryPayload> {
  const history = await repos.wardrobeWear.findHistory(itemId);
  const wearers = (await resolveWearers(history.wearers, repos, { avatars: true })).map(
    ({ characterId, name, avatarUrl }) => ({ characterId, name, avatarUrl }),
  );

  let lastWornChat: WardrobeWearHistoryPayload['lastWornChat'] = null;
  if (history.lastWornChatId) {
    try {
      const chat = await repos.chats.findById(history.lastWornChatId);
      if (chat) lastWornChat = { id: chat.id, title: chat.title };
    } catch (error) {
      logger.warn('Could not read last-worn chat', {
        itemId,
        chatId: history.lastWornChatId,
        error: error instanceof Error ? error.message : String(error),
        context: 'wardrobe',
      });
    }
  }

  logger.debug('Built wear history', {
    itemId,
    wearCount: history.wearCount,
    wearerCount: wearers.length,
    lastWornChatResolved: lastWornChat !== null,
    context: 'wardrobe',
  });

  return { history, wearers, lastWornChat };
}
