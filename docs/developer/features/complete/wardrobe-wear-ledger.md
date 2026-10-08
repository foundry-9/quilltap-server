# Wardrobe wear ledger: who has worn what, how often, and when

**Status:** implemented in 4.10-dev (2026-10-07). Part 2 of the wardrobe programme; do
[wardrobe-list-legibility.md](wardrobe-list-legibility.md) first (this spec adds a line and a
sort to the row it reshapes). [wardrobe-item-images.md](wardrobe-item-images.md) is part 3 and
is independent of this one.

Every wardrobe item keeps a tally: how many times it has been worn, when it was first and last
worn, and by whom. An outfit (a composite) keeps the same tally, and wearing it credits the
garments it actually put on. The item's creation date already exists (`createdAt` in
frontmatter) and is surfaced alongside.

## 1. Settled decisions (operator, 2026-10-07)

- **One wear = one equip transition.** A garment earns a wear each time it goes from *not worn*
  to *worn* on a character in a chat, by any path: the chat's opening outfit, the Wear button,
  the `wardrobe_wear` tool, an outfit pick, a gifted-and-worn `wardrobe_create`. Re-saving the
  same outfit is not a wear. Taking it off and putting it back on later in the same chat is a
  second wear. "Worn" is per character per chat: two characters in one chat sharing a General
  coat each earn a wear.
- **Aggregates only.** No per-event log. Per item, per wearer: a count, first and last worn,
  and the chat it was last worn in. Totals are sums over wearers.
- **Outfits cascade.** Wearing a composite credits the composite once and credits each
  component the wear actually put on. Components already on the character are not re-credited
  (they did not transition). A composite whose components were *all* already worn earns
  nothing — nothing happened. Wearing the components one by one never credits the composite.
- **Characters see it.** `wardrobe_list` gets a compact "last worn" per item; `wardrobe_read`
  gets the full tally with names.
- **Operator sees it** on the row (compact), in the editor (full breakdown), and as a sort and a
  "never worn" filter in the Wardrobe dialog. Not in the per-slot picker.
- **Merges are not wears; previous-chat carry-over is.** A character who starts a new chat
  dressed as they ended the last one is putting the outfit on in a new chat (a transition from
  nothing). A merge stitches two existing chats and changes nobody's clothes.
- **Backfill once.** Existing chats' current equipped state seeds the ledger at one wear each,
  dated by the chat's `updatedAt`, so the feature does not start from "never worn" on an
  instance with a year of history.

## 2. Where the tally lives, and why not in the item

Wardrobe items are **not** SQL rows. Since 4.7 every item is a markdown file with frontmatter
in a document-store `Wardrobe/` folder (character vault, group store, project store, or
Quilltap General); `wardrobe_items` was dropped. Every write goes through
`createAtLocation` / `updateAtLocation` in
`lib/database/repositories/vault-overlay/wardrobe-writes.ts`, which re-projects the **whole
folder** — every `Wardrobe/*.md` rewritten and re-indexed — and unconditionally bumps
`updatedAt`.

A counter in frontmatter would therefore:

- rewrite thirty files to count one wear,
- turn `updatedAt` into "last worn", losing "last edited",
- be a read-modify-write that the forked job child (autonomous rooms run `wardrobe_wear` there)
  cannot do correctly — its reads are a stale snapshot and its writes are buffered.

So the ledger is a **SQL table keyed by item id**, with atomic increments. The item file is
untouched by a wear. This also handles shared garments naturally: a General coat worn by five
characters is one file and five ledger rows.

### 2.1 DDL

```sql
CREATE TABLE "wardrobe_wear_stats" (
  "id" TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL,                 -- wardrobe item id (a vault file's frontmatter id); no FK, items are not rows
  "wearerCharacterId" TEXT,               -- NULL = unattributed (wearer deleted, or import could not resolve them)
  "wearCount" INTEGER NOT NULL DEFAULT 0,
  "firstWornAt" TEXT NOT NULL,
  "lastWornAt" TEXT NOT NULL,
  "lastWornChatId" TEXT,                  -- no FK; a deleted chat leaves a dangling id the reader treats as "a chat since deleted"
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE UNIQUE INDEX "idx_wardrobe_wear_stats_item_wearer"
  ON "wardrobe_wear_stats" ("itemId", COALESCE("wearerCharacterId", ''));
CREATE INDEX "idx_wardrobe_wear_stats_wearer" ON "wardrobe_wear_stats" ("wearerCharacterId");
```

No `userId`: Quilltap is single-user per instance. No FK on `wearerCharacterId` because
`ON DELETE SET NULL` would collide with the unique index when two wearers of one item are
deleted; the character-delete service folds rows instead (§4.4). Document in
`docs/developer/DDL.md` under a new `### wardrobe_wear_stats` heading, with the paragraph
above about why it is not frontmatter.

Migration `add-wardrobe-wear-stats-table-v1` creates it; `seed-wardrobe-wear-stats-v1` (§7)
backfills. Both get `PRETTY_LABELS` entries in `lib/startup/prettify.ts`:

```ts
'add-wardrobe-wear-stats-table-v1': 'Ruling a ledger for who has worn what',
'seed-wardrobe-wear-stats-v1': 'Taking stock of what the cast is wearing this minute',
```

### 2.2 Repository: `WardrobeWearRepository` (`lib/database/repositories/wardrobe-wear.repository.ts`)

Registered as `repos.wardrobeWear`. Methods:

```ts
/** Atomic upsert-and-increment, one statement per entry. Safe to replay from a job child. */
incrementWears(entries: Array<{ itemId: string; wearerCharacterId: string; chatId: string; at: string }>): Promise<void>
// INSERT ... ON CONFLICT(itemId, COALESCE(wearerCharacterId,'')) DO UPDATE SET
//   wearCount = wearCount + 1, lastWornAt = excluded.lastWornAt, lastWornChatId = excluded.lastWornChatId, updatedAt = ...

/** Totals for a list of items, for list views. One GROUP BY query. */
findSummaries(itemIds: string[]): Promise<Map<string, WardrobeWearSummary>>

/** Totals plus the per-wearer rows, for the editor and wardrobe_read. */
findHistory(itemId: string): Promise<WardrobeWearHistory | null>

/** Item deleted: drop its rows. */
deleteByItemIds(itemIds: string[]): Promise<void>

/** Character deleted: fold their rows into the item's unattributed row (sum counts, min first, max last). */
foldWearerIntoUnattributed(characterId: string): Promise<void>

/** Import/restore: write rows as given (no increment). */
upsertRows(rows: WardrobeWearStatsRow[]): Promise<void>
```

`incrementWears`, `deleteByItemIds`, `foldWearerIntoUnattributed`, `upsertRows` all start with
a prefix in the job-child proxy's `WRITE_PREFIXES`
(`lib/background-jobs/child/child-repositories-proxy.ts`), so from a child they buffer and
replay in the parent; `find*` read through. The one method that does not fit a prefix is the
chokepoint in §3, which gets an explicit `METHOD_OVERRIDES` entry.

Types in `lib/schemas/wardrobe-wear.types.ts`:

```ts
export const WardrobeWearSummarySchema = z.object({
  wearCount: z.number().int().nonnegative(),
  firstWornAt: TimestampSchema.nullable(),
  lastWornAt: TimestampSchema.nullable(),
  lastWornChatId: UUIDSchema.nullable(),
});
export const WardrobeWearerSchema = z.object({
  characterId: UUIDSchema.nullable(),       // null = unattributed
  wearCount: z.number().int().positive(),
  firstWornAt: TimestampSchema,
  lastWornAt: TimestampSchema,
  lastWornChatId: UUIDSchema.nullable(),
});
export const WardrobeWearHistorySchema = WardrobeWearSummarySchema.extend({
  wearers: z.array(WardrobeWearerSchema),   // most recent first
});
```

A `WardrobeWearSummary` with `wearCount: 0` and nulls is the canonical "never worn"; readers
return that rather than `undefined` so the UI has one shape.

## 3. The chokepoint: `commitEquippedOutfit`

### 3.1 The problem it solves

There is one physical write today — `ChatsRepository.setEquippedOutfit(chatId, characterId,
slots)` (`lib/database/repositories/chats.repository.ts`) — reached from six call sites in
three families:

1. the displacement primitives `equipItem` / `replaceItem` / `addToSlot` / `removeFromSlot`
   in `lib/wardrobe/outfit-displacement.ts` (used by the HTTP wear/replace/add modes, by
   `wardrobe_wear`, `wardrobe_take_off`, and `wardrobe_create` with `equip_now`);
2. the HTTP `set_all` branch in `app/api/v1/chats/[id]/actions/outfit.ts` — **the Wardrobe
   dialog's only route**, since the dialog stages edits client-side and flushes whole slot
   maps;
3. `applyOutfitSelections` in `lib/wardrobe/apply-outfit-selections.ts` (new chat, participant
   added or reactivated, merge).

None of them knows what was *newly* put on: they hand over the final slots. And since 4.8.1 a
composite is dissolved to its leaves **before** the write (`dissolveBundleToLeaves`,
`lib/wardrobe/dissolve-bundles.ts`), so the stored slots cannot say an outfit was worn — only
its leaves are there.

Two consequences shape the design:

- **Newly worn is a diff** of leaf ids: `next − prior`. The diff must be computed against the
  *true* prior state, which in the job child is not what the handler read (its snapshot is
  stale within a job, and its own earlier writes are invisible to it).
- **Composite credit is a caller contract.** Whoever dissolved a bundle says so. The diff
  cannot recover it.

### 3.2 The method

The chokepoint is a repository method so that, called from the job child, it is *buffered and
replayed in the parent*, where it runs against the real prior state in one transaction:

```ts
// lib/database/repositories/wardrobe-wear.repository.ts
export type EquipSource =
  | 'ui'                // Wardrobe dialog set_all / wear / replace / add_to_slot
  | 'tool'              // wardrobe_wear, wardrobe_create equip_now
  | 'chat-start'        // applyOutfitSelections for a new chat
  | 'participant-added' // applyOutfitSelections for an added/reactivated seat
  | 'merge'             // applyOutfitSelections from a merge (never counts)
  | 'take-off';         // removeFromSlot; nothing can be newly worn, kept for the log line

export interface CommitEquippedOutfitInput {
  chatId: string;
  characterId: string;
  nextSlots: EquippedSlots;
  /** Bundles the caller dissolved into nextSlots, with the leaves each contributed. */
  wornBundles?: Array<{ id: string; leafIds: string[] }>;
  source: EquipSource;
  at?: string;          // ISO; defaults to now at execution time
}

export interface CommitEquippedOutfitResult {
  slots: EquippedSlots;
  newlyWornLeafIds: string[];
  creditedBundleIds: string[];
  changed: boolean;
}

commitEquippedOutfit(input): Promise<CommitEquippedOutfitResult>
```

Execution (parent, inside one transaction):

1. `prior = chats.getEquippedOutfitForCharacter(chatId, characterId)` (normalized; a legacy row
   may still hold whole composite ids — they are treated as plain ids and diffed as such).
2. `chats.setEquippedOutfit(chatId, characterId, nextSlots)` — unchanged semantics, written
   even when equal, so the announcement and avatar hooks behave exactly as today.
3. `newlyWorn = allEquippedItemIds(nextSlots) − allEquippedItemIds(prior)`.
4. `creditedBundles = wornBundles.filter(b => b.leafIds.some(id => newlyWorn.has(id))).map(b => b.id)`.
5. If `source !== 'merge'` and there is anything to credit:
   `incrementWears([...newlyWorn, ...creditedBundles].map(itemId => ({ itemId, wearerCharacterId: characterId, chatId, at })))`.
6. Return the result. **From the child the return value is synthetic** (the proxy's rule for
   buffered writes); callers must not branch on it. The primitives return the `nextSlots` they
   computed, as they do today.

`chats.setEquippedOutfit` keeps existing and keeps its name, but after this change its only
callers are this method and `removeEquippedItemFromAllChats` (item-delete cleanup, a removal).
A unit test greps `lib/` and `app/` for `setEquippedOutfit(` and fails on any other caller —
the same kind of fence the memory-deletion chokepoint relies on.

Add `'wardrobeWear.commitEquippedOutfit': 'write'` to `METHOD_OVERRIDES` in the child proxy.

### 3.3 Callers, and what each passes

| Site | `source` | `wornBundles` |
|---|---|---|
| `equipItem` (`outfit-displacement.ts`) | from caller (`'ui'` or `'tool'`) | `[{ id: item.id, leafIds }]` when `dissolveBundleToLeaves` returned leaves; `[]` when the item was a leaf or dissolution fell back to storing the bundle id whole |
| `replaceItem` | same | same |
| `addToSlot` | same | the bundle and the subset of leaves `addItemToSlot` laid into that slot |
| `removeFromSlot` | `'take-off'` | `[]` |
| HTTP `set_all` (`outfit.ts`) | `'ui'` | from the request body: `wornBundleIds: string[]` (new optional field, validated against `findByIdsForCharacter`); the server expands each with `expandComposites` to get `leafIds` |
| `applyOutfitSelections` `default` | `'chat-start'` / `'participant-added'` | the `isDefault` bundles `buildDefaultOutfit` dissolved (it must return them — today it returns only slots) |
| `applyOutfitSelections` `llm_choose` | same | the bundles `chooseLLMOutfit` picked and `dissolveBundlesInSlots` dissolved (same change: return the dissolved bundle ids) |
| `applyOutfitSelections` `manual` | same | `[]` — the composer dissolves client-side and sends leaves; the new-chat form gains the same optional `wornBundleIds` on each selection so an outfit picked from the quick-pick is credited (`OutfitSelectionSchema` gains `wornBundleIds?: string[]`) |
| `applyOutfitSelections` `previous_chat` | same | `[]` (a carry-over of leaves; the bundle was credited in the source chat) |
| `applyOutfitSelections` `none` | same | nothing newly worn; still goes through the chokepoint so the write path is one |
| `apply-chat-merge.ts` | `'merge'` | `[]`; never credits |

The primitives gain a `source` parameter. Their existing callers are few (`outfit.ts`, the
three tool handlers); pass the obvious value at each.

**The Wardrobe dialog's staged edits.** The dialog dissolves bundles client-side with the pure
`wearItemIntoSlots` / `addItemToSlot` and remembers nothing about which bundle produced which
leaves. It must now accumulate `wornBundleIds` per character in its staged state (push the
bundle's id whenever a staged edit applies a bundle; `OutfitQuickPick` and the "Wear this
fitting" button are the two producers) and send them with the `set_all` flush. If the staged
state is rebased or reset (`classifyStagedOutfits`, `rebaseStagedEdits` in
`lib/wardrobe/staged-live-outfits.ts` / `bundle-mutations.ts`), the accumulated ids reset with
it. The server does the leaf expansion; the client sends ids only.

### 3.4 Non-wear writes to `equippedOutfit`

These bypass the chokepoint on purpose and must stay that way:

- `removeEquippedItemFromAllChats` (item deleted) — a removal.
- `chats.create` from backup restore (`lib/backup/restore/restore.ts`) and `.qtap` import
  (`lib/import/quilltap-import/import-entities.ts`) — bulk copies of existing state; the
  ledger rows come with them (§6).
- The avatar preview and regenerate routes pass `equippedSlotsOverride` to the job and write
  nothing.

### 3.5 Known limitation carried forward (file it as a bug)

In the job child, each displacement primitive reads the prior slots from the readonly snapshot,
which does not see the job's own earlier buffered writes. Two `wardrobe_wear` operations in one
autonomous turn therefore compute from the same stale baseline and the second buffered
`setEquippedOutfit` overwrites the first. This predates the ledger. The ledger's crediting is
**not** affected — each replayed `commitEquippedOutfit` diffs against the true prior at replay
time — but the slots themselves are. Open a bug in `docs/developer/bugs/` for the slot
overwrite; the fix (make the primitives take the prior slots from the previous op's result
within a tool call, or move the whole op list into one `commitEquippedOutfit`) is outside this
spec.

**Filed as [bug 179](../../bugs/fixed/bug-179-buffered-outfit-overwrite.md) and fixed
2026-10-07** — neither of the two fixes above: the job child's repository proxy now keeps a
per-job overlay of the slots each buffered `commitEquippedOutfit` leaves behind, and answers
`chats.getEquippedOutfitForCharacter` from it, so every reader in the job (not only the
primitives) sees the job's own outfit changes.

## 4. Lifecycle hygiene

### 4.1 Item deleted

`cleanupEquippedRefs` in `lib/wardrobe/item-route-steps.ts` is called by all three item-delete
routes. Add `repos.wardrobeWear.deleteByItemIds([itemId])` beside it, in the same step. A
composite's deletion does not touch its components' rows.

### 4.2 Transfers (`app/api/v1/wardrobe/transfers/route.ts`)

- **Move** keeps the item id (`createAtDestination` passes `{ id, createdAt, updatedAt }`),
  so the ledger follows for free. Assert it in a test.
- **Copy** mints a new id. A copy is a new garment: its ledger starts empty. Do not copy rows.

### 4.3 Character archived / rehydrated

Nothing. An archived character's rows stay; the reader labels a wearer it cannot resolve.

### 4.4 Character deleted

The character-delete service calls `foldWearerIntoUnattributed(characterId)`: for each of
their rows, add the count into the item's `wearerCharacterId IS NULL` row (creating it if
absent; `firstWornAt = min`, `lastWornAt = max`, `lastWornChatId` from the later of the two),
then delete theirs. Totals survive; attribution does not. The unique index is why this is a
fold and not `SET NULL`.

### 4.5 Chat deleted

Nothing. `lastWornChatId` dangles; the readers resolve it with `findById` and show "a chat since
deleted" when it is gone.

## 5. Reading it

### 5.1 API

- Every wardrobe collection GET (the five routes in part 1 §4.2) attaches `wear:
  WardrobeWearSummary` to each item, from one `findSummaries(ids)` call. Like `origin`, it is
  a response annotation, not a field of `WardrobeItemSchema`, and is never accepted on write.
- Item GET gets `?action=wear-history` → `{ history: WardrobeWearHistory, wearers:
  Array<{ characterId, name, avatarUrl }> , lastWornChat: { id, title } | null }`. Names come
  from `characters.findByIdRaw` (a broken vault costs a label, not a 500 — the rule from
  `lib/chat/speaker-names.ts`); a missing character renders as "a departed character" and the
  null wearer as "unattributed".

### 5.2 Wardrobe dialog row (`wardrobe-item-row.tsx`)

One muted line under the badges:

- `Worn 4× · last Tue` — `formatRelativeDate` from `lib/format-time.ts` for the date.
- `Worn once · last 3 weeks ago`
- `Never worn`

The count is a plain number in the row; it is the thing being compared across rows. The full
breakdown is the editor's job.

### 5.3 Sort and filter (`wardrobe-control-dialog.tsx`)

- A **Sort** select beside the Items/Outfits tabs: `Title` (today's order, default), `Recently
  worn`, `Most worn`, `Newest`. Secondary key is always title. `Never worn` items sort last
  under the two wear sorts.
- A **Never worn** checkbox beside *Show archived* / *Show shared*. It is a filter, not a sort,
  so it composes with any sort.
- Both are dialog state only (not persisted), like `showArchived` today.
- `ProjectWardrobeManager.tsx` (the Prospero card) gets the row line, not the sort — the card
  is a short list.

### 5.4 Editor (`wardrobe-item-editor.tsx`)

A read-only **Wear history** section at the bottom of the form (edit mode only; a new item has
none):

```
Created        12 Mar 2026
Times worn     4
First worn     14 Mar 2026
Last worn      Tue 6 Oct 2026, in “The Thornfield Dinner”   ← link to /salon/{id} when the chat exists
Worn by        [avatar] Vivienne   3×, last Tue
               [avatar] Marguerite 1×, last 2 weeks ago
```

Fetched on open via `?action=wear-history`. For a composite, a one-line note under the table:
"Wearing this outfit also counts a wear for each garment it put on."

### 5.5 Tools

- `wardrobe_list` (`lib/tools/handlers/wardrobe-list-handler.ts`): append ` · last worn 3 days
  ago` or ` · never worn` to each line. Dates relative via `formatRelativeAge` (clock-injected
  so the snapshot test is stable). The list handler already loads the pool; add one
  `findSummaries` call.
- `wardrobe_read` (`wardrobe-read-handler.ts`): a `Wear` paragraph after the slot occupancy:
  "Worn 4 times, first 14 Mar 2026, last 3 days ago by you. Also worn by Marguerite (once)."
  Second person for the calling character (`characterId === context.characterId`), names for
  others, "someone no longer in the household" for a deleted wearer. The tool's output type and
  its snapshot in `lib/tools/__tests__/tool-definitions-snapshot.test.ts` are updated (`npx
  jest -u` on that file after the schema change, as the standing rule says). Input schemas are
  unchanged.

Nothing is injected into the system prompt or the outfit description; a character learns about
wear only by asking.

## 6. Export, import, backup

- **`.qtap` export** (`lib/export/ndjson-writer.ts`): a new record kind `wardrobe_wear`, one
  per ledger row whose `itemId` belongs to an exported item — character-owned items (the
  `wardrobe_item` records) and shared items that ride as `doc_mount_document` records under a
  `Wardrobe/` folder. `QtapWardrobeWearRecord { kind: 'wardrobe_wear'; data: WardrobeWearStatsRow }`
  in `lib/export/types.ts`; `$defs/WardrobeWear` in `public/schemas/qtap-export.schema.json`.
- **Import** (`lib/import/quilltap-import/`): after items are created and ids remapped, remap
  `itemId` and `wearerCharacterId` through the id map; a wearer not in the import (or not
  resolvable on this instance) folds into the item's unattributed row; a row whose item did
  not import is dropped. `lastWornChatId` is remapped if the chat came along, else nulled.
  Written with `upsertRows`.
- **Backup/restore**: add the table to `lib/backup/backup-service.ts`'s table list and
  `lib/backup/types.ts`; restore via the generic table path; `uuid-remap.ts` entries for
  `itemId`, `wearerCharacterId`, `lastWornChatId`. Delete-service clears it with the rest.

## 7. Backfill migration (`seed-wardrobe-wear-stats-v1`)

For each chat (`SELECT id, updatedAt, equippedOutfit FROM chats`), for each `characterId` in
the normalized `equippedOutfit` map, for each item id across its slots: upsert a row with
`wearCount = 1`, `firstWornAt = lastWornAt = chat.updatedAt`, `lastWornChatId = chat.id`
(`ON CONFLICT` → `wearCount + 1`, `lastWornAt = max`). Whole composite ids left in legacy rows
are credited as themselves. Item ids that no longer resolve to a file produce harmless orphan
rows that no list ever joins; nothing prunes them and nothing needs to. `reportProgress(i + 1,
chats.length, 'chats')` per chat, totals counted up front with `SELECT COUNT(*)`.

The migration is idempotent in effect only if run once; it is listed once in
`migrations/scripts/index.ts`, after the table migration.

## 8. Logging

`commitEquippedOutfit` logs at `debug` with `chatId`, `characterId`, `source`, counts of
`newlyWorn` and `creditedBundles`, and `changed`. `foldWearerIntoUnattributed` and the backfill
log at `info` with row counts. No per-row logging in `incrementWears`.

## 9. Tests

- Repository (real SQLite, the `better-sqlite3` absolute-root-path rule from the test
  conventions): `incrementWears` upserts and increments; the COALESCE unique index holds for
  two NULL-wearer inserts on one item (second increments); `foldWearerIntoUnattributed` sums
  and takes min/max; `findSummaries` returns the zero summary for unknown ids.
- `commitEquippedOutfit`: diff crediting (leaf newly worn → +1; already worn → nothing;
  removed → nothing); bundle credited only when one of its leaves transitioned; `'merge'`
  writes slots but no rows; equal slots → `changed: false`, still written.
- Caller fence: no `setEquippedOutfit(` outside the two sanctioned callers.
- Job child: `commitEquippedOutfit` classifies as a write in the proxy (unit test on
  `classifyMethod` or whatever the proxy exposes); buffered-then-replayed ordering credits
  correctly across two ops in one job (integration test with the existing child-write
  harness, if there is one; otherwise a parent-side replay test over the buffered payload).
- `applyOutfitSelections`: each mode passes the right `source` and `wornBundles`
  (`buildDefaultOutfit` and the `llm_choose` path now return the dissolved bundle ids).
- Dialog: staged bundle ids accumulate and travel with `set_all`; reset on rebase.
- Routes: `?action=wear-history` resolves names raw, labels a missing character, links the chat
  only when it exists.
- Tools: snapshot updates for `wardrobe_list` / `wardrobe_read` output; relative dates under an
  injected clock.
- Migration: seeds from a fixture of two chats sharing an item, asserts the increment.

## 10. Docs and bookkeeping

- `help/wardrobe.md`: a new section **"The ledger"** — what counts as a wear (in the
  house voice: a garment earns a wear each time it is put on, not each time the outfit is
  saved), where to see it (row line, editor section, sort and Never-worn filter), that outfits
  credit their garments, and that a character can ask after it with `wardrobe_read`.
- `help/project-wardrobe.md`: one paragraph — shared garments keep one tally across every
  character who borrows them.
- `docs/developer/DDL.md`: the table (§2.1) with its rationale.
- `docs/developer/API.md`: the `wear` annotation on collection reads, `?action=wear-history`,
  the optional `wornBundleIds` on `set_all` and on `OutfitSelection`.
- `public/schemas/qtap-export.schema.json`: `WardrobeWear`.
- `docs/CHANGELOG.md`: plain voice.
- `docs/developer/bugs/`: the §3.5 bug, filed with the next number.
- `lib/tools/__tests__/tool-definitions-snapshot.test.ts`: re-snapshot.

## 11. Gotchas

- **Never credit in the child from the handler.** It is tempting to call `incrementWears`
  from `wardrobe-wear-handler.ts` with the item in hand. Do not: the handler's view of "already
  worn" is a stale snapshot, and the ledger would double-count. All crediting is inside
  `commitEquippedOutfit`, which only ever executes in the parent.
- **`wornBundles` is a claim, not a fact.** The server intersects with the diff; a client that
  sends a bundle whose leaves were all already on gets no credit for it. Validate the ids
  against the character's reachable tiers (`findByIdsForCharacter`) so a client cannot credit
  a garment it cannot see.
- **`updatedAt` on the item means edited, not worn.** Keep it that way; the row line reads
  `lastWornAt` from the ledger.
- **Precedence shadows share an id.** A character-owned item that shadows a General archetype
  of the same id (possible after a copy-then-move dance) shares one ledger key. Acceptable and
  documented; the row's `origin` from part 1 says which one you are looking at.
- **`formatRelativeDate` vs `formatRelativeAge`:** the UI uses the former (wall-clock), the tool
  text the latter with an injected `nowMs` so snapshots do not rot.
