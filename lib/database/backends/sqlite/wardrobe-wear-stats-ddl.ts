/**
 * The `wardrobe_wear_stats` DDL — single source of truth.
 *
 * The table-creation migration and the repository tests share these
 * statements; nothing else spells them.
 *
 * Why the unique index is on `COALESCE("wearerCharacterId", '')`: SQLite
 * treats NULLs as distinct in a plain unique index, so two "unattributed"
 * rows for one item would both be admitted. Folding NULL to `''` makes the
 * unattributed row unique per item, which is what lets
 * `ON CONFLICT ("itemId", COALESCE("wearerCharacterId", ''))` upsert it.
 *
 * @module database/backends/sqlite/wardrobe-wear-stats-ddl
 */

export const WARDROBE_WEAR_STATS_TABLE = 'wardrobe_wear_stats';

export const WARDROBE_WEAR_STATS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "wardrobe_wear_stats" (
    "id" TEXT PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "wearerCharacterId" TEXT,
    "wearCount" INTEGER NOT NULL DEFAULT 0,
    "firstWornAt" TEXT NOT NULL,
    "lastWornAt" TEXT NOT NULL,
    "lastWornChatId" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_wardrobe_wear_stats_item_wearer"
    ON "wardrobe_wear_stats" ("itemId", COALESCE("wearerCharacterId", ''))`,
  `CREATE INDEX IF NOT EXISTS "idx_wardrobe_wear_stats_wearer"
    ON "wardrobe_wear_stats" ("wearerCharacterId")`,
];

/**
 * The atomic upsert-and-increment. One wear for one (item × wearer): inserts
 * the row at count 1, or bumps an existing row's count and moves its "last
 * worn" forward — never backward, so a replayed or backfilled earlier wear
 * cannot rewind it. Bind with {@link wardrobeWearIncrementParams}.
 */
export const WARDROBE_WEAR_INCREMENT_SQL = `
  INSERT INTO "wardrobe_wear_stats"
    ("id", "itemId", "wearerCharacterId", "wearCount", "firstWornAt", "lastWornAt", "lastWornChatId", "createdAt", "updatedAt")
  VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
  ON CONFLICT ("itemId", COALESCE("wearerCharacterId", '')) DO UPDATE SET
    "wearCount" = "wearCount" + 1,
    "firstWornAt" = MIN("firstWornAt", excluded."firstWornAt"),
    "lastWornChatId" = CASE WHEN excluded."lastWornAt" >= "lastWornAt" THEN excluded."lastWornChatId" ELSE "lastWornChatId" END,
    "lastWornAt" = MAX("lastWornAt", excluded."lastWornAt"),
    "updatedAt" = excluded."updatedAt"
`;

/** Positional parameters for {@link WARDROBE_WEAR_INCREMENT_SQL}. */
export function wardrobeWearIncrementParams(entry: {
  id: string;
  itemId: string;
  wearerCharacterId: string | null;
  at: string;
  chatId: string | null;
  now: string;
}): unknown[] {
  return [
    entry.id,
    entry.itemId,
    entry.wearerCharacterId,
    entry.at,
    entry.at,
    entry.chatId,
    entry.now,
    entry.now,
  ];
}
