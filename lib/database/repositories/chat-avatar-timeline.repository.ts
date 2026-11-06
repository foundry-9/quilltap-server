/**
 * Database Abstraction Layer - Chat Avatar Timeline Repository
 *
 * Backs `chat_avatar_timeline`: per (chat × character) the dated avatars the
 * chat has bound, so the Salon can draw each bubble with the avatar in force
 * when it was written.
 *
 * ## The chokepoint
 *
 * {@link ChatAvatarTimelineRepository.record} is the one runtime writer. It is
 * reached from every path that binds a per-chat avatar: the avatar job's
 * `bindAvatarToChat` (generation and configuration-cache hit) and the chat
 * route's `set-avatar` / `remove-avatar` actions. From the job child it is
 * buffered whole and replayed in the parent (`METHOD_OVERRIDES` in
 * `lib/repositories/method-classification.ts`), so its "is this the first
 * row?" check reads the real table.
 *
 * The first `record` for a pair also writes a **baseline** row, dated before
 * any message, holding what the chat showed for that character until now. That
 * keeps the earlier bubbles of a chat that predates the timeline exactly as
 * they were, instead of letting them fall through to "current avatar" and
 * repaint with the new look. It freezes; it does not reconstruct.
 *
 * `upsertRows` is for restore and import only. Nothing prunes or rewrites a
 * row: one whose image was later deleted stays, and the resolver
 * (`lib/chat/salon-avatar.ts`) falls back.
 *
 * Design of record: docs/developer/features/salon-avatar-timeline.md
 */

import { randomUUID } from 'node:crypto';
import { rawQuery } from '../manager';
import { getRawDatabase } from '../backends/sqlite/client';
import { logger } from '@/lib/logger';
import { publishRealtime } from '@/lib/realtime/bus';
import {
  CHAT_AVATAR_TIMELINE_INSERT_SQL,
  CHAT_AVATAR_TIMELINE_TABLE,
} from '../backends/sqlite/chat-avatar-timeline-ddl';
import {
  AVATAR_TIMELINE_BASELINE_AT,
  AvatarTimelineSourceSchema,
  type AvatarTimelineSource,
  type ChatAvatarTimelineRow,
} from '@/lib/schemas/chat-avatar-timeline.types';

const log = logger.child({ module: 'avatar-timeline' });

interface RawRow {
  id: string;
  chatId: string;
  characterId: string;
  imageId: string | null;
  effectiveAt: string;
  source: string;
  createdAt: string;
}

function normalizeRow(row: RawRow): ChatAvatarTimelineRow {
  const source = AvatarTimelineSourceSchema.safeParse(row.source);
  return {
    id: row.id,
    chatId: row.chatId,
    characterId: row.characterId,
    imageId: row.imageId ?? null,
    effectiveAt: row.effectiveAt,
    source: source.success ? source.data : 'baseline',
    createdAt: row.createdAt,
  };
}

function insertParams(row: ChatAvatarTimelineRow): unknown[] {
  return [row.id, row.chatId, row.characterId, row.imageId ?? null, row.effectiveAt, row.source, row.createdAt];
}

/** What one `record` call asks for. */
export interface AvatarTimelineRecordInput {
  chatId: string;
  characterId: string;
  /** The avatar bound from now on; null = the character's own avatar. */
  imageId: string | null;
  source: Exclude<AvatarTimelineSource, 'baseline'>;
  /**
   * What the chat showed for this character before this call (its per-chat
   * override, if any). Used only to write the baseline the first time a pair
   * is recorded.
   */
  priorImageId: string | null;
}

/** What a `record` call did, for logs and tests. */
export type AvatarTimelineRecordOutcome =
  | { kind: 'appended'; baseline: boolean }
  | { kind: 'unchanged' }
  | { kind: 'skipped'; reason: string };

export class ChatAvatarTimelineRepository {
  /** The job applier's write partition: these rows live in the main database. */
  readonly dbTarget = 'main' as const;

  // ============================================================================
  // The chokepoint
  // ============================================================================

  /**
   * Record that a chat now shows `imageId` for a character. The one runtime
   * writer; see the module doc. Never throws: a failure is logged at `warn`
   * and the avatar binding it follows stands. From the job child the call is
   * buffered and its return value synthetic — callers discard it.
   */
  async record(input: AvatarTimelineRecordInput): Promise<AvatarTimelineRecordOutcome> {
    const { chatId, characterId, imageId, source, priorImageId } = input;
    try {
      const at = new Date().toISOString();
      const outcome = this.runAtomically((db): AvatarTimelineRecordOutcome => {
        const latest = db
          .prepare(
            `SELECT * FROM "${CHAT_AVATAR_TIMELINE_TABLE}" WHERE "chatId" = ? AND "characterId" = ?
              ORDER BY "effectiveAt" DESC, "createdAt" DESC LIMIT 1`,
          )
          .get(chatId, characterId) as RawRow | undefined;
        const insert = db.prepare(CHAT_AVATAR_TIMELINE_INSERT_SQL);

        let baseline = false;
        let previousImageId: string | null;
        if (!latest) {
          insert.run(...insertParams({
            id: randomUUID(),
            chatId,
            characterId,
            imageId: priorImageId ?? null,
            effectiveAt: AVATAR_TIMELINE_BASELINE_AT,
            source: 'baseline',
            createdAt: at,
          }));
          baseline = true;
          previousImageId = priorImageId ?? null;
        } else {
          previousImageId = latest.imageId ?? null;
        }

        if (previousImageId === (imageId ?? null)) {
          return baseline ? { kind: 'appended', baseline: true } : { kind: 'unchanged' };
        }

        insert.run(...insertParams({
          id: randomUUID(),
          chatId,
          characterId,
          imageId: imageId ?? null,
          effectiveAt: at,
          source,
          createdAt: at,
        }));
        return { kind: 'appended', baseline };
      });

      if (outcome.kind === 'appended') {
        publishRealtime('chats', chatId);
        log.debug('Recorded avatar timeline entry', { chatId, characterId, imageId, source, baseline: outcome.baseline });
      } else {
        log.debug('Avatar unchanged since the latest entry; nothing recorded', { chatId, characterId, imageId, source });
      }
      return outcome;
    } catch (error) {
      log.warn('Avatar timeline record failed; the avatar binding stands unrecorded', {
        chatId,
        characterId,
        imageId,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'skipped', reason: 'error' };
    }
  }

  /**
   * Run `work` in one synchronous better-sqlite3 transaction on the main
   * connection. Nests as a savepoint inside the job applier's own transaction.
   */
  private runAtomically<R>(work: (db: NonNullable<ReturnType<typeof getRawDatabase>>) => R): R {
    const db = getRawDatabase();
    if (!db) {
      throw new Error('Avatar timeline: the main database is not initialized');
    }
    return db.transaction(() => work(db))();
  }

  // ============================================================================
  // Writes (restore / import / cleanup)
  // ============================================================================

  /** Restore and import: write rows as given, ids preserved. A failing row is logged and skipped. */
  async upsertRows(rows: ChatAvatarTimelineRow[]): Promise<number> {
    let written = 0;
    for (const row of rows) {
      try {
        await rawQuery(
          `${CHAT_AVATAR_TIMELINE_INSERT_SQL}
           ON CONFLICT ("id") DO UPDATE SET
             "imageId" = excluded."imageId",
             "effectiveAt" = excluded."effectiveAt",
             "source" = excluded."source",
             "createdAt" = excluded."createdAt"`,
          insertParams(row),
        );
        written += 1;
      } catch (error) {
        log.warn('Skipped an avatar timeline row that could not be written', {
          id: row.id,
          chatId: row.chatId,
          characterId: row.characterId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    log.debug('Upserted avatar timeline rows', { requested: rows.length, written });
    return written;
  }

  /** Character deleted: their timelines have no reader. */
  async deleteByCharacter(characterId: string): Promise<void> {
    await rawQuery(`DELETE FROM "${CHAT_AVATAR_TIMELINE_TABLE}" WHERE "characterId" = ?`, [characterId]);
    log.debug('Dropped avatar timeline for a deleted character', { characterId });
  }

  // ============================================================================
  // Reads
  // ============================================================================

  /** Every row for a chat (the Salon, export, backup), by character then time. */
  async findByChatId(chatId: string): Promise<ChatAvatarTimelineRow[]> {
    const rows = await rawQuery<RawRow[]>(
      `SELECT * FROM "${CHAT_AVATAR_TIMELINE_TABLE}" WHERE "chatId" = ?
        ORDER BY "characterId", "effectiveAt" ASC, "createdAt" ASC`,
      [chatId],
    );
    return rows.map(normalizeRow);
  }

  /** Every row (backup). */
  async findAll(): Promise<ChatAvatarTimelineRow[]> {
    const rows = await rawQuery<RawRow[]>(
      `SELECT * FROM "${CHAT_AVATAR_TIMELINE_TABLE}" ORDER BY "chatId", "characterId", "effectiveAt" ASC, "createdAt" ASC`,
    );
    return rows.map(normalizeRow);
  }
}
