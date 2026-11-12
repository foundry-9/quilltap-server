/**
 * Avatar-timeline import: bring a bundle's `avatar_timeline` rows across,
 * keyed to the chats and characters as they landed on this instance.
 *
 * Runs after characters, chats and document stores, so every id map it reads
 * is final. Each row gets a fresh `id`; `chatId` and `characterId` are
 * remapped; `effectiveAt`, `source` and `createdAt` are copied as they are, so
 * the dated sequence survives the trip. `imageId` follows the imported vault
 * link (`idMaps.docMountFileLinks`), exactly as a chat's `characterAvatars`
 * entries do in reconcile; an id with no entry (a legacy `files.id`, or a link
 * the bundle did not carry) is kept, and the Salon's resolver falls back when
 * it names nothing. A null `imageId` stays null.
 *
 * A row whose chat was not imported (skipped as a duplicate) is dropped, and a
 * (chat, character) pair that already has rows on this instance is left
 * alone: a timeline is never merged into a live one.
 *
 * The judgement is {@link remapAvatarTimelineRows} (pure, unit-tested).
 *
 * Design of record: docs/developer/features/complete/salon-avatar-timeline.md
 *
 * @module import/quilltap-import/import-avatar-timeline
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  ChatAvatarTimelineRowSchema,
  type ChatAvatarTimelineRow,
} from '@/lib/schemas/chat-avatar-timeline.types';
import type { IdMappingState } from './types';

const moduleLogger = logger.child({ module: 'import:avatar-timeline' });

export interface AvatarTimelineRemapContext {
  chatIds: ReadonlyMap<string, string>;
  characterIds: ReadonlyMap<string, string>;
  /** Source vault link id -> imported link id. */
  imageIds: ReadonlyMap<string, string>;
  mintId: () => string;
}

export interface AvatarTimelineRemapResult {
  rows: ChatAvatarTimelineRow[];
  droppedInvalid: number;
  droppedUnknownChat: number;
}

/** Remap a bundle's timeline rows onto this instance's ids. Pure. */
export function remapAvatarTimelineRows(
  incoming: readonly unknown[],
  ctx: AvatarTimelineRemapContext,
): AvatarTimelineRemapResult {
  const rows: ChatAvatarTimelineRow[] = [];
  let droppedInvalid = 0;
  let droppedUnknownChat = 0;
  for (const raw of incoming) {
    const parsed = ChatAvatarTimelineRowSchema.safeParse(raw);
    if (!parsed.success) {
      droppedInvalid += 1;
      continue;
    }
    const row = parsed.data;
    const chatId = ctx.chatIds.get(row.chatId);
    if (!chatId) {
      droppedUnknownChat += 1;
      continue;
    }
    rows.push({
      ...row,
      id: ctx.mintId(),
      chatId,
      characterId: ctx.characterIds.get(row.characterId) ?? row.characterId,
      imageId: row.imageId ? ctx.imageIds.get(row.imageId) ?? row.imageId : null,
    });
  }
  return { rows, droppedInvalid, droppedUnknownChat };
}

/** Import the bundle's timeline rows. Returns the number written. */
export async function importAvatarTimeline(
  incoming: readonly unknown[],
  idMaps: IdMappingState,
  warnings: string[],
): Promise<number> {
  if (incoming.length === 0) return 0;
  const repos = getRepositories();

  const { rows, droppedInvalid, droppedUnknownChat } = remapAvatarTimelineRows(incoming, {
    chatIds: idMaps.chats,
    characterIds: idMaps.characters,
    imageIds: idMaps.docMountFileLinks,
    mintId: () => randomUUID(),
  });
  if (droppedInvalid > 0) {
    warnings.push(`Dropped ${droppedInvalid} malformed avatar-timeline row(s).`);
  }

  // Never merge into a live timeline.
  const existingByChat = new Map<string, ChatAvatarTimelineRow[]>();
  const toWrite: ChatAvatarTimelineRow[] = [];
  const skippedPairs = new Set<string>();
  const acceptedPairs = new Set<string>();
  for (const row of rows) {
    const key = `${row.chatId}\u0000${row.characterId}`;
    if (skippedPairs.has(key)) continue;
    if (!acceptedPairs.has(key)) {
      let existing = existingByChat.get(row.chatId);
      if (!existing) {
        existing = await repos.avatarTimeline.findByChatId(row.chatId);
        existingByChat.set(row.chatId, existing);
      }
      if (existing.some((e) => e.characterId === row.characterId)) {
        skippedPairs.add(key);
        continue;
      }
      acceptedPairs.add(key);
    }
    toWrite.push(row);
  }

  const written = await repos.avatarTimeline.upsertRows(toWrite);
  moduleLogger.info('Imported avatar timeline', {
    incoming: incoming.length,
    written,
    droppedInvalid,
    droppedUnknownChat,
    skippedTimelines: skippedPairs.size,
  });
  return written;
}
