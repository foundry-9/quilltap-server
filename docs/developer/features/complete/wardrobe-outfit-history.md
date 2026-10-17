# Wardrobe outfit history: a per-character ledger of what was worn in a chat, and rolling back to it

**Status:** Implemented (2026-10-16, 4.11-dev). Design of record; see [As built](#16-as-built).
Part 4 of the wardrobe programme. Builds on
[wardrobe-wear-ledger.md](wardrobe-wear-ledger.md) (the equip chokepoint,
`commitEquippedOutfit`) and [wardrobe-refactor.md](wardrobe-refactor.md) (the pool, the
gesture functions, `notifyWardrobeChanged`). Read §3 of the ledger spec before touching anything
here: every write in this feature rides the same chokepoint, and the reasons it exists are the
reasons this feature must not grow a second writer.

Today a chat holds one fact about a character's clothes: what they have on *now*
(`chats.equippedOutfit`, a JSON map `characterId → EquippedSlots`). Every change overwrites it.
Nothing remembers that she came in wearing the green dress, changed into riding clothes at
turn 40, and was handed the greatcoat at turn 112. This feature keeps that record, lets a
character (and the operator) step back to any earlier outfit, and shows the operator the whole
timeline in the Wardrobe dialog.

Implementation brief for Claude Code (Opus). Sections 2–9 are the design; §10 is the phased
order of work; §11 the acceptance tests; §12 the bookkeeping the commit skill will demand.

## 1. Settled decisions (operator, 2026-10-16)

- **One entry per announcement.** A history entry is recorded at exactly the point Aurora's
  wardrobe announcement is scheduled — not per committed slot gesture. A `wardrobe_wear` call
  with three operations, one Wardrobe-dialog **Done**, one Pascal run, or one whole model turn
  with several wardrobe edits each yield **one** entry holding the final state. Intermediate
  slot math is never recorded. (The existing per-turn collapse in `outfit-change-effects.ts` is
  the mechanism; history rides it.)
- **Per character, per chat.** Each character has their own `0..N` timeline in each chat.
  Index `0` is the outfit they arrived in: the chat's opening outfit, or the outfit a seat was
  added with mid-chat. Existing chats are seeded with a `0` from their current state by a
  migration.
- **Indices are permanent and sequential.** A new entry always takes `max + 1`. Nothing is ever
  renumbered or pruned; history lives as long as the chat.
- **Rollback moves a cursor; it does not append.** Each character has a *current index*. A
  rollback writes the target entry's slots and moves the cursor there, backwards or forwards.
  The next real change appends a new entry at `max + 1` and moves the cursor to it, whatever
  the cursor was before. So from outfit 6, `wardrobe_rollback` with no argument lands on 5; a
  second one lands on 4; then wearing a scarf creates 7 and the cursor jumps to 7.
- **A rollback is an outfit change.** Aurora announces the (now current) outfit, the per-chat
  avatar regenerates if the chat opted in, and the wear ledger credits a wear to anything
  newly put on — all through the existing effects, no special cases.
- **Stale items are skipped, not fatal.** An entry may name an item that has since been
  archived or deleted. Rollback restores everything else, leaves those off (bug 191 stays
  true: an archived item is never *put on*), and reports which were skipped. One exception,
  already the rule for the dialog: an archived item that is **currently worn in the same slot**
  stays — leaving it where it is puts nothing on.
- **Tools reach the calling character only.** `wardrobe_rollback` and `wardrobe_history`
  operate on the character running them, gated by `canDressThemselves` like `wardrobe_wear`.
  The operator reaches every character's history through the dialog.
- **Unbounded, and exported.** History is part of the chat: it rides `.qtap` exports, backups,
  and restore. Item ids that fail to resolve after an import fall under the stale-item rule.
- **GUI: a History tab, instant restore.** A third tab beside **Live outfit** / **Outfit
  Builder** for the selected character in a chat. Each entry: index, time, who changed it, a
  one-line summary, the current one marked. **Wear again** restores at once as an operator
  change — Aurora announces, as with any dialog edit.

## 2. Storage

### 2.1 Why a table, and why one table

Items are vault files, not rows (ledger spec §2), so an entry stores **item ids**, exactly the
shape `equippedOutfit` already stores: a dissolved `EquippedSlots` (leaves; a legacy row that
stored a composite whole stays whole and resolves at read time, as today). A snapshot is a few
hundred bytes; a long roleplay costs kilobytes.

The cursor lives **on the entry row** as `isCurrent`, not in a second table and not on the
chat row. A second table doubles the export/backup/restore surface for one integer; a column
on `chats` would be carried by every whole-row `update` and go stale the way the Concierge
columns did before they were made patch-only. One table, one partial unique index.

### 2.2 DDL — single source of truth

`lib/database/backends/sqlite/chat-wardrobe-history-ddl.ts`, modelled on
`wardrobe-wear-stats-ddl.ts`: exports the table name, the `CREATE` statements, and the index
statements. The migration and the backend bootstrap both spell the DDL from here; nothing
else may.

```sql
CREATE TABLE IF NOT EXISTS "chat_wardrobe_history" (
  "id"               TEXT PRIMARY KEY,
  "chatId"           TEXT NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
  "characterId"      TEXT NOT NULL,                -- no FK: characters may be archived tombstones
  "entryIndex"       INTEGER NOT NULL,             -- 0-based, per (chatId, characterId)
  "slots"            TEXT NOT NULL,                -- JSON EquippedSlots, dissolved leaves
  "slotsHash"        TEXT NOT NULL,                -- hashEquippedSlots(slots)
  "source"           TEXT NOT NULL,                -- WardrobeHistorySource (below)
  "actorCharacterId" TEXT,                         -- the character whose tool call / roll did it
  "isCurrent"        INTEGER NOT NULL DEFAULT 0,   -- the cursor
  "createdAt"        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_chat_wardrobe_history_entry"
  ON "chat_wardrobe_history" ("chatId", "characterId", "entryIndex");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_chat_wardrobe_history_current"
  ON "chat_wardrobe_history" ("chatId", "characterId") WHERE "isCurrent" = 1;
```

`slots` is plain JSON `TEXT`, like `equippedOutfit` — it is not a compressed text column and
must not become one (nothing searches it, and the rows are tiny).

Invariants, enforced by the repository and asserted by tests:

- Indices for a `(chatId, characterId)` are `0..max` with no gaps.
- Exactly one row per `(chatId, characterId)` has `isCurrent = 1` whenever any row exists.
- `slotsHash === hashEquippedSlots(JSON.parse(slots))` (`lib/wardrobe/outfit-hash.ts`).

### 2.3 Types — `lib/schemas/chat-wardrobe-history.types.ts`

```ts
export const WardrobeHistorySourceSchema = z.enum([
  'chat-start',        // applyOutfitSelections for a new chat
  'participant-added', // applyOutfitSelections for an added / reactivated seat
  'merge',             // applyOutfitSelections from a merge
  'operator',          // the Wardrobe dialog (?action=equip), or Wear again
  'character',         // a wardrobe_* tool call in a model turn (actorCharacterId = caller)
  'pascal',            // a custom tool's wardrobe effects (actorCharacterId = rolling character)
  'seeded',            // the backfill migration, or a first-touch seed (§3.4)
]);

export const ChatWardrobeHistoryRowSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  characterId: z.string().min(1),
  entryIndex: z.number().int().nonnegative(),
  slots: EquippedSlotsSchema,
  slotsHash: z.string().length(16),
  source: WardrobeHistorySourceSchema,
  actorCharacterId: z.string().nullable(),
  isCurrent: z.boolean(),
  createdAt: TimestampSchema,
});

/** Who is making an outfit change — carried on every OutfitChangeContext. */
export interface WardrobeHistoryProvenance {
  source: Exclude<WardrobeHistorySource, 'seeded'>;
  actorCharacterId?: string;
}

/** What a turn owes the ledger for one character; the last intent in a turn wins. */
export type WardrobeHistoryIntent =
  | { kind: 'append'; provenance: WardrobeHistoryProvenance }
  | { kind: 'cursor'; index: number };
```

`WardrobeHistoryProvenance` is distinct from the ledger's `EquipSource` on purpose: that one is
per commit and answers "does this credit a wear"; this one is per gesture and answers "who
changed the outfit" for a human reading the timeline. Do not merge them.

### 2.4 Repository — `ChatWardrobeHistoryRepository` (`lib/database/repositories/chat-wardrobe-history.repository.ts`)

Registered as `repos.wardrobeHistory`. Method names follow the child proxy's prefixes
(`find*` read; `upsert*` / `delete*` write) except `settle`, which gets an explicit
`METHOD_OVERRIDES` entry (§4.3).

| Method | Kind | What |
|---|---|---|
| `findEntries(chatId, characterId)` | read | All rows, ascending `entryIndex`. |
| `findCurrent(chatId, characterId)` | read | The `isCurrent` row, or null. |
| `findByChatId(chatId)` | read | Every row for a chat (export, backup). |
| `findAll()` | read | Backup. |
| `settle(chatId, characterId, intent)` | **write** | The only runtime writer. §3. |
| `upsertRows(rows)` | write | Restore and import; preserves ids and indices. |
| `deleteByCharacter(characterId)` | write | Character-delete cleanup (§7). |

The repository takes the chats store in its constructor the way `WardrobeWearRepository`
does, because `settle` must read the live slots. It is a plain class, not an
`AbstractBaseRepository` (its rows have no `updatedAt`), and declares `dbTarget = 'main'` for
the job applier's write partition.

## 3. The chokepoint: `settle`

`settle(chatId, characterId, intent)` is the one place history rows are written at runtime.
It runs **in the parent** always: called directly outside a model turn, replayed by the parent
from the job child's buffered writes inside one (§4.3). Either way it reads the real
`chats.getEquippedOutfitForCharacter` — never a snapshot the caller passes — so the entry
records what the chat actually holds at the moment the announcement is scheduled.

### 3.1 `{ kind: 'append', provenance }`

1. Load the rows. Load the live slots (`null` → empty slots).
2. **No rows yet** (§3.4): with an arrival source (`'chat-start'`, `'participant-added'`,
   `'merge'`) insert entry `0` from the live slots with that source, current, and stop — the
   arrival outfit *is* entry 0. With any other source: if the live slots are empty, insert
   entry `0` from them with source `'seeded'`, current, and stop. Otherwise insert entry `0`
   as **empty slots**, source `'seeded'`, then continue to step 4 as if the cursor were `0` —
   the prior state is unknowable but was, by construction, nothing recorded. (Corrected during
   implementation: the first draft seeded an empty `0` for arrival sources too, which
   contradicted §3.4.)
3. Compare `hashEquippedSlots(live)` with the current row's `slotsHash`. **Equal → no-op**,
   debug log. A turn whose edits net to nothing (put the hat on, take it off) records
   nothing and leaves the cursor where it was.
4. Insert entry `max + 1` from the live slots, with `provenance.source` and
   `actorCharacterId`, dated now. Clear `isCurrent` on the old current, set it on the new
   row, in one transaction.

The hash is compared against the **current** row only. The live state matching some *older*
entry still appends — "if you roll back and then equip something new on top of that, the
index gets a new one at the end." Only a true no-change is a no-op.

### 3.2 `{ kind: 'cursor', index }`

1. Find the row at `index`; a missing index is a warn-and-return (the rollback that queued
   this intent validated it, but a parent replay runs later than the child's read).
2. Clear `isCurrent` on the old current, set it on the target. One transaction.
3. Debug log both the target's `slotsHash` and the live hash. They differ when the rollback
   skipped stale items (§5.2); that drift is expected and nothing corrects it — the next
   `append` records whatever is actually worn.

### 3.3 Both kinds

- After any write in the parent, `publishRealtime('chats', chatId)` so the History tab
  refetches (§8.3). The equip commit already publishes this topic; a second hint coalesces.
- `settle` never throws to its caller: a failure is logged at `warn` with the intent, the
  outfit still changed and Aurora still announces. History is a record, not a gate.

### 3.4 Entry 0 and the backfill

Every path that dresses a character for the first time in a chat records entry `0`
explicitly: `applyOutfitSelections` (`lib/wardrobe/apply-outfit-selections.ts`) ends each
character with `settle(chatId, characterId, { kind: 'append', provenance: { source } })`
where `source` is `'chat-start'`, `'participant-added'` or `'merge'` — the same three its
callers already pass as `EquipSource`. With no rows that lands as entry `0` per §3.1 step 2
(an empty opening outfit is an outfit; "none" mode records a naked `0`).

Chats that exist before this feature get a `0` from the migration
`seed-chat-wardrobe-history-v1` (§9): one row per `(chat, character)` in each chat's
`equippedOutfit`, source `'seeded'`, current, dated by the chat's `updatedAt`. The runtime
fallback in §3.1 step 2 exists only for a character whose seat predates the migration and had
no `equippedOutfit` key at all (never dressed), which is why it seeds an **empty** `0`.

## 4. Recording: where the announcement is scheduled

### 4.1 `OutfitChangeContext` grows two fields (`lib/wardrobe/outfit-change-effects.ts`)

```ts
export interface OutfitChangeContext {
  userId: string;
  chatId: string;
  characterId: string;
  /** Who is changing the outfit. Required: no caller may forget it. */
  provenance: WardrobeHistoryProvenance;
  /** Per-turn announcement queue the orchestrator threads through the tools. */
  pendingWardrobeAnnouncements?: Set<string>;
  /** Per-turn history intents, created beside the Set. Last intent per character wins. */
  pendingWardrobeHistory?: Map<string, WardrobeHistoryIntent>;
}
```

`provenance` is **required**, so TypeScript names every call site that must decide who it
is. `WardrobeToolContext` (`lib/tools/handlers/wardrobe-handler-shared.ts`) extends it the
same way.

### 4.2 The two moments

`recordPendingWardrobeAnnouncement(context, sourceContext)` becomes:

- With a turn container: `pendingWardrobeAnnouncements.add(characterId)` and
  `pendingWardrobeHistory.set(characterId, context.historyIntent ?? { kind: 'append', provenance })`.
- Without one: `scheduleWardrobeAnnouncement(...)` **and**
  `repos.wardrobeHistory.settle(chatId, characterId, intent)` — the announcement first, then
  the entry; neither waits on the other's success.

`flushPendingWardrobeAnnouncements(context, repos?)` drains both (`repos` defaults to the
process's repositories — the child's proxy in the job child): for each character in the Set,
`settle` with that character's intent from the Map (default `{ kind: 'append', provenance }`
when the Map has none — it cannot, but the default keeps the drain total), then the
announcement. Both containers are cleared, so a second drain is a no-op, as today.

`OutfitChangeContext` gains one more optional field for the rollback path only:
`historyIntent?: WardrobeHistoryIntent`. Every ordinary caller leaves it unset and gets
`append`; `rollbackWardrobe` (§5) sets `{ kind: 'cursor', index }`.

A factory replaces the ad-hoc `new Set<string>()` at every orchestrator:

```ts
/** The per-turn wardrobe containers, created together so neither can be forgotten. */
export function newWardrobeTurnContainers(): Pick<OutfitChangeContext,
  'pendingWardrobeAnnouncements' | 'pendingWardrobeHistory'> {
  return { pendingWardrobeAnnouncements: new Set(), pendingWardrobeHistory: new Map() };
}
```

The factory and `turnContainersOf` (which threads whichever containers a context carries)
live in the pure module `lib/wardrobe/turn-containers.ts`, re-exported from
`outfit-change-effects.ts`, so call sites can thread them while tests mock the effects module.
(Corrected during implementation: the Set is created in
`lib/services/chat-message/tool-execution.service.ts` (`createToolContext`), not in the
orchestrator, which only drains it; `lib/pascal/run-service.ts` threads containers but never
creates them.) Sites converted: `tool-execution.service.ts`,
`lib/services/brahma-console/orchestrator.service.ts`,
`lib/services/brahma-console/one-shot.service.ts`. A grep-test (§11) forbids
`pendingWardrobeAnnouncements: new Set` outside the factory.

### 4.3 In the job child

A model turn in an autonomous room, and every Pascal run reached from one, executes in the
forked child. There `settle` is a buffered write: add
`'wardrobeHistory.settle': 'write'` to `METHOD_OVERRIDES` in
`lib/background-jobs/child/child-repositories-proxy.ts` with a comment in the style of the
`commitEquippedOutfit` entry — buffered whole, replayed in the parent on the RW connection
*after* the turn's `commitEquippedOutfit` replays (buffered writes replay in order within the
main partition), so the parent-side read of the live slots sees the turn's final state. The
child's return is `undefined` and every caller discards it. `findEntries` / `findCurrent` pass
through as reads and answer from the job's snapshot: a history read inside a turn does not
see an entry that same turn is about to append. Acceptable and documented in the tool's
description (§6.2).

### 4.4 Provenance at each existing call site

| Site | `provenance` |
|---|---|
| `app/api/v1/chats/[id]/actions/outfit.ts` (`?action=equip`, every mode) | `{ source: 'operator' }` |
| `lib/chat/tool-executor.ts` building `WardrobeToolContext` for the seven `wardrobe_*` tools | `{ source: 'character', actorCharacterId: context.characterId }` |
| `lib/tools/handlers/wardrobe-create-handler.ts` when `equip_now` dresses a *recipient* | `{ source: 'character', actorCharacterId: <caller> }` with `characterId` = recipient |
| `lib/pascal/wardrobe-effects.ts` | `{ source: 'pascal', actorCharacterId: <rolling character>, toolName: <custom tool name> }` |
| `lib/tools/handlers/run-custom-handler.ts` (a Pascal run inside a model turn) | passes the turn's containers through; the effects applier supplies `'pascal'` |
| `applyOutfitSelections` callers (`app/api/v1/chats/route.ts`, `.../actions/participants.ts`, merge) | not via `notifyWardrobeChanged` — they call `settle` directly with `'chat-start'` / `'participant-added'` / `'merge'` (§3.4) |

`refreshAvatarForOutfit` (chat open, seat join) is untouched: it is an avatar refresh, not an
outfit change.

## 5. Rollback: `rollbackWardrobe` (`lib/wardrobe/history/rollback.ts`)

The one rollback implementation; the tool handler and the `?action=wardrobe-rollback` route
are both thin callers. Server-only.

```ts
export interface RollbackInput {
  chatId: string;
  pool: WearablePool;                 // the caller's pool: loadToolPool or loadWearablePool(..., { operator: true })
  index?: number;                     // absolute; default = current - 1
  context: OutfitChangeContext;       // provenance + the turn containers, if any
  source: 'ui' | 'tool';              // the ledger's EquipSource for the commit
}

export interface RollbackOutcome {
  ok: true;
  previousIndex: number;
  restoredIndex: number;
  slots: EquippedSlots;               // what was actually written (stale items removed)
  skipped: Array<{ itemId: string; title: string | null; reason: 'archived' | 'missing' }>;
} | { ok: false; reason: 'no_history' | 'at_first' | 'out_of_range' | 'already_current'; message: string };
```

### 5.1 Resolve the target

1. `findEntries`; none → `no_history` ("No outfit history yet for <name> in this chat").
2. `current = findCurrent`; with `index` unset, target `current.entryIndex - 1`; at `0` →
   `at_first` ("<name> is already in the first outfit of this chat (0); there is nothing
   earlier to return to").
3. `index` outside `0..max` → `out_of_range`, naming the range. `index === current` →
   `already_current`. Forward (`index > current`) is simply allowed.

### 5.2 Filter stale items

For each slot of the target's `slots`, keep an id iff it resolves in `pool.byId` and is not
archived — **or** is archived but present in the *current live* slots for the same slot
(leaving it on is not putting it on). Everything dropped goes in `skipped` with the pool's
title when the item still exists (`'archived'`) or `null` (`'missing'`). Log each at `info`.

### 5.3 Commit, once

One `repos.wardrobeWear.commitEquippedOutfit({ chatId, characterId, nextSlots: filtered,
wornBundles: [], source })` — the `set_all` shape. Entries store dissolved leaves, so there is
no bundle to credit; a legacy whole-composite id is written back whole and resolves at read
time as it does today. The ledger credits every leaf that goes from not-worn to worn, exactly
as the operator re-dressing the character by hand would.

### 5.4 Effects

`notifyWardrobeChanged(repos, { ...context, historyIntent: { kind: 'cursor', index } }, sourceContext)`.
That is the avatar refresh, Aurora's announcement, and — through §4.2 — the cursor move
instead of an append. Nothing else. A rollback that then wears a scarf in the same turn
replaces the cursor intent with an append (last wins), and the scarf outfit becomes
`max + 1`: the intermediate return to `N` is, correctly, never recorded as a separate entry.

## 6. Tools

Both are gated by `canDressThemselves`, alongside `wardrobe_wear` and `wardrobe_take_off`.
Both follow the tool-definition rule in CLAUDE.md: Zod input schema is the single source of
truth, `parameters` derived via `zodToOpenAISchema`, `validateXxxInput` a one-line
`safeParse` delegate.

### 6.1 `wardrobe_rollback` (`lib/tools/wardrobe-rollback-tool.ts`, handler `handlers/wardrobe-rollback-handler.ts`)

Input:

```ts
z.object({
  index: z.number().int().nonnegative()
    .describe('The outfit to return to, by its number in wardrobe_history. Omit to step back ' +
      'one outfit from the current one. Any recorded number is allowed, earlier or later than ' +
      'the current one.')
    .optional(),
})
```

Output (`WardrobeRollbackToolOutput`):

```ts
{
  success: boolean;
  previous_index?: number;
  restored_index?: number;
  current_state?: EquippedSlots;
  coverage_summary?: string;          // buildWardrobeCoverageSummaryFromState, as the other mutations
  skipped?: Array<{ item_id: string; title: string | null; reason: 'archived' | 'missing' }>;
  error?: string;
}
```

`formatWardrobeRollbackResults` renders for the conversation: "Returned to outfit 4 (from 6).
Now wearing: …" plus one line per skipped item ("the Greatcoat could not be put back on: it
has been archived"). The handler is `loadToolPool` → `rollbackWardrobe` → the shared
`current_state` / `coverage_summary` assembly from `wardrobe-handler-shared.ts`. On
`ok: false` the handler returns `buildWardrobeMutationFailure(message)`.

Description (for the model): "Return to an outfit you wore earlier in this chat. Every outfit
change is numbered from 0 (what you arrived in); wardrobe_history lists them. With no index
this steps back one. Rolling back is itself a change of clothes: it is announced, and the
next thing you put on becomes a new numbered outfit at the end of the list."

### 6.2 `wardrobe_history` (`lib/tools/wardrobe-history-tool.ts`, handler `handlers/wardrobe-history-handler.ts`)

Input:

```ts
z.object({
  limit: z.number().int().positive().max(100)
    .describe('How many of the most recent outfits to list. Default 20.')
    .optional(),
})
```

Output: `{ success, current_index, total, entries: Array<{ index, at, source, changed_by,
is_current, summary }>, error? }`. `entries` is ascending by index and holds the **last
`limit`** entries (always including the current one, even if older than the window: when the
cursor is outside the window the current entry is prepended with a gap note). `summary` is
`describeOutfit(resolveEquippedOutfitForCharacter(pool, entry.slots).outfitValues)` collapsed
to one line; stale items render by id with "(archived)" / "(no longer exists)". `changed_by`
is a label: "you" when `actorCharacterId === characterId`, the actor's name
(`characters.findByIdRaw`, raw as in `speaker-names.ts`) otherwise, "the operator",
"Pascal", "chat opened", "joined the chat", "merged", "before history was kept". The
description tells the model that a change made earlier in the *same* reply may not appear yet
(§4.3).

Read-only; the handler fires no effects and touches no containers.

### 6.3 Registration — every site that lists `wardrobe_take_off` (grep it; the list today)

`lib/tools/index.ts` · `lib/tools/plugin-tool-builder.ts` (new `wardrobeRollback` /
`wardrobeHistory` options, gated with `wardrobeWear`) · `lib/tools/handlers/wardrobe-tool-table.ts`
(two new rows) · `lib/chat/tool-executor.ts` (the wardrobe-tool name list; the table does the
dispatch) · `app/api/v1/tools/route.ts` · `lib/tools/simple-json-prompt.ts` ·
`lib/tools/simple-json-parser.ts` (aliases `rollback_outfit`, `undo_outfit` →
`wardrobe_rollback`; `outfit_history` → `wardrobe_history`) · `lib/tools/legacy/text-block-prompt.ts`
and `text-block-parser.ts` · `lib/services/chat-message/streaming.service.ts` (the
`canDressThemselves` comment and option plumbing) · `lib/services/brahma-console/orchestrator.service.ts`
and `lib/services/scenario-builder/scenario-builder.service.ts` (both set every wardrobe
option to `false` by name; add `wardrobeRollback: false` and `wardrobeHistory: false` — neither
surface has a chat, and neither may get these tools) · `components/chat/ToolMessage.tsx`
(summary line for a successful rollback: "Returned to outfit N.") ·
`lib/tools/__tests__/tool-definitions-snapshot.test.ts` (register both; `npx jest -u` on it) ·
`plugins/dist/qtap-plugin-google/provider.ts` — check whether its bug-125 schema flattening
is keyed by tool name; these two schemas are flat and need nothing, but confirm. The nine
`wardrobe_*` tools stay one table and one context ("the seven" in comments becomes "the nine").

## 7. Lifecycle hygiene

- **Chat deleted:** `ON DELETE CASCADE`. Verify the chat-delete path runs with foreign keys
  on (it does for `chat_informs`); add an assertion to the chats repository delete test that
  the chat's history rows are gone afterwards.
- **Character deleted:** `wardrobeHistory.deleteByCharacter(characterId)` beside the call to
  `wardrobeWear.foldWearerIntoUnattributed` in `lib/cascade-delete.ts`. A departed
  character's timeline has no reader.
- **Character archived / rehydrated:** untouched. The seat is gone from the chat but the chat
  still exists; rehydrate restores the seat and its history is still there.
- **Item deleted:** `chats.removeEquippedItemFromAllChats` scrubs the *live* state as today;
  history rows keep the id and the stale-item rule handles it at rollback and render time.
  Never scrub history.
- **Item archived:** nothing; §5.2.
- **Chat merged:** the merge's `applyOutfitSelections` records a `'merge'` entry on the
  surviving chat for each character (§3.4). The absorbed chat's rows go with it (cascade).
- **Seat removed and re-added:** `'participant-added'` appends `max + 1` on the same
  timeline (the character's rows for the chat persist across the seat). Index numbers never
  restart.

## 8. API and client

### 8.1 Routes (in `app/api/v1/chats/[id]/actions/outfit.ts`, dispatched beside `outfit` / `equip`)

- `GET /api/v1/chats/[id]?action=wardrobe-history&characterId=…` →
  `{ currentIndex, entries: Array<{ index, at, source, actorCharacterId, actorName, isCurrent,
  summary, slots: Record<WardrobeItemType, Array<{ itemId, title, archived, missing }>> }> }`.
  Resolution goes through the character's pool (`loadWearablePool(..., { chatId, operator: true })`,
  archived included — the pool already holds them) and `resolveEquippedOutfitForCharacter`;
  an id absent from the pool renders `{ itemId, title: null, missing: true }`.
- `POST /api/v1/chats/[id]?action=wardrobe-rollback`, body `{ characterId, index }` (index
  required here — the dialog always picks one) → `{ equippedSlots, previousIndex,
  restoredIndex, skipped }`; `ok: false` reasons map to `badRequest` with the message. Calls
  `rollbackWardrobe` with `provenance: { source: 'operator' }`, `source: 'ui'`, no turn
  containers.

Document both in `docs/developer/API.md`.

### 8.2 Query keys (`lib/query/keys.ts`)

```ts
wardrobe: {
  …
  /** Prefix of every history read for a chat — the `chats` realtime topic refetches it. */
  histories: (chatId: string) => ['wardrobe', 'history', chatId] as const,
  /** One character's outfit timeline in a chat (`?action=wardrobe-history`). */
  history: (chatId: string, characterId: string) => ['wardrobe', 'history', chatId, characterId] as const,
}
```

### 8.3 Realtime (`lib/realtime/topic-map.ts`)

Add `queryKeys.wardrobe.histories(id)` to the `chats` topic's row beside
`queryKeys.wardrobe.outfit(id)`, with the same reasoning: a tool call or a parent-side replay
changes the timeline under an open dialog. No new topic, no polling. The History tab reads
with `useQuery` and the ordinary stale-time; `wardrobe.all` invalidation after a dialog commit
or a rollback mutation already covers the operator's own edits.

### 8.4 The History tab (`components/wardrobe/outfit-history-tab.tsx`)

- `type RightTab = 'live' | 'builder' | 'history'` in `wardrobe-control-dialog.tsx`; the tab
  button renders only `isInChat && selectedCharacterId`, after **Outfit Builder**, labelled
  **History**. Its hint line: "Every change of clothes in this chat, numbered from the outfit
  they arrived in. Wear again returns to one — Aurora will say so."
- The list, newest first: an index badge (`#6`), a relative time with the absolute one in the
  title, the `changed_by` label, the one-line summary, and an `OutfitSlotsPreview` of the
  resolved slots (stale items greyed with an "archived" / "gone" tag). The current entry
  carries a **Wearing now** badge and no button.
- **Wear again** → `useMutation` posting `?action=wardrobe-rollback`; on success invalidate
  `queryKeys.wardrobe.all`, toast "Back in outfit N" (plus "N items could not be put back on"
  when `skipped` is non-empty, listing titles in the toast body). The button's title warns
  ahead of time when the entry has stale items: "2 items in this outfit are no longer
  available and will be left off."
- If the Live tab holds **unsaved staged edits for this character** (`useStagedLiveOutfits`
  reports the character dirty), confirm first via the dialog's existing `requestConfirmation`:
  "Discard the staged changes to <name>'s outfit and return to outfit N?" — a yes discards
  the staged gestures for that character (`rebaseStagedGestures` to the fresh snapshot after
  the mutation settles) before the rollback. The staged outfit must never be flushed *over* a
  rollback on Done.
- Empty state (no rows — a pre-migration seat never dressed): "No outfits recorded yet. The
  first change of clothes starts the record."
- `qt-*` classes only; any new utility goes through the three-way mirror rule in CLAUDE.md
  (app CSS, `theme-storybook`, bump and publish). Prefer existing `qt-badge`, `qt-tab`,
  `qt-button-*` and the row classes `wardrobe-item-row.tsx` already uses, so no mirror is
  needed.

## 9. Migrations (`migrations/scripts/`, both in `index.ts`, both labelled in `lib/startup/prettify.ts`)

1. `add-chat-wardrobe-history-table-v1` — the DDL from `chat-wardrobe-history-ddl.ts`.
   Label: "Binding a ledger of every change of clothes".
2. `seed-chat-wardrobe-history-v1` — `dependsOn` the first; for every chat with a non-null
   `equippedOutfit`, for every `(characterId, slots)` in it (`normalizeEquippedSlots`, as
   `seed-wardrobe-wear-stats-v1` does): one row, `entryIndex 0`, `isCurrent 1`, source
   `'seeded'`, `actorCharacterId NULL`, `createdAt = chat.updatedAt`, hash computed. Skips a
   pair that already has rows (safe to re-run in effect). `reportProgress(i + 1, chats.length,
   'chats')` every iteration. Label: "Noting down what everyone has on at the moment".

A fresh instance gets the table from migration 1, exactly as `wardrobe_wear_stats` does — there
is no separate backend bootstrap to touch. `docs/developer/DDL.md` gets the table and both
indices; the `lib/database/backends/sqlite/` column-drift helpers get nothing (no later
`ALTER`s are planned).

## 10. Export, import, backup, restore

The pattern is `wardrobe_wear` / `chat_informs`; follow it file for file.

- **`.qtap` export:** `lib/export/types.ts` — counts field `wardrobeHistory`, record kind
  `'wardrobe_history'` with `data: ChatWardrobeHistoryRow`, the chat payload field;
  `lib/export/ndjson-writer.ts` yields `wardrobeHistory.findByChatId(id)` for every exported
  chat beside the informs; `public/schemas/qtap-export.schema.json` gets the record.
- **`.qtap` import:** `lib/import/quilltap-import-stream.ts` collects the kind;
  `quilltap-import/reconcile.ts` remaps `chatId`, `characterId`, `actorCharacterId` and mints
  new `id`s (indices and `isCurrent` are copied verbatim); `execute.ts` inserts with
  `upsertRows`. A chat imported without history rows (an older bundle) gets its `0` from the
  §3.1 runtime seed on first change — not from a special import path.
- **Backup:** `lib/backup/types.ts` (count + array), `backup-service.ts` (`findAll`, write
  `data/wardrobe-history.json`), `restore/uuid-remap.ts` (the three id fields),
  `restore/restore.ts` (`upsertRows`, counted), `restore/preview.ts`, `restore/delete-service.ts`
  annotations, `restore/archive.ts`.
- Invariants (§2.2) hold after restore because rows round-trip whole. A bundle hand-edited to
  two current rows fails the partial unique index on insert; `upsertRows` logs and skips the
  offender rather than failing the restore.

## 11. Order of work

Each phase ends green on `npx tsc`, `npm run lint`, and the suites it touches.

1. **Storage.** Types, DDL module, repository, both migrations, DDL.md, bootstrap, child-proxy
   override, `deleteByCharacter` wired into character delete. Unit tests for `settle` (§12).
2. **Recording.** `OutfitChangeContext.provenance` (required) and the containers factory;
   convert every call site in §4.4 and every orchestrator in §4.2; `applyOutfitSelections`
   records entry `0`. Grep-test for the factory. At the end of this phase a chat's timeline
   fills up from every existing path with no new UI.
3. **Rollback core and tools.** `rollbackWardrobe`, both tool definitions and handlers,
   every registration site in §6.3, snapshot test updated.
4. **API and dialog.** The two actions, query keys, topic map, the History tab.
5. **Export / backup.** §10, with the round-trip tests.
6. **Docs.** §13.

## 12. Tests

- `lib/database/repositories/__tests__/chat-wardrobe-history.repository.test.ts` (real
  SQLite driver by absolute root path — see the Jest notes in memory): seeds; `append` on
  empty history with empty vs non-empty live state (§3.1 step 2); `append` no-op on equal
  hash; `append` after a rollback lands at `max + 1` and moves the cursor; `cursor` moves
  without appending; exactly one current row at all times; indices contiguous.
- `lib/wardrobe/__tests__/rollback.test.ts`: default index; `at_first`; `out_of_range`;
  `already_current`; forward roll; archived item skipped unless currently worn in that slot;
  missing item skipped; one `commitEquippedOutfit` call with `wornBundles: []`; the
  `historyIntent` handed to `notifyWardrobeChanged` is `{ kind: 'cursor', index }`.
- `lib/wardrobe/__tests__/outfit-change-effects.test.ts`: immediate path calls `settle`;
  turn path defers; flush drains both containers; last intent per character wins; drain is
  idempotent.
- Grep-tests: no `pendingWardrobeAnnouncements: new Set` outside the factory; no
  `chat_wardrobe_history` DDL outside the DDL module; no runtime writer but `settle`
  (`upsertRows` allowed only in restore / import).
- Tool tests: schema snapshot; handler happy path and each refusal; `wardrobe_history`
  windowing with the cursor outside the window.
- Export/backup round trip: a chat with a five-entry timeline, cursor at 2, exports and
  re-imports with the same indices, hash and cursor under remapped ids.
- Migration tests for both scripts (table created; seed produces one current `0` per pair,
  skips pairs that have rows, reports progress).

## 13. Docs and bookkeeping

- `docs/CHANGELOG.md` under the current dev version, plain voice: the table, the two tools,
  the two actions, the History tab, the migrations.
- `help/wardrobe.md`: a new section "Looking back — the outfit record" after the wear-ledger
  section, in the house voice: what is recorded and when, that numbers never change, how
  rollback moves "the bookmark", that Aurora announces a return, that archived or vanished
  garments are left off and named, and the History tab with **Wear again**. Add
  `wardrobe_rollback` and `wardrobe_history` to the tool list and to the
  `canDressThemselves` line. The file's `url` and `help_navigate` stay `/aurora`.
- `docs/developer/API.md`: the two actions. `docs/developer/DDL.md`: the table.
- `docs/developer/BACKGROUND_JOBS_CHILD.md`: one line for the `settle` override next to the
  equipped-outfit overlay paragraph.
- `.claude/commands/update-documentation.md` if a new doc is added (none planned).
- CLAUDE.md "Code-path chokepoints", one bullet: history is written only by
  `wardrobeHistory.settle`, reached through `notifyWardrobeChanged` / the flush, and rollback
  is only `rollbackWardrobe`.
- Move this file to `docs/developer/features/complete/` with a **Status** line when done. (Done.)

## 14. Out of scope, deliberately

- A Pascal `rollback` effect for custom tools. The applier doctrine ("no new writer") makes
  it a ten-line follow-up once `rollbackWardrobe` exists; not in this change.
- Rolling back *everyone* at once, or a chat-wide timeline. Per-character was the decision.
- An Aurora announcement that says "returns to an earlier outfit" rather than describing the
  outfit. The announcement job reads the current state and does not need to know why.
- Pruning, caps, or a retention setting. Unbounded was the decision.
- Anchoring an entry to the message it happened around. Worth adding later as a nullable
  `messageId` for the History tab's timeline; nothing here would have to change.

## 15. Gotchas

- **Never pass the slots to `settle`.** The entry must record what the chat holds when the
  announcement is scheduled, read in the parent. A caller-supplied snapshot from the child is
  the stale-baseline bug (179) in a new coat.
- **`provenance` is required for a reason.** The ledger's value is "who did it". A default
  would let the next call site record "operator" for a tool call.
- **Do not dedupe against older entries.** Equal hash to the *current* row is the only no-op.
- **Do not append on rollback.** The cursor intent exists so that `notifyWardrobeChanged` can
  stay the single effects door without a rollback minting a duplicate entry — or, worse, a
  partial-restore entry that was never worn as recorded.
- **Archived-but-worn stays.** §5.2's exception is the dialog's existing rule; dropping it
  would make a rollback undress a character whose coat was archived while on their back.
- **The History tab must not share the Live tab's staged state.** Stage → rollback → Done
  would flush the stale stage over the rollback. Confirm, discard, then roll.
- **Spelling.** The project is Quilltap. The lint sweep reads this file too.

## 16. As built

Implemented on main in six commits (storage, recording, rollback and tools, API and dialog,
export/backup, docs). Where the code and this brief disagreed, the code won and the text above
was corrected in the same commit; the differences worth knowing:

- **Arrival entries (§3.1 step 2).** `chat-start`, `participant-added` and `merge` with no rows
  record the arrival outfit itself as entry `0` with their own source; the empty seeded `0`
  happens only for other sources on a seat that predates the history.
- **Repository shape (§2.4).** `ChatWardrobeHistoryRepository` is a plain class (its rows have
  no `updatedAt`, so it is not an `AbstractBaseRepository`) and declares `dbTarget = 'main'` for
  the job applier's write partition. `settle` returns a `SettleOutcome` for logs and tests;
  callers discard it.
- **Turn containers (§4.2).** `newWardrobeTurnContainers()` and `turnContainersOf()` live in the
  pure module `lib/wardrobe/turn-containers.ts`, re-exported from `outfit-change-effects.ts`.
  The Set was created in `createToolContext` (`tool-execution.service.ts`), not in the chat
  orchestrator. `flushPendingWardrobeAnnouncements(context, repos?)` settles before it
  announces. A turn Set that arrives without its Map settles at once rather than lose the entry.
- **Rendering (§6.2, §8.1).** `lib/wardrobe/history/describe-entry.ts` holds the shared
  rendering: `resolveHistorySlots`, `summarizeHistorySlots` (plain text — `describeOutfit`'s
  Markdown list flattened to one line), `staleItemsOf`, `changedByLabel`. The GET action also
  returns a `changedBy` label (the character's own changes are labelled with their name there,
  "you" in the tool).
- **History tab (§8.4).** Stale garments use the existing `qt-badge-secondary` with an
  "· archived" / "· gone" suffix; no new `qt-*` utility. `useStagedLiveOutfits` gained
  `isDirty(characterId)` and `discard(characterId, { reseed? })`: the tab discards the staging
  before the rollback and re-seeds the Live tab after the refetch settles.
- **Import (§10).** `lib/import/quilltap-import/import-wardrobe-history.ts` (step 7f, after the
  wear ledger) also remaps slot item ids that imported with new ids, and never merges into a
  timeline already live on the instance. Backup restore remaps slot ids through the same item
  remap as the wear ledger, and replace mode clears the table first.
- **Not done, deliberately:** the chats-repository delete test the brief mentions (§7) is
  covered instead by the repository test's cascade case on a real SQLite connection.

Verified live on 2026-10-16: both migrations on a copy of the V4test instance seeded 32 current
entry-0 rows for its 32 (chat, character) pairs, each dated by its chat's `updatedAt`; on V4test
itself a `wardrobe_wear` call appended entry 1 (source `character`), `wardrobe_history` listed it,
`wardrobe_rollback` returned to 0 with Aurora announcing and no new entry, and the History tab's
**Wear again** moved the cursor back to 1, announced.

### Addendum (2026-10-17): who dressed them

- **Operator entries name the user's live character.** `operatorWardrobeProvenance(chat)`
  (`lib/wardrobe/history/operator-provenance.ts`) resolves the seat the user is speaking as —
  `findActiveUserParticipant` over `activeTypingParticipantId`, impersonation included, falling
  back to the first user-owned seat — and records its character in `actorCharacterId`. Both
  operator paths (`?action=equip`, `?action=wardrobe-rollback`) call it; a chat with no
  user-driven character records `{ source: 'operator' }` alone.
- **Pascal entries name the custom tool.** New nullable column `actorToolName`, written only for
  `source = 'pascal'` (`settle` drops a `toolName` on any other source). Provenance gains
  `toolName`; `applyWardrobeEffects` passes the run's tool name. Migration
  `add-chat-wardrobe-history-tool-name-v1` adds the column to an existing table; the shared DDL
  carries it last so fresh and migrated tables match, and the seed migration now depends on it
  (the shared INSERT spells it).
- **Labels.** `changedByLabel`: "the operator, as Bertie" (or "the operator" when no character
  was recorded), "Pascal's dress_for_dinner", "Pascal's dress_for_dinner (rolled by Jeeves)".
  The GET action returns `actorToolName` beside `actorName`.
- **Export / backup.** `actorToolName` rides in `wardrobe_history` records and
  `data/wardrobe-history.json` unchanged; the row schema defaults it to null, so older bundles
  and backups still import.
