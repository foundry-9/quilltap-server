/**
 * Database Abstraction Layer - Chat Wardrobe History Repository
 *
 * Backs `chat_wardrobe_history`: per (chat × character) a numbered timeline of
 * the outfits worn there, `0` being what they arrived in, and a cursor
 * (`isCurrent`) on the entry they are wearing now.
 *
 * ## The chokepoint
 *
 * {@link ChatWardrobeHistoryRepository.settle} is the one runtime writer. It
 * is reached from `lib/wardrobe/outfit-change-effects.ts` at the moment Aurora's
 * announcement is scheduled (one entry per announcement, never per slot
 * gesture), and from `applyOutfitSelections` for entry `0`. It always reads the
 * chat's *live* slots itself — never a snapshot the caller passes — and, from
 * the job child, is buffered whole and replayed in the parent after the turn's
 * `commitEquippedOutfit` (`METHOD_OVERRIDES` in
 * `lib/background-jobs/child/child-repositories-proxy.ts`), so the entry
 * records what the chat really holds.
 *
 * `upsertRows` is for restore and import only. Nothing renumbers or prunes.
 *
 * Method names follow the child proxy's prefixes: reads start with `find`,
 * writes with `upsert` / `delete`; `settle` carries an explicit override.
 *
 * Design of record: docs/developer/features/complete/wardrobe-outfit-history.md
 */

import { randomUUID } from 'node:crypto';
import { rawQuery } from '../manager';
import { getRawDatabase } from '../backends/sqlite/client';
import { logger } from '@/lib/logger';
import { publishRealtime } from '@/lib/realtime/bus';
import { hashEquippedSlots } from '@/lib/wardrobe/outfit-hash';
import {
  CHAT_WARDROBE_HISTORY_INSERT_SQL,
  CHAT_WARDROBE_HISTORY_TABLE,
} from '../backends/sqlite/chat-wardrobe-history-ddl';
import {
  WardrobeHistorySourceSchema,
  type ChatWardrobeHistoryRow,
  type WardrobeHistoryIntent,
  type WardrobeHistorySource,
} from '@/lib/schemas/chat-wardrobe-history.types';
import {
  cloneEquippedSlots,
  makeEmptyEquippedSlots,
  normalizeEquippedSlots,
  type EquippedSlots,
} from '@/lib/schemas/wardrobe.types';

const log = logger.child({ module: 'wardrobe-history' });

/** The slice of the chats repository `settle` reads the live slots through. */
export interface LiveOutfitReader {
  getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>;
}

/**
 * Sources whose first entry is the outfit itself: the paths that dress a
 * character for the first time in a chat. Any other source finding no rows is
 * a seat that predates the history, so its prior state is recorded as an
 * empty, seeded `0` before the change.
 */
const ARRIVAL_SOURCES: ReadonlySet<WardrobeHistorySource> = new Set(['chat-start', 'participant-added', 'merge']);

const EMPTY_SLOTS_HASH = hashEquippedSlots(makeEmptyEquippedSlots());

interface RawRow {
  id: string;
  chatId: string;
  characterId: string;
  entryIndex: number | bigint;
  slots: string;
  slotsHash: string;
  source: string;
  actorCharacterId: string | null;
  actorToolName?: string | null;
  isCurrent: number | bigint;
  createdAt: string;
}

function parseSlots(raw: string): EquippedSlots {
  try {
    return normalizeEquippedSlots(JSON.parse(raw));
  } catch {
    return makeEmptyEquippedSlots();
  }
}

function normalizeRow(row: RawRow): ChatWardrobeHistoryRow {
  const source = WardrobeHistorySourceSchema.safeParse(row.source);
  return {
    id: row.id,
    chatId: row.chatId,
    characterId: row.characterId,
    entryIndex: Number(row.entryIndex),
    slots: parseSlots(row.slots),
    slotsHash: row.slotsHash,
    source: source.success ? source.data : 'seeded',
    actorCharacterId: row.actorCharacterId ?? null,
    actorToolName: row.actorToolName ?? null,
    isCurrent: Number(row.isCurrent) === 1,
    createdAt: row.createdAt,
  };
}

/** Positional parameters for {@link CHAT_WARDROBE_HISTORY_INSERT_SQL}. */
function insertParams(row: ChatWardrobeHistoryRow): unknown[] {
  return [
    row.id,
    row.chatId,
    row.characterId,
    row.entryIndex,
    JSON.stringify(row.slots),
    row.slotsHash,
    row.source,
    row.actorCharacterId ?? null,
    row.actorToolName ?? null,
    row.isCurrent ? 1 : 0,
    row.createdAt,
  ];
}

function buildRow(input: {
  chatId: string;
  characterId: string;
  entryIndex: number;
  slots: EquippedSlots;
  source: WardrobeHistorySource;
  actorCharacterId: string | null;
  actorToolName?: string | null;
  at: string;
}): ChatWardrobeHistoryRow {
  const slots = cloneEquippedSlots(input.slots);
  return {
    id: randomUUID(),
    chatId: input.chatId,
    characterId: input.characterId,
    entryIndex: input.entryIndex,
    slots,
    slotsHash: hashEquippedSlots(slots),
    source: input.source,
    actorCharacterId: input.actorCharacterId,
    actorToolName: input.actorToolName ?? null,
    isCurrent: true,
    createdAt: input.at,
  };
}

/** What a `settle` call did, for logs and tests. */
export type SettleOutcome =
  | { kind: 'appended'; entryIndex: number; seeded: boolean }
  | { kind: 'unchanged'; entryIndex: number }
  | { kind: 'cursor-moved'; entryIndex: number }
  | { kind: 'skipped'; reason: string };

export class ChatWardrobeHistoryRepository {
  /** The job applier's write partition: these rows live in the main database. */
  readonly dbTarget = 'main' as const;

  /**
   * @param chats The live-slot reader `settle` consults — the container's own
   *   `ChatsRepository`.
   */
  constructor(private readonly chats?: LiveOutfitReader) {}

  // ============================================================================
  // The chokepoint
  // ============================================================================

  /**
   * Record what an outfit change leaves behind, or move the cursor. The one
   * runtime writer; see the module doc. Never throws: a failure is logged at
   * `warn` and the outfit change it follows stands. From the job child the
   * call is buffered and its return value synthetic — callers discard it.
   */
  async settle(chatId: string, characterId: string, intent: WardrobeHistoryIntent): Promise<SettleOutcome> {
    try {
      const outcome = intent.kind === 'append'
        ? await this.settleAppend(chatId, characterId, intent)
        : this.settleCursor(chatId, characterId, intent.index);
      if (outcome.kind === 'appended' || outcome.kind === 'cursor-moved') {
        publishRealtime('chats', chatId);
      }
      return outcome;
    } catch (error) {
      log.warn('Wardrobe history settle failed; the outfit change stands unrecorded', {
        chatId,
        characterId,
        intent,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'skipped', reason: 'error' };
    }
  }

  private async settleAppend(
    chatId: string,
    characterId: string,
    intent: Extract<WardrobeHistoryIntent, { kind: 'append' }>,
  ): Promise<SettleOutcome> {
    if (!this.chats) {
      throw new Error('ChatWardrobeHistoryRepository.settle needs a chats store');
    }
    const live = (await this.chats.getEquippedOutfitForCharacter(chatId, characterId)) ?? makeEmptyEquippedSlots();
    const liveHash = hashEquippedSlots(live);
    const { source, actorCharacterId, toolName } = intent.provenance;
    const actorToolName = source === 'pascal' ? toolName ?? null : null;
    const at = new Date().toISOString();

    // Read, compare and write in one synchronous transaction, so two settles
    // for the same character cannot both claim max + 1.
    const outcome = this.runAtomically((db): SettleOutcome => {
      const rows = (db
        .prepare(`SELECT * FROM "${CHAT_WARDROBE_HISTORY_TABLE}" WHERE "chatId" = ? AND "characterId" = ? ORDER BY "entryIndex" ASC`)
        .all(chatId, characterId) as RawRow[]).map(normalizeRow);
      const insert = db.prepare(CHAT_WARDROBE_HISTORY_INSERT_SQL);

      if (rows.length === 0) {
        const arrival = ARRIVAL_SOURCES.has(source);
        if (arrival || liveHash === EMPTY_SLOTS_HASH) {
          // The arrival outfit (or, for a seat that predates the history, an
          // empty outfit that is already the truth) is entry 0.
          const row = buildRow({
            chatId,
            characterId,
            entryIndex: 0,
            slots: live,
            source: arrival ? source : 'seeded',
            actorCharacterId: null,
            at,
          });
          insert.run(...insertParams(row));
          return { kind: 'appended', entryIndex: 0, seeded: !arrival };
        }
        // A seat that predates the history and was never dressed: its prior
        // state was, by construction, nothing recorded. Seed an empty 0 and
        // record the change as 1.
        const seed = buildRow({
          chatId,
          characterId,
          entryIndex: 0,
          slots: makeEmptyEquippedSlots(),
          source: 'seeded',
          actorCharacterId: null,
          at,
        });
        seed.isCurrent = false;
        insert.run(...insertParams(seed));
        const next = buildRow({ chatId, characterId, entryIndex: 1, slots: live, source, actorCharacterId: actorCharacterId ?? null, actorToolName, at });
        insert.run(...insertParams(next));
        return { kind: 'appended', entryIndex: 1, seeded: true };
      }

      const current = rows.find((row) => row.isCurrent) ?? rows[rows.length - 1];
      if (current.slotsHash === liveHash) {
        return { kind: 'unchanged', entryIndex: current.entryIndex };
      }

      const nextIndex = rows[rows.length - 1].entryIndex + 1;
      db.prepare(`UPDATE "${CHAT_WARDROBE_HISTORY_TABLE}" SET "isCurrent" = 0 WHERE "chatId" = ? AND "characterId" = ? AND "isCurrent" = 1`)
        .run(chatId, characterId);
      const next = buildRow({ chatId, characterId, entryIndex: nextIndex, slots: live, source, actorCharacterId: actorCharacterId ?? null, actorToolName, at });
      insert.run(...insertParams(next));
      return { kind: 'appended', entryIndex: nextIndex, seeded: false };
    });

    if (outcome.kind === 'unchanged') {
      log.debug('Outfit unchanged since the current entry; nothing recorded', {
        chatId,
        characterId,
        source,
        entryIndex: outcome.entryIndex,
      });
    } else {
      log.debug('Recorded wardrobe history entry', {
        chatId,
        characterId,
        source,
        actorCharacterId: actorCharacterId ?? null,
        actorToolName,
        outcome,
        slotsHash: liveHash,
      });
    }
    return outcome;
  }

  private settleCursor(chatId: string, characterId: string, index: number): SettleOutcome {
    const outcome = this.runAtomically((db): SettleOutcome => {
      const target = db
        .prepare(`SELECT * FROM "${CHAT_WARDROBE_HISTORY_TABLE}" WHERE "chatId" = ? AND "characterId" = ? AND "entryIndex" = ?`)
        .get(chatId, characterId, index) as RawRow | undefined;
      if (!target) return { kind: 'skipped', reason: 'missing-index' };
      db.prepare(`UPDATE "${CHAT_WARDROBE_HISTORY_TABLE}" SET "isCurrent" = 0 WHERE "chatId" = ? AND "characterId" = ? AND "isCurrent" = 1`)
        .run(chatId, characterId);
      db.prepare(`UPDATE "${CHAT_WARDROBE_HISTORY_TABLE}" SET "isCurrent" = 1 WHERE "id" = ?`).run(target.id);
      return { kind: 'cursor-moved', entryIndex: index };
    });

    if (outcome.kind === 'skipped') {
      log.warn('Wardrobe history cursor target missing; cursor left where it was', { chatId, characterId, index });
    } else {
      log.debug('Moved wardrobe history cursor', { chatId, characterId, index });
    }
    return outcome;
  }

  /**
   * Run `work` in one synchronous better-sqlite3 transaction on the main
   * connection. Nests as a savepoint inside the job applier's own transaction.
   */
  private runAtomically<R>(work: (db: NonNullable<ReturnType<typeof getRawDatabase>>) => R): R {
    const db = getRawDatabase();
    if (!db) {
      throw new Error('Wardrobe history: the main database is not initialized');
    }
    return db.transaction(() => work(db))();
  }

  // ============================================================================
  // Writes (restore / import / cleanup)
  // ============================================================================

  /**
   * Restore and import: write rows as given, ids and indices preserved. A row
   * that would break an invariant (a second current row, a duplicate index)
   * is logged and skipped rather than failing the whole restore.
   */
  async upsertRows(rows: ChatWardrobeHistoryRow[]): Promise<number> {
    let written = 0;
    for (const row of rows) {
      try {
        const slots = normalizeEquippedSlots(row.slots);
        await rawQuery(
          `${CHAT_WARDROBE_HISTORY_INSERT_SQL}
           ON CONFLICT ("id") DO UPDATE SET
             "entryIndex" = excluded."entryIndex",
             "slots" = excluded."slots",
             "slotsHash" = excluded."slotsHash",
             "source" = excluded."source",
             "actorCharacterId" = excluded."actorCharacterId",
             "actorToolName" = excluded."actorToolName",
             "isCurrent" = excluded."isCurrent",
             "createdAt" = excluded."createdAt"`,
          insertParams({ ...row, slots, slotsHash: hashEquippedSlots(slots) }),
        );
        written += 1;
      } catch (error) {
        log.warn('Skipped a wardrobe history row that would break the timeline', {
          id: row.id,
          chatId: row.chatId,
          characterId: row.characterId,
          entryIndex: row.entryIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    log.debug('Upserted wardrobe history rows', { requested: rows.length, written });
    return written;
  }

  /** Character deleted: their timelines have no reader. */
  async deleteByCharacter(characterId: string): Promise<void> {
    await rawQuery(`DELETE FROM "${CHAT_WARDROBE_HISTORY_TABLE}" WHERE "characterId" = ?`, [characterId]);
    log.debug('Dropped wardrobe history for a deleted character', { characterId });
  }

  // ============================================================================
  // Reads
  // ============================================================================

  /** One character's timeline in a chat, ascending by index. */
  async findEntries(chatId: string, characterId: string): Promise<ChatWardrobeHistoryRow[]> {
    const rows = await rawQuery<RawRow[]>(
      `SELECT * FROM "${CHAT_WARDROBE_HISTORY_TABLE}" WHERE "chatId" = ? AND "characterId" = ? ORDER BY "entryIndex" ASC`,
      [chatId, characterId],
    );
    return rows.map(normalizeRow);
  }

  /** The entry the character is wearing now, or null when there is no history. */
  async findCurrent(chatId: string, characterId: string): Promise<ChatWardrobeHistoryRow | null> {
    const rows = await rawQuery<RawRow[]>(
      `SELECT * FROM "${CHAT_WARDROBE_HISTORY_TABLE}" WHERE "chatId" = ? AND "characterId" = ? AND "isCurrent" = 1 LIMIT 1`,
      [chatId, characterId],
    );
    return rows.length > 0 ? normalizeRow(rows[0]) : null;
  }

  /** Every row for a chat (export, backup), by character then index. */
  async findByChatId(chatId: string): Promise<ChatWardrobeHistoryRow[]> {
    const rows = await rawQuery<RawRow[]>(
      `SELECT * FROM "${CHAT_WARDROBE_HISTORY_TABLE}" WHERE "chatId" = ? ORDER BY "characterId", "entryIndex" ASC`,
      [chatId],
    );
    return rows.map(normalizeRow);
  }

  /** Every row (backup). */
  async findAll(): Promise<ChatWardrobeHistoryRow[]> {
    const rows = await rawQuery<RawRow[]>(
      `SELECT * FROM "${CHAT_WARDROBE_HISTORY_TABLE}" ORDER BY "chatId", "characterId", "entryIndex" ASC`,
    );
    return rows.map(normalizeRow);
  }
}
