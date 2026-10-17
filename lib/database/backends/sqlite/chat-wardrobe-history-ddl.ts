/**
 * The `chat_wardrobe_history` DDL — single source of truth.
 *
 * The table-creation migration and the repository tests share these
 * statements; nothing else spells them (a grep-test holds it).
 *
 * Two unique indexes carry the invariants: `(chatId, characterId, entryIndex)`
 * keeps each timeline's numbers unique, and the partial index on
 * `(chatId, characterId) WHERE isCurrent = 1` admits at most one cursor per
 * timeline. `slots` is plain JSON TEXT like `chats.equippedOutfit` — not a
 * compressed text column; nothing searches it and the rows are tiny.
 *
 * @module database/backends/sqlite/chat-wardrobe-history-ddl
 */

export const CHAT_WARDROBE_HISTORY_TABLE = 'chat_wardrobe_history';

export const CHAT_WARDROBE_HISTORY_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "chat_wardrobe_history" (
    "id" TEXT PRIMARY KEY,
    "chatId" TEXT NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
    "characterId" TEXT NOT NULL,
    "entryIndex" INTEGER NOT NULL,
    "slots" TEXT NOT NULL,
    "slotsHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actorCharacterId" TEXT,
    "isCurrent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_chat_wardrobe_history_entry"
    ON "chat_wardrobe_history" ("chatId", "characterId", "entryIndex")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_chat_wardrobe_history_current"
    ON "chat_wardrobe_history" ("chatId", "characterId") WHERE "isCurrent" = 1`,
];

/** The one INSERT. Positional: id, chatId, characterId, entryIndex, slots, slotsHash, source, actorCharacterId, isCurrent, createdAt. */
export const CHAT_WARDROBE_HISTORY_INSERT_SQL = `
  INSERT INTO "chat_wardrobe_history"
    ("id", "chatId", "characterId", "entryIndex", "slots", "slotsHash", "source", "actorCharacterId", "isCurrent", "createdAt")
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
