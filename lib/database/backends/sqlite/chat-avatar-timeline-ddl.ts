/**
 * The `chat_avatar_timeline` DDL — single source of truth.
 *
 * The table-creation migration and the repository tests share these
 * statements; nothing else spells them.
 *
 * Append-only: one row per avatar bound to a (chat, character), dated by
 * `effectiveAt`. Nothing renumbers, prunes or rewrites rows; a row whose image
 * has since been deleted stays, and the Salon's resolver falls back.
 *
 * @module database/backends/sqlite/chat-avatar-timeline-ddl
 */

export const CHAT_AVATAR_TIMELINE_TABLE = 'chat_avatar_timeline';

export const CHAT_AVATAR_TIMELINE_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "chat_avatar_timeline" (
    "id" TEXT PRIMARY KEY,
    "chatId" TEXT NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
    "characterId" TEXT NOT NULL,
    "imageId" TEXT,
    "effectiveAt" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_chat_avatar_timeline_chat"
    ON "chat_avatar_timeline" ("chatId", "characterId", "effectiveAt")`,
];

/** The one INSERT. Positional: id, chatId, characterId, imageId, effectiveAt, source, createdAt. */
export const CHAT_AVATAR_TIMELINE_INSERT_SQL = `
  INSERT INTO "chat_avatar_timeline"
    ("id", "chatId", "characterId", "imageId", "effectiveAt", "source", "createdAt")
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;
