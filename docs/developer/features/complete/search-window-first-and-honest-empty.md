# Feature: Window-first search and honest empty results

**Status:** Implemented (4.12.1, 2026-11-04).

Implementation notes, where the code departs from or adds to the text below:

- `isNarrowToolWindow` (`lib/memory/recall/score.ts`) is the one test of "at most `TOOL_WINDOW_FLOOR_MAX_DAYS` wide"; the handler's conversation floor reads it too.
- `searchConversationChunks` used `options.minScore || 0.3`, which turned an explicit 0 into 0.3; it is now `?? 0.3`.
- Each census conversation also carries `date`, the local calendar date (memory calendar) it began on, which the formatter prints.
- The census's memory count is its own `findIdsInEventWindow` read; `gather`'s read is inside `searchMemories` and is not shared.
- On the Brahma Console the empty-window and footer wording drop the "you took part in" and memory clauses (`memoryCount: null`).
- The character-kind work landed without touching `lib/tools/`, so the instruction sentence went in directly.

Two changes to how a character finds a dated past:

1. **Window-first.** When a search or a turn names a period, the rows from that period are brought into the candidate pool *before* anything is cut, instead of being filtered out of a pool already chosen from all time.
2. **Honest empty results.** A search that comes back empty says whether that means "nothing matched your words" or "nothing happened then", and names the conversations from that period so the character can go and read them.

## Why — the case that prompted it

Friday instance, chat `76cb8dc8-0690-461a-94fb-a73e21412fbc`, 2026-11-04 14:13 UTC. The operator asked Friday (Opus 5.5) *"Do you remember what happened in the pool yesterday?"* She made two reasonable `search` calls:

| # | Arguments | Returned |
|---|---|---|
| 1 | `query: "pool yesterday"`, `since: "2026-11-02"`, `sources: ["memories","conversations"]` | **0 results**, text `No relevant results found.` |
| 2 | `query: "East Pool November 3"`, `since: "2026-10-30"` (no `sources`) | 10 documents (scenario files, an Obsidian scratch pad, a June summary). `since` does not apply to documents. |

She answered, *"there's nothing from the pool after the second. No memory, no conversation, no note."* That was false, and the answer has since been stored as a memory of its own ("found a gap in my record").

What existed:

- Chat **"No Quarter at the East Pool"** (`057d2128-af40-4382-9e1e-873d5f1deba9`), 2026-11-03 22:40–23:20 UTC, 27 conversation chunks, all embedded.
- **30 of Friday's memories** from that chat, including *"On the evening of 2026-11-03, Lyle Hoelscher came through the Sebold Lodge and out the French doors onto the pool deck with his Glock drawn…"*
- No vault conversation summary for that chat (it was never folded), so the per-turn "Relevant Past Conversations" lane could not list it.

### Root cause: the window is applied after the cut

Every path ranks by similarity first and applies the date window afterwards:

| Path | Where the cut happens | Where the window applies |
|---|---|---|
| Tool, memories | `gather` takes the index's top `limit × 3` (30) by cosine across the whole corpus (`lib/memory/recall/gather.ts:149`) | `score` filters that pool (`lib/memory/recall/score.ts:84`) |
| Tool, conversations | `searchConversationChunks` keeps the top `limit` (10) chunks across all the character's chats (`lib/scriptorium/conversation-search.ts:116`) | the handler drops chats outside the window (`search-scriptorium-handler.ts`, "Time filter") |
| Per-turn recall, memories | same `gather` | `score` hard/soft staging over the same pool |
| Per-turn recall, conversations | vault summary files only, by cosine (`lib/memory/recall/conversations.ts`) | a filter over the summaries already read |

Measured on Friday:

- `memories grep --semantic "pool yesterday"`: the top 30 are pool memories from September and October. None is from Nov 3. The window then empties the pool.
- `recall-replay --turn 1`: the query builder resolved "yesterday" correctly (`window 2026-11-03T06:00Z → 2026-11-04T05:59Z`, retrospective on). The gathered pool of 165 held almost nothing from Nov 3, so the window went `soft` and the head was filled with older memories about memory.
- Cosine of the Nov 3 memories against "pool yesterday" is **0.28–0.34**. The provider floor is 0.3. Those memories are about Lyle, the Gnomon and the Duchy, not about "pool". So even with the right rows in the pool, the floor would drop about half of them.

The more a place or topic recurs, the worse this gets. A dated question about the pool competes with months of pool memories and loses.

### Root cause of the wrong answer: "no match" reads as "no record"

`formatSearchScriptoriumResults([])` returns `No relevant results found.` Both tool-instruction blocks then say *"If you find nothing, say you don't recall"* (`lib/tools/native-tool-prompt.ts:34`, `lib/tools/simple-json-prompt.ts:266`). That instruction is right — it stops invented particulars — but it is only safe if "nothing" really means nothing. Today it means "nothing ranked high enough".

## Decisions

| Question | Decision |
|---|---|
| How are in-window rows found? | By event time in SQL (`COALESCE(occurredAt, createdAt)`), then scored by the same vector index restricted to those ids. Never by loading rows into JS to filter. |
| Does this change ranking when no window is set? | **No.** Every change below is gated on a window being present. A search without `since`/`until`, and a turn with no resolved `timeRange`, must produce byte-identical results. |
| Relevance floor inside an explicit tool window | Dropped to 0 for in-window rows when the window is **at most 14 days** wide. The caller named the period; the window is the filter. Wider windows keep the normal floor so "since 2025" stays topical. |
| Relevance floor on the per-turn (prompt) path | **Unchanged.** Window rows join the pool and face the floor like any other row (R5, bug 202). Prompt recall is unbidden and must stay conservative. |
| Default `sources` when a window is set | When `since`/`until` is given and `sources` is omitted, the default becomes `["memories","conversations"]`. Documents have no dates and would otherwise crowd dated hits out of the cross-source cut. An explicit `sources` is honoured as given. |
| How is a chat's time span measured? | `[createdAt, lastMessageAt ?? updatedAt ?? createdAt]`, one helper. Not `updatedAt` alone: a retitle or maintenance write bumps it. |
| What does the census count? | Memories in the window (all tiers, since the tool sees the archive) and the conversations the character took part in during it. It ignores `aboutCharacter` and the query text. |
| Unsummarized chats in per-turn recall | The retrospective mini-recap lists in-window chats from the `chats` table even when no vault summary exists. The ordinary per-turn list (summary search) is unchanged. |
| Schema, migrations, exports | None. No new column, table or index; no `.qtap` or backup change. |

## Design

### 1. Shared helpers

**`lib/scriptorium/chat-window.ts`** (new). One place for "which chats fall in this window":

```ts
export interface ChatSpan { start: number; end: number }

/** [createdAt, lastMessageAt ?? updatedAt ?? createdAt] in ms; null when createdAt is unparseable. */
export function chatSpanOf(chat: Pick<ChatMetadata, 'createdAt' | 'updatedAt' | 'lastMessageAt'>): ChatSpan | null

/** True when the chat's span overlaps [from, to] (ISO strings). */
export function chatOverlapsWindow(chat: …, window: { from: string; to: string }): boolean

/**
 * The chats a character (or, with no characterId, the user — the operator
 * surface) took part in whose span overlaps the window, newest first.
 * Reads repos.chats.findByCharacterId / findByUserId once.
 */
export async function findChatsInWindow(opts: {
  characterId?: string
  userId: string
  window: { from: string; to: string }
  excludeChatId?: string
}): Promise<ChatMetadata[]>
```

Debug-log the window, the candidate chat count and the in-window count.

**`MemoriesRepository.findIdsInEventWindow`** (new, `lib/database/repositories/memories.repository.ts`), beside `countUnconsideredHot`, using `rawQuery`:

```sql
SELECT id FROM memories
 WHERE characterId = ?
   AND COALESCE(occurredAt, createdAt) >= ?
   AND COALESCE(occurredAt, createdAt) <= ?
   [AND COALESCE(tier, 'hot') = 'hot']   -- when hotOnly
```

Signature: `findIdsInEventWindow(characterId, window: { from: string; to: string }, opts: { hotOnly: boolean }): Promise<string[]>`, wrapped in `safeQuery` with `[]` as the fallback. Timestamps are ISO-8601 `Z` strings, so lexical comparison is correct. The `characterId` index narrows the scan; no new index is needed. This is the same event-time rule `score.ts` already applies (`occurredAt ?? createdAt`), now in SQL — say so in the JSDoc and keep the two in step.

**`MemoryIndexSearchOptions.includeIds`** (`lib/memory/index-store/memory-index.ts`): an optional `ReadonlySet<string>`. When present, the filter callback also requires `includeIds.has(metadata.memoryId)`. It composes with `hotOnly` and `exclude`. The vector store scan is already brute force over the character's vectors, so this costs nothing extra. Reads only; the index-store chokepoint rules are untouched.

### 2. Memories: window-first gather

`lib/memory/recall/gather.ts`, vector strategy, after the main index search and the probes and before the literal/anchor step:

```ts
let windowAdded = 0
if (query.window) {
  const ids = await repos.memories.findIdsInEventWindow(characterId, query.window, { hotOnly: !includeCold })
  const inWindow = new Set(ids.filter(id => !excluded?.has(id)))
  if (inWindow.size > 0) {
    const windowHits = await memoryIndex.search(characterId, embedding.embedding, {
      hotOnly: !includeCold, exclude: excluded, limit: opts.limit * 3, includeIds: inWindow,
    })
    // union: a row keeps its best score; new ids enter with via 'window'
  }
}
```

- Add `'window'` to `HitSource` (`lib/memory/recall/types.ts`).
- Add `window: ids.length, windowAdded` to the `gather` trace stage, so `recall-replay` shows it.
- Rows with no embedding cannot be scored here; they are left to the text strategy as today.

**Text strategy** (`gatherText`): when `query.window` is set, read the in-window rows (`findByIds` on the ids from `findIdsInEventWindow`, capped at `opts.limit * 3`, newest first) and add them to the pool with their text-match score, which may be 0.

**Score** (`lib/memory/recall/score.ts`): the floor gains one exemption, for the tool path only.

```ts
/** An explicit tool window at most this wide is its own relevance filter. */
export const TOOL_WINDOW_FLOOR_MAX_DAYS = 14

const relaxFloor = !opts.recallContext && window && (window.to - window.from) <= TOOL_WINDOW_FLOOR_MAX_DAYS * DAY_MS
const passesFloor = (h) => relaxFloor && inWindow(h)
  ? true
  : gathered.strategy === 'text' ? h.score > 0 : h.score >= gathered.minScore
```

`inWindow` must be hoisted above the floor so both steps use the same predicate. Ranking is unchanged (`rankByBlend` on the tool path); the floor exemption only decides who is eligible. Record `floorRelaxed: true` in the `score` trace stage.

The prompt path is unchanged in `score.ts`. It benefits only from the better pool: with the day's rows present, the hard window fires when at least `limit` of them clear the floor, and the soft ×`occurredWithinWindow` boost has real in-window rows to lift otherwise.

### 3. Conversations (tool): window-first chunk search

`lib/scriptorium/conversation-search.ts`, `ConversationSearchOptions` gains:

```ts
/** Restrict to these chats before scoring. Set by a caller with a time window. */
chatIds?: ReadonlySet<string>
```

When set, intersect it with the character's chat set before loading chunks. Nothing else changes in the function.

`search-scriptorium-handler.ts`, conversations branch, when `timeWindow` is set:

1. `findChatsInWindow({ characterId, userId, window: timeWindow })` (operator surface: no `characterId`, scoped by `userId`, as today).
2. Pass their ids as `chatIds`. If there are none, skip the chunk search.
3. Pass `minScore: 0` when the window is at most `TOOL_WINDOW_FLOOR_MAX_DAYS` wide; otherwise keep 0.3.
4. **Delete the post-filter block** ("Time filter: keep conversations whose lifespan overlaps…") and its per-hit `repos.chats.findById` calls. The pre-filter replaces it.

### 4. Tool handler: sources default and the census

`executeSearchScriptoriumTool`:

- **Default sources.** `const sources = parsed.sources ?? (since || until ? ['memories', 'conversations'] : ALL_SOURCES)`. The operator and Scenario Builder variants keep their own defaults: the Scenario Builder has no window, and the Brahma variant becomes `['conversations']` when a window is given.
- **Context.** `SearchScriptoriumToolContext` gains `chatId?: string`; `lib/chat/tool-executor.ts` passes `context.chatId`. It is used only to leave the current chat out of the census.
- **Census.** When `timeWindow` is set and memories or conversations are being searched, build:

```ts
export interface SearchWindowCensus {
  since: string | null          // as the caller gave it
  until: string | null
  /** null when memories were not searched (operator surface, or not in sources). */
  memoryCount: number | null
  conversations: Array<{ id: string; title: string; firstMessageAt: string; lastMessageAt: string | null }>
  /** Conversations in the window beyond the ones listed. */
  moreConversations: number
}
```

  `memoryCount` comes from `findIdsInEventWindow(…, { hotOnly: false }).length`; reuse the ids if the memory branch already read them. `conversations` is `findChatsInWindow` minus `context.chatId`, newest first, at most 10, from the same read the conversations branch used. Add it to `SearchScriptoriumToolOutput` as `windowCensus?: SearchWindowCensus`, and to the `result` object the executor returns.
- **Logging.** Add `windowCensus: { memoryCount, conversations: n }` and `defaultedSources: boolean` to the existing `Search scriptorium completed` info line. Debug-log the in-window id counts per branch.

### 5. Formatter: say what empty means

`formatSearchScriptoriumResults(results, opts?: { query: string; windowCensus?: SearchWindowCensus })`. The executor passes both. Existing callers that pass only `results` behave exactly as they do now, apart from the wording of case C.

**A. Results, with a census.** The current output, then a footer:

```
Conversations you took part in during this period:
- No Quarter at the East Pool (2026-11-03) — `057d2128-af40-4382-9e1e-873d5f1deba9`
- …and 3 more
Read any of them with read_conversation.
```

Omit the footer when the census lists no conversations.

**B. No results, with a census that is not empty.**

```
Nothing matched "pool yesterday" — but that is not the same as having no record of the period.
Between 2026-11-02 and today you hold 30 memories, and you took part in these conversations:
- No Quarter at the East Pool (2026-11-03) — `057d2128-…`
Read one with read_conversation, or search again with broader words. The date range already narrows the search; the query does not need to name the time.
```

**C. No results, no window.**

```
Nothing matched "<query>". An empty search is not proof that nothing happened: try other words, or pass since/until if you are asking about a particular time.
```

**D. No results, census empty** (no memories, no conversations in the window). The one case that really means no record:

```
You hold no memories dated between 2026-11-02 and today, and took part in no conversations in that period.
```

Dates in the text are local calendar dates (`since`/`until` as given; "today" when `until` is absent). Every string is plain and model-facing: no house voice, no feature names.

### 6. Tool description and standing instructions

`lib/tools/search-scriptorium-tool.ts`:

- `query`: append *"Put dates and phrases like 'yesterday' in `since`/`until`, not here; with a date range set, a broad query such as 'what happened' is fine."*
- `sources`: append *"When `since` or `until` is given and `sources` is omitted, only memories and conversations are searched (documents have no dates)."*
- `since`: append *"With a range of two weeks or less, everything dated in it is eligible however loosely it matches the query."*

Then `npx jest -u lib/tools/__tests__/tool-definitions-snapshot.test.ts` and review the diff.

`lib/tools/native-tool-prompt.ts:34` and `lib/tools/simple-json-prompt.ts:266`, replace the last sentence with:

> If the search lists conversations from that period, read the likeliest one with `read_conversation` before answering. Only if it finds nothing and lists no conversation from that period, say you don't recall — never invent dates, places, or details.

Keep the two texts in step. Neither is part of `buildIdentityStack`, so no builder version bump.

**Sequencing note (2026-11-04):** `native-tool-prompt.ts` and its test were being reworked by the character-kind / agent-mode work ([character-kind-and-roleplay-defaults.md](character-kind-and-roleplay-defaults.md)) when this spec was written. Land this sentence after that work is committed, and find the rule by its text ("Recalling past events"), not by line number.

### 7. Per-turn recall: unsummarized chats in the retrospective mini-recap

`lib/memory/recall/assemble.ts`, retrospective branch (`if (query.retrospective)`), when `query.window` is set:

1. Run the existing `searchVaultConversationSummaries` call unchanged.
2. Then `findChatsInWindow({ characterId, userId: plan.userId, window: query.window, excludeChatId: plan.chat.id })`.
3. Append chats not already matched, not standing and not `listed`, newest first, up to `RETRO_MINI_RECAP_MAX_ENTRIES` in total. Build each as a `VaultConversationMatch` with `relativePath: null`, `score: 0`, `firstMessageAt: chat.createdAt`, `lastMessageAt: chat.lastMessageAt ?? null`.
4. Add `unsummarized: n` to the `retrospective` trace stage.

`VaultConversationMatch.relativePath` becomes `string | null`. It is read only inside `conversations.ts` today (checked with grep); confirm again when implementing. `renderRelevantConversationsBlock` does not read it.

The non-retrospective per-turn list and the fold-triggered refresh (`relevant-conversations-refresh.ts`) are unchanged.

## Files touched

| File | Change |
|---|---|
| `lib/scriptorium/chat-window.ts` | **new** — `chatSpanOf`, `chatOverlapsWindow`, `findChatsInWindow` |
| `lib/database/repositories/memories.repository.ts` | `findIdsInEventWindow` |
| `lib/memory/index-store/memory-index.ts` | `includeIds` search option |
| `lib/memory/recall/types.ts` | `HitSource` gains `'window'` |
| `lib/memory/recall/gather.ts` | window union (vector and text strategies), trace fields |
| `lib/memory/recall/score.ts` | `TOOL_WINDOW_FLOOR_MAX_DAYS`, floor exemption, trace field |
| `lib/scriptorium/conversation-search.ts` | `chatIds` option |
| `lib/tools/handlers/search-scriptorium-handler.ts` | windowed default sources, pre-filtered conversations, census, formatter cases, post-filter removed |
| `lib/tools/search-scriptorium-tool.ts` | descriptions; `SearchWindowCensus`; output field |
| `lib/chat/tool-executor.ts` | pass `chatId`; pass `query` and `windowCensus` to the formatter; include `windowCensus` in the result |
| `lib/tools/native-tool-prompt.ts`, `lib/tools/simple-json-prompt.ts` | standing-instruction sentence |
| `lib/memory/recall/assemble.ts`, `lib/memory/recall/conversations.ts` | unsummarized chats in the retrospective mini-recap; nullable `relativePath` |

## Tests

New or extended, all Jest:

- **`findIdsInEventWindow`**: an `occurredAt` row in the window is included; a row whose `occurredAt` is outside but whose `createdAt` is inside is **excluded** (event time wins); a row with null `occurredAt` and `createdAt` inside is included; `hotOnly` drops cold rows. Use a real SQLite binding (required by absolute root path, `require('better-sqlite3')`) where the repository tests already do, otherwise assert the SQL and parameters against a mocked `rawQuery`.
- **`memoryIndex.search` `includeIds`**: only listed ids are returned; it composes with `exclude` and `hotOnly`.
- **`gather`**: with a window and a corpus where the in-window rows are not in the global top-K, the pool contains them with `via: 'window'`; without a window, the pool is identical to today's (regression).
- **`score`**: tool path, 1-day window: an in-window row at cosine 0.2 passes the floor and an out-of-window row is filtered. Tool path, 30-day window: the 0.2 row is floored. Prompt path (recall context present): the 0.2 in-window row is floored.
- **Friday regression fixture** (`__tests__/unit/lib/memory/recall/`): 40 pool memories from September–October with high cosine and 5 Nov 3 memories at 0.28–0.34. Tool search `since`/`until` = Nov 3 returns the 5. The same search with no window returns the September–October ones (unchanged behaviour).
- **`searchConversationChunks` `chatIds`**: chunks from other chats are never scored.
- **Handler**: `sources` omitted plus `since` gives no document search; explicit `sources: ['documents']` plus `since` still searches documents; the conversations post-filter is gone (no `chats.findById` per hit); the census lists in-window chats newest first, excludes `context.chatId`, caps at 10 with `moreConversations`; operator surface gives `memoryCount: null`.
- **`chatSpanOf`**: uses `lastMessageAt` over `updatedAt`; a chat whose `updatedAt` was bumped today but whose last message was last week is not in today's window.
- **Formatter**: one test per case A–D, plus "called without opts" (existing callers) still prints results unchanged.
- **Tool prompts**: `native-tool-prompt.test.ts` and `simple-json-prompt.test.ts` assert the new sentence in both, and that "say you don't recall" is still present.
- **Assemble**: a retrospective turn whose window holds a chat with no vault summary lists that chat; a non-retrospective turn does not; a chat already in `standingIds` is not repeated.
- **Snapshot**: `tool-definitions-snapshot.test.ts` updated with `-u`.

The memory chokepoint grep-tests (`retireMemories`, `memoryIndex`, `admitCandidate`, scoring) must still pass untouched: this change only reads.

## Documentation

- `help/episodic-memory.md`, the "Honest tools, honest answers" bullet: a character's search for a period now looks at that period first; an empty search says whether nothing matched or nothing happened, and names the conversations from that time; a dated search leaves the document stores out unless asked. Steampunk voice. The page's `url` and In-Chat Navigation are unchanged.
- `help/memory-recall-relevance.md`: one sentence where the backward-looking recollection is described — it now names conversations from the period even before the Librarian has summarized them.
- `docs/CHANGELOG.md`: one plain-voice entry under the 4.13 Fixed section.
- `docs/developer/SYSTEM_FLOWCHARTS.md`, if it draws the recall `gather` stage: add the window union.
- No `DDL.md` change (no schema change).

## Verification

1. `npx tsc`, `npm run lint`, `npm run test:unit` (the full suite; `--findRelatedTests` is unreliable here).
2. **Recall replay on Friday** (read-only, against the running server): `npx quilltap recall-replay --instance Friday 76cb8dc8-0690-461a-94fb-a73e21412fbc --char d9d0d998-281e-4598-8345-d81d47be5e97 --turn 1`. Expect the `gather` stage to show `window>0 windowAdded>0`, and Nov 3 memories from `057d2128…` in the candidate table. The memories formed after that turn (including "found a gap in my record") will also appear; that is expected.
3. **Live tool check on V4test, not Friday**: make a chat dated yesterday that mentions a place only in passing, then ask a character "what happened at <place> yesterday?". Confirm the memories and the conversation come back, and that a deliberately empty window gives text D.
4. Replay a Friday turn that has **no** time reference and diff its candidate table before and after the change: it must be identical.

## Out of scope

- **A date-only search** (`query` optional when `since`/`until` is set, returning the period's memories in time order). The census covers most of the need; revisit if characters still reach for an invented topic.
- **Window-first for the fold-triggered relevant-conversations refresh** and the non-retrospective per-turn list. Neither carries a window today.
- **Folding chats that never got a summary.** "No Quarter at the East Pool" has 119 messages and no `contextSummary`; why it was never folded is a separate question.
- **Cleaning up Friday's false memory.** "found a gap in my record" (2026-11-04, importance 0.65) is wrong. The operator removes it from the Commonplace Book UI; no code change.
- **Documents and dates.** Documents carry no event time, and this spec does not give them one.
