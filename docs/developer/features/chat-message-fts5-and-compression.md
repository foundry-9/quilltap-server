---
title: Chat-Message Full-Text Search (FTS5) + Text Column Compression — Implementation Spec
audience: Claude Code (quilltap-server)
status: ready to implement
target: main DB (quilltap.db); measured against instance "Friday"
verified against: 4.10.0-dev.59 (2026-09-21) — every file, line and behaviour claim in §2 was re-checked
supersedes: none — successor to features/complete/db-size-reduction-spec.md
---

# Chat-Message FTS5 + Text Column Compression

## 0. Purpose & scope

[db-size-reduction-spec.md](complete/db-size-reduction-spec.md) took `quilltap.db`
from ~837 MB down by collapsing regenerable caches, cold-tiering chunk
embeddings, and quantizing vectors. It stopped at a hard line, stated in its
§9: *"Never modify `chat_messages.content`."*

That line was drawn to protect the text from being **lost**. It has since become
the thing blocking the largest remaining win. When this spec was measured,
`chat_messages` was 515 MB of a 932 MB main DB, and 355 MB of that was
`content` — real prose, no slack, nothing derived. It cannot be deleted,
cold-tiered, or regenerated. It can only be **stored smaller**. (The 4.10
compression of `llm_logs` and `conversation_chunks` has since shrunk the
*siblings* of that table — see §7 — but touched none of these bytes.)

The reason it has not been is that `content` is the one large text column in the
schema that is **searched in SQL**. This spec removes that obstacle by replacing
the search mechanism, then compressing the column behind it.

This is a two-for-one: the current search is a full table scan, so the index that
unblocks compression also makes search dramatically faster.

**Scope:** `chat_messages.content`, `opaqueContent`, `description`, `context`,
plus the FTS5 index that replaces the `LIKE` scan.

`llm_logs.request`/`response` and `conversation_chunks.content` are **already
compressed** (v4.10, `compress-llm-log-payloads-v1` and
`compress-conversation-chunk-content-v1`). Neither is searched, so neither
needed an index — which is precisely why they went first. **Part A of this
spec is therefore already built and in production:**
`lib/database/text-compression.ts`, `registerCompressedColumns` on the SQLite
backend, and the `qt_text()` UDF all exist, are registered on every connection,
and are covered by tests. What remains here is registering `chat_messages`'
columns (one line, plus two small gaps noted in §3-A) and the FTS5 work that
makes doing so safe (Parts B–D).

---

## 1. Measured baseline — do not re-derive

Every number below was measured on 20,000 real Friday messages loaded into
scratch databases, VACUUMed, and sized on disk. The sample is representative:
20,000 of 142,697 rows produced a 73.4 MB file against a 515 MB table (7.0× vs
7.13× by row count).

### 1.1 Where the bytes are

| Column | Bytes | Note |
|---|---|---|
| `content` | 355 MB | authoritative display text; **searched** |
| `opaqueContent` | 31 MB | real semantic body used in context builds |
| `description` | 3.3 MB | |
| `context` | 6.3 MB | |
| everything else | ~120 MB | ids, enums, timestamps, indexes |

`renderedHtml`, `rawResponse`, `reasoningContent`, `reasoningSegments` and
`debugMemoryLogs` are already collapsed to zero on stale chats by
[collapse-stale-chat-caches.ts](../../../lib/background-jobs/maintenance/collapse-stale-chat-caches.ts).
There is nothing left to reclaim there.

### 1.2 Configuration benchmark

20,000 rows, `page_size=4096`, after VACUUM:

| Configuration | Total | FTS index | vs today | `LIKE`-equivalent query |
|---|---|---|---|---|
| plaintext + `LIKE` (**today**) | 73.4 MB | — | — | 55.6 ms |
| **brotli + FTS5 `unicode61`** | **47.4 MB** | 18.6 MB | **−35.5%** | **0.2 ms** |
| brotli + FTS5 `trigram` | 146.6 MB | 117.9 MB | +99.7% | 0.2 ms |
| plaintext + FTS5 `unicode61` | 92.0 MB | 18.6 MB | +25.3% | 0.1 ms |

**Projected for the full table: 515 MB → ~332 MB, a ~183 MB saving, with search
going from a 55 ms full scan to a 0.2 ms index probe.** The FTS index accounts
for ~133 MB of the result; compression pays for it roughly 2.4× over. The
id-mapping table §3-B adds (~143k rows × two short columns, one unique index)
is on the order of 10 MB and was not in the benchmark; it does not change the
verdict.

`trigram` is ruled out: it is the only tokenizer that preserves exact substring
semantics, and it costs more than the compression saves. §4 handles the
semantic gap instead.

### 1.3 Compression ratio by row size

Brotli quality 5, per row, on held-out messages:

```
<512 B    ~63%   ← store plaintext, compression is a loss
512B–1K    43%
1K–4K      31%
4K–16K     27%
>16K       23%
```

The 512-byte floor is a real threshold, not a guess: below it the brotli header
and the loss of SQLite's own varint packing outweigh the gain. In the 20,000-row
sample, 9,842 rows stayed plaintext and 17,223 compressed.

Brotli q5 beat gzip -6 (28.8 MB vs 31.2 MB whole-file) and is in the Node
standard library, so this adds no dependency. Both the floor and the quality
are already constants in `lib/database/text-compression.ts`
(`TEXT_COMPRESSION_MIN_BYTES`, `TEXT_COMPRESSION_QUALITY`).

### 1.4 Environment facts

Verified against `node_modules/better-sqlite3` (the SQLCipher build aliased in
the root `package.json`), re-run 2026-09-21:

- SQLite **3.53.2**
- `ENABLE_FTS5` compiled in
- `contentless_delete=1` supported (needs ≥ 3.43)
- `tokenize='trigram'` available
- User-defined functions via `db.function(...)` work inside triggers, including
  inside a trigger's `WHEN` clause — verified with insert / update / delete
  round trips against a compressed column
- A contentless FTS5 table returns **NULL** for every column but `rowid`, so an
  `UNINDEXED` id column cannot be read back from it, and
  `INSERT INTO t(t) VALUES('rebuild')` is **refused** on a contentless table.
  Both facts shape §3-B.
- `VACUUM` on a file-backed WAL database **preserved** the implicit rowids of a
  `TEXT PRIMARY KEY` table with gaps in this build. The SQLite documentation
  nonetheless reserves the right to renumber them; see §2.5.

---

## 2. Grounding facts (verified against the codebase)

### 2.1 The current search is a full scan — and a slightly broken one

[chats-search.ops.ts:94](../../../lib/database/repositories/chats-search.ops.ts)
`searchMessagesGlobal` regex-escapes the query, builds a JS `RegExp`, passes it
as `content: { $regex }`, and
[query-translator.ts:235](../../../lib/database/backends/sqlite/query-translator.ts)
converts it to `"content" LIKE '%…%'`. Case-insensitivity comes from SQLite's
default `LIKE`, which folds **ASCII only**. Its one caller is
[app/api/v1/ui/search/route.ts:199](../../../app/api/v1/ui/search/route.ts).

The filter is `chatId IN (…) AND type='message' AND role IN ('USER','ASSISTANT')`,
sorted `createdAt DESC`. There is **no index that can serve it** — every global
search reads all 355 MB. Four further facts about this path matter for the
replacement:

1. **The 100-row cap is applied in JavaScript** after `find()` has returned
   *every* matching row. The FTS query must push `ORDER BY … LIMIT` into SQL.
2. **The `chatId` set is every chat the user owns** (`repos.chats.findByUserId`
   at route.ts:155). In a single-user instance that is all chats, bound as one
   `IN (…)` list. This is fine up to `SQLITE_MAX_VARIABLE_NUMBER` (32,766 since
   3.32) but is not a meaningful filter; the FTS query may keep it for parity or
   replace it with a join on `chats.userId`. Either is acceptable; say which.
3. **The regex→LIKE conversion is lossy.** The ops layer escapes regex
   metacharacters with backslashes, the translator then turns `.` into `_`, and
   no `ESCAPE` clause is emitted — so a query containing `.` (e.g. `Mr. Smith`)
   becomes `%Mr\_ Smith%` and silently matches nothing, any query containing
   `+ ? ( ) [ ] { } | ^ $ \` carries a literal backslash, and a user-typed `%`
   or `_` acts as a wildcard. FTS fixes this for the main path; **the §3-C
   fallback must not reuse `$regex`**.
4. **The route post-processes hits by literal substring** — `getMatchPriority`
   (route.ts:45) and `createSnippet` (route.ts:58) both `indexOf` the
   lower-cased query. Under FTS semantics a hit need not contain the literal
   query (prefix, diacritic folding), in which case the snippet silently falls
   back to the first 100 characters and the priority to "partial". §3-C fixes
   the snippet; the priority helper stays as is.

The three per-chat operations in the same file (`countMessagesWithText`,
`findMessagesWithText`, `replaceInMessages`) load the chat through
`getMessages` and match in JS. They read hydrated strings and are **unaffected**
by compression; they are also outside this spec's scope.

### 2.2 The codec layer already exists

[backend.ts:745](../../../lib/database/backends/sqlite/backend.ts) `registerBlobColumns`
and [backend.ts:759](../../../lib/database/backends/sqlite/backend.ts)
`registerCompressedColumns` register per-table columns whose values are
transformed on the way in
([json-columns.ts:285](../../../lib/database/backends/sqlite/json-columns.ts)
`documentToRow`; `buildUpdateQuery` in `query-translator.ts` for `$set`) and
back on the way out (`SQLiteCollection.hydrateRow`,
[backend.ts:374](../../../lib/database/backends/sqlite/backend.ts), which
decodes compressed columns *first* so the bytes cannot be misread as an
embedding).

**One gap:** `SQLiteTransaction.getCollection` (backend.ts, bottom of file)
constructs its `SQLiteCollection` without the compressed-column set, so a write
made inside `withTransaction` bypasses the codec. Today the only transaction
user is `users.repository.ts` and nothing writes `chat_messages` that way, so
it is latent — but PR-2 threads `compressedColumns` through it (one
constructor argument) so the codec has no bypass at all.

### 2.3 The self-describing-blob precedent

[lib/embedding/float32-conversion.ts](../../../lib/embedding/float32-conversion.ts)
is the model `text-compression.ts` already copies:

- one module that is the *single source of truth* for an on-disk format
- a magic byte + version + payload header
- readers accept **both** the new format and the legacy one, keyed on the magic
- a batched, idempotent, resumable migration re-packs existing rows
- because readers are format-tolerant, **the migration is not a correctness
  prerequisite** — it only reclaims bytes

That last property is what makes this safe to ship incrementally.

### 2.4 The invariant this spec changes

`db-size-reduction-spec.md` §9 says never to modify `content`. That invariant
was about **never discarding** message text, and it still holds: compression is
byte-exact and reversible, and `qt_text()` round-trips the original string.

Restate it in the successor form: *`chat_messages.content` may change encoding,
never meaning.* Nothing may store a lossy, truncated, or normalized form of it.

### 2.5 `chat_messages` has no stable integer identity

`chat_messages` is declared `"id" TEXT PRIMARY KEY`
([sqlite-initial-schema.ts:238](../../../migrations/scripts/sqlite-initial-schema.ts)),
so its `rowid` is **implicit**. FTS5 keys every index entry on an integer
rowid, and a contentless table can hand back nothing else. Keying the index on
the implicit rowid has two failure modes, one documented and one observed in
this repo:

- SQLite's documentation says `VACUUM` *may* renumber the rowids of a table
  without an explicit `INTEGER PRIMARY KEY`. This build did not (§1.4), and
  `npx quilltap db optimize` runs `VACUUM`; the contract is "may", not "won't".
- Any table rebuild — the `CREATE new … INSERT … SELECT … DROP … RENAME`
  pattern that [add-doc-mount-file-links.ts](../../../migrations/scripts/add-doc-mount-file-links.ts)
  uses four times on other tables — reassigns every rowid **and silently drops
  the triggers** with the old table. No such rebuild of `chat_messages` exists
  today; the point is that one would corrupt the index without a single error.

§3-B therefore keys the index on a tiny mapping table with an explicit
`INTEGER PRIMARY KEY` (which `VACUUM` never renumbers) and a `UNIQUE` message
id, and §3-B's startup guard catches dropped triggers.

### 2.6 What already goes through the repository

Verified, so §5 can state these as facts rather than to-dos:

- **Backup** reads messages via `repos.chats.getMessages`
  ([backup-service.ts:194](../../../lib/backup/backup-service.ts)); **restore**
  writes them via `repos.chats.addMessage`
  ([restore/restore.ts:209](../../../lib/backup/restore/restore.ts)); the
  **`.qtap` exporter** reads via `getMessages`
  ([ndjson-writer.ts:328](../../../lib/export/ndjson-writer.ts)). All three see
  decoded strings and fire the triggers on write.
- **Physical backups** are `VACUUM INTO`
  ([physical-backup.ts:263](../../../lib/database/backends/sqlite/physical-backup.ts)),
  which copies the FTS shadow tables, the mapping table and the triggers
  verbatim.
- **The job child's buffered writes** are replayed in the parent as repository
  method calls (`applyWritesUnsafe`,
  [job-dispatcher.ts:360](../../../lib/background-jobs/host/job-dispatcher.ts)),
  so they hit the codec and the triggers like any other write.
- **`qt_text` is registered on every connection already:** parent
  (`client.ts`), forked child (`child-client.ts`), mount-index and llm-logs
  clients, the migration helper (`migrations/lib/database-utils.ts`) and the
  CLI (`packages/quilltap/lib/db-helpers.js`, including `--repl` and raw SQL).
- **Raw SQL that touches message text today:** only
  `collapse-duplicate-avatar-rolls-v1.ts` reads and writes `content` /
  `opaqueContent` directly. It is ordered before the new migrations in
  `migrations/scripts/index.ts`, so on an upgrading instance it has always run
  against plaintext, and on a fresh instance there is nothing to read. The
  standing rule it establishes: **any future migration or maintenance query
  that reads these columns wraps them in `qt_text()`, and any that writes them
  goes through the repository or `textToBlob`.**
- **The CLI does not decode them.** `quilltap db messages` and `db message`
  (`packages/quilltap/lib/db-commands.js` ~472–590) select `content` raw and
  print it; `db log` already decodes `request`/`response` through `decodeText`
  at ~604. PR-2 must extend `decodeText` to the four message columns.
- `SQLITE_CAPABILITIES.textSearch` in
  [interfaces.ts:223](../../../lib/database/interfaces.ts) has advertised
  "Via FTS5 extension" since the backend was written; this spec is the first
  thing to make it true.

---

## 3. Architecture

Four parts. A is built; B and C ship together (PR-1); D follows (PR-2).

### Part A — the text-compression codec (BUILT, v4.10)

`lib/database/text-compression.ts` exists and is in production for `llm_logs`
and `conversation_chunks`. It is described here because Parts B–D depend on
its exact semantics.

```
Byte layout:
  [0]      magic   = 0x51            ('Q' — distinct from the 0xEB embedding magic)
  [1]      version = 0x01
  [2]      codec   : 0x01 = brotli
  [3..]    payload
```

A stored value is treated as compressed **iff** it is a BLOB whose first three
bytes are a magic, version and codec this build knows. Anything else — TEXT, or
a BLOB that fails the check — decodes as a plain UTF-8 string. A `TEXT` column
holding legacy plaintext therefore keeps working untouched, which is what makes
Part D optional rather than blocking.

```ts
export const TEXT_BLOB_MAGIC = 0x51;
export const TEXT_BLOB_VERSION = 0x01;
export const TEXT_CODEC_BROTLI = 0x01;
export const TEXT_COMPRESSION_MIN_BYTES = 512;   // measured, see §1.3
export const TEXT_COMPRESSION_QUALITY = 5;

export function textToBlob(value: string): Buffer | string;
export function blobToText(value: unknown): string | null;
export function isCompressedTextBlob(value: unknown): boolean;
```

`textToBlob` returns the original **string** when the input is under the floor
*or when compression would not make it smaller*, so short and incompressible
rows stay TEXT and stay greppable by any tool that looks at the file.

**Registration — what PR-2 actually adds:**

1. One line beside the existing registrations in
   [manager.ts:125](../../../lib/database/manager.ts):
   `backend.registerCompressedColumns('chat_messages', ['content', 'opaqueContent', 'description', 'context'])`.
   All four are plain `z.string()` fields in `lib/schemas/chat.types.ts` (no
   JSON detour). **Only after Part B has shipped** — compressing `content`
   breaks the `LIKE` search until FTS5 replaces it.
2. Thread `compressedColumns` through `SQLiteTransaction.getCollection` (§2.2).
3. `decodeText` on the four columns in the CLI's `db messages` / `db message`
   (§2.6), and bump `packages/quilltap`'s version (it publishes automatically at
   release — no manual `npm publish`).

**Column types stay as they are.** SQLite is dynamically typed; a BLOB lives
happily in a column declared `TEXT`. No DDL change, no table rebuild, no
migration needed for reads. This is the single most important property of the
design; the module doc comment already says so, so nobody "fixes" the DDL later.

### Part B — the FTS5 index

**Contentless, id-keyed, trigger-maintained.** All DDL lives in one new module,
`lib/database/backends/sqlite/chat-message-fts.ts`, exporting the statements
plus `ensureChatMessageFtsSchema(db)` and `rebuildChatMessageFtsIndex(db, onProgress?)`,
so the migration, the startup guard and any future CLI verb share one
definition. Nothing else may spell this DDL.

```sql
-- Stable integer identity for FTS (see §2.5). VACUUM never renumbers an
-- explicit INTEGER PRIMARY KEY; the UNIQUE index makes the trigger lookups O(log n).
CREATE TABLE IF NOT EXISTS chat_messages_fts_map (
  ftsId     INTEGER PRIMARY KEY,
  messageId TEXT NOT NULL UNIQUE
);

CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
  content,
  content='',                    -- contentless: index only, no stored copy
  contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2'
);
```

`content=''` is not optional. An external-content FTS5 table reads the source
column to tokenize it; once that column holds a brotli BLOB, FTS5 would index
the compressed bytes. Contentless means FTS5 stores only the inverted index and
never looks at the base table — 18.6 MB per 20k rows, and correct regardless of
how `content` is encoded. The costs of contentless are that `snippet()` /
`highlight()` are unavailable (§3-C builds snippets in JS) and that
`'rebuild'` is refused (hence `rebuildChatMessageFtsIndex`, which is
`DELETE FROM` both tables followed by a batched re-insert from the base table).

**Sync is by trigger, using the `qt_text` UDF** already registered on every
connection (§2.6). The `WHEN` clauses carry the eligibility filter from §4, so
only rows the search would ever return are indexed. This SQL was executed
end-to-end against the bundled SQLite (insert, prefix match, diacritic match,
update that retires old terms, no-op update, delete):

```sql
CREATE TRIGGER IF NOT EXISTS chat_messages_fts_ai AFTER INSERT ON chat_messages
  WHEN new.type = 'message' AND new.role IN ('USER','ASSISTANT') AND new.content IS NOT NULL
BEGIN
  INSERT INTO chat_messages_fts_map(messageId) VALUES (new.id);
  INSERT INTO chat_messages_fts(rowid, content)
    VALUES ((SELECT ftsId FROM chat_messages_fts_map WHERE messageId = new.id),
            qt_text(new.content));
END;

CREATE TRIGGER IF NOT EXISTS chat_messages_fts_ad AFTER DELETE ON chat_messages
  WHEN EXISTS (SELECT 1 FROM chat_messages_fts_map WHERE messageId = old.id)
BEGIN
  DELETE FROM chat_messages_fts
    WHERE rowid = (SELECT ftsId FROM chat_messages_fts_map WHERE messageId = old.id);
  DELETE FROM chat_messages_fts_map WHERE messageId = old.id;
END;

CREATE TRIGGER IF NOT EXISTS chat_messages_fts_au AFTER UPDATE OF content ON chat_messages
  WHEN qt_text(new.content) IS NOT qt_text(old.content)
   AND EXISTS (SELECT 1 FROM chat_messages_fts_map WHERE messageId = old.id)
BEGIN
  DELETE FROM chat_messages_fts
    WHERE rowid = (SELECT ftsId FROM chat_messages_fts_map WHERE messageId = old.id);
  INSERT INTO chat_messages_fts(rowid, content)
    VALUES ((SELECT ftsId FROM chat_messages_fts_map WHERE messageId = old.id),
            qt_text(new.content));
END;
```

Three deliberate choices in that SQL:

- **The update trigger compares decoded text, not bytes.** An UPDATE that
  changes only the *encoding* — which is exactly what the PR-2 backfill does to
  every row — leaves the index untouched. Without this guard the backfill would
  delete and re-tokenize 142,697 rows for nothing, and any future codec version
  would do it again. It also means the update trigger never has to be dropped
  around a migration, which is one less thing to forget.
- **Eligibility is decided at insert time only.** An UPDATE of `type` or
  `role` does not re-evaluate it; no code path changes those columns on an
  existing row, and the map's `EXISTS` guard keeps the other two triggers
  correct either way.
- **Triggers, not repository hooks.** `chat_messages` is written from the
  parent process, from restore, from migrations and from several repository
  methods. A trigger cannot be bypassed by a new write path; an application-layer
  hook can, and silently.

A connection that opens without `qt_text` fails any write to `chat_messages`
with "no such function", which is a loud, immediate failure rather than a
silent index drift — that is the desired behaviour, and §2.6 lists why it will
not happen with the connections that exist today.

**Startup guard.** Because a table rebuild drops triggers silently (§2.5), add
`reconcileChatMessageFts()` beside
[reconcile-conversation-rendering.ts](../../../lib/startup/reconcile-conversation-rendering.ts):
run `ensureChatMessageFtsSchema` (all statements are `IF NOT EXISTS`, so it is
a no-op on a healthy instance), then compare
`COUNT(*) FROM chat_messages WHERE type='message' AND role IN (…) AND content IS NOT NULL`
with `COUNT(*) FROM chat_messages_fts_map`. On a mismatch, log at `warn` and
call `rebuildChatMessageFtsIndex`. This is cheap (two counts on indexed
columns) and turns the one silent failure mode into a self-healing one.

### Part C — the query translation layer

**New module: `lib/database/repositories/fts-query.ts`.**

This is where the real design risk lives. `LIKE '%x%'` is substring matching;
FTS5 `unicode61` is token matching. Measured against 20,000 real messages:

| User types | `LIKE` hits | FTS bare | FTS prefix | Verdict |
|---|---|---|---|---|
| `djinn` | 657 | 651 | 651 | fine |
| `Istanbul` | 140 | 140 | 140 | identical |
| `the estate` | 2504 | 2503 | 2503 | fine |
| `walk` | 2010 | **1089** | **2007** | **prefix is mandatory** |
| `walking` | 527 | 526 | 526 | fine |
| `don't` | 2426 | 2437 | 2437 | apostrophe folding, acceptable |
| `café` | 10 | **34** | 35 | diacritic folding — finds more, arguably better |
| `C++` | 0 | **152** | **14260** | **punctuation collapse — must be handled** |

The translator, `buildFtsMatchExpression(query): { match: string } | { fallback: true }`:

1. **The whole query is one quoted phrase with a trailing prefix star:**
   `"the estate"*`, with any `"` in the query doubled. A phrase (adjacent
   tokens, in order) is the token-level equivalent of a substring, which is why
   `the estate` matches 2503 vs 2504 above. Quoting also means a user typing
   FTS5 operator syntax (`OR`, `NEAR`, `-`, `:`) gets a literal search rather
   than a syntax error or a surprise. Without the `*`, `walk` loses half its
   hits because `LIKE` matched `walking`; with it, 2007 vs 2010 — close enough
   that no user will notice.

2. **Detect queries that tokenize to nothing meaningful and fall back.**
   `C++` collapses to the token `c` and matches 152 rows bare, 14,260 with a
   prefix — worse than useless. Approximate the `unicode61` tokenizer in JS
   (split on anything outside `\p{L}` / `\p{N}`; that is what `unicode61`
   treats as a separator, and exactness is not needed here because this only
   decides *whether* to use FTS). If every token is shorter than 2 characters,
   or there are no tokens, **do not use FTS**. The fallback is
   `qt_text("content") LIKE ? ESCAPE '\'` with the user's `%`, `_` and `\`
   escaped — built directly, **not** through `$regex` (§2.1 item 3) — under the
   same eligibility filter and `ORDER BY createdAt DESC LIMIT ?`. It is slow, it
   is correct, and it is rare.

The repository query for the FTS path (`chatId` handling per §2.1 item 2):

```sql
SELECT m.id, m.chatId, m.role, m.createdAt, m.content
  FROM chat_messages_fts f
  JOIN chat_messages_fts_map x ON x.ftsId = f.rowid
  JOIN chat_messages m         ON m.id = x.messageId
 WHERE chat_messages_fts MATCH ?
   AND m.chatId IN (…)
 ORDER BY m.createdAt DESC
 LIMIT ?
```

Run it through `rawQuery` and hydrate `content` with `blobToText` (or select
`qt_text(m.content)`); either way the result shape of `searchMessagesGlobal`
does not change, so route.ts needs no edit for the query itself.

**Snippets.** `createSnippet` in route.ts must stop looking for the literal
phrase and instead locate the first query *token* as a case-folded,
diacritic-stripped prefix (`String.prototype.normalize('NFD')` plus a
combining-mark strip is enough; it only positions a window). Keep the existing
"first 100 characters" fallback for the rare miss. `getMatchPriority` may stay
literal — it only affects ordering within the messages group, and the §4
contract keeps `createdAt DESC` as the order of record.

**This behaviour change is user-visible and must be documented in `help/`**, per
CLAUDE.md — see §5. The honest summary for users: search now matches whole
words and word beginnings rather than any run of letters, it ignores accents,
and it is much faster.

### Part D — the migrations

Two migrations, one per PR, so PR-1 is revertible without touching stored
bytes. Both follow the shape of
[compress-conversation-chunk-content.ts](../../../migrations/scripts/compress-conversation-chunk-content.ts)
(the closest template — same codec, same `shouldRun` sampling, same batching)
and satisfy the two rules in CLAUDE.md § *Writing migrations*: a `PRETTY_LABELS`
entry in [lib/startup/prettify.ts](../../../lib/startup/prettify.ts) and
`reportProgress(...)` in every loop (the commit skill blocks a migration
without either). Both are listed in `migrations/scripts/index.ts` after
`compressConversationChunkContentMigration`.

**PR-1 — `create-chat-message-fts-v1`.** `introducedInVersion: '4.10.0'`,
`dependsOn: ['sqlite-initial-schema-v1']`.

- `shouldRun()`: true when any of the two tables or three triggers is missing
  from `sqlite_master`, or when the §3-B count comparison disagrees.
- `run()`: `ensureChatMessageFtsSchema(db)`, then `rebuildChatMessageFtsIndex`,
  which walks eligible rows keyset-paginated by `rowid` (a fine cursor *within*
  one migration run — §2.5 is about identity across time, not within a
  transaction), `BATCH_SIZE = 500`, one transaction per batch, inserting into
  the map and the index with `qt_text(content)` so it is correct whether or not
  PR-2 has run. `reportProgress(scanned, total, 'messages')` per batch, with
  `total` from a `SELECT COUNT(*)` up front.
- Create the objects **in the migration**, not in `ensureCollection`:
  `ensureCollection` only runs the Zod-derived `CREATE TABLE IF NOT EXISTS` and
  knows nothing of triggers, and a fresh instance gets `chat_messages` from
  `sqlite-initial-schema-v1` anyway, so a fresh install and an upgrade take the
  same path.
- Label, house voice: *"Cataloguing every line ever spoken, so the search bar
  can find it in a blink…"*

**PR-2 — `compress-chat-message-text-v1`.** `introducedInVersion` = the
release it ships in, `dependsOn: ['sqlite-initial-schema-v1', 'create-chat-message-fts-v1']`.

- keyset-paginate by `rowid`, `BATCH_SIZE = 250` (the chunk migration's value;
  message rows are larger than embedding rows), one transaction per batch
- for each of the four columns: skip values already passing
  `isCompressedTextBlob`, skip values under `TEXT_COMPRESSION_MIN_BYTES`
  (`textToBlob` already does both — call it and compare identity) → idempotent
  and resumable after interruption
- the `AFTER UPDATE OF content` trigger's decoded-text guard keeps the index
  quiet through the whole pass; **do not** drop and recreate triggers
- `shouldRun()` samples ≤ 50 rows with `length("content") >= 512` and returns
  true if any is still plaintext
- `reportProgress(scanned, total, 'messages')` every batch
- Label: *"Pressing the transcripts into smaller trunks…"*

Unlike `quantize-embeddings-v1`, **this migration is not one-way** — brotli is
lossless and `blobToText` reconstructs the exact original string. A physical
backup is still advised, but the recovery story is "decompress", not
"re-embed from source". Rewriting rows frees pages inside the file; the
changelog line already tells operators to run `npx quilltap db optimize`
(VACUUM) afterward.

---

## 4. Search-behaviour contract

State this in `help/search.md` and in the `fts-query.ts` module doc comment:

- Search matches **whole words and word prefixes**, not arbitrary substrings.
  Searching `walk` finds *walking* and *walked*; it no longer finds *sidewalk*.
- Accents are folded: `café` and `cafe` find each other. Case folding now
  covers non-ASCII letters too, where `LIKE` folded ASCII only.
- Punctuation is not indexed. A query that is only punctuation or only
  one-character tokens falls back to the slower exact scan. Queries containing
  `.`, `+`, `(` and the like **start working** — today they silently return
  nothing (§2.1 item 3).
- Results are still capped at 100 and still ordered `createdAt DESC` — **not**
  by FTS rank. Changing the ordering to relevance is a deliberate follow-up, not
  a side effect of this change.
- Only `type='message'` rows with `role IN ('USER','ASSISTANT')` and non-null
  `content` are indexed, matching the current filter. System events, informs
  and staff messages stay unsearchable, exactly as today. This lives in the
  trigger `WHEN` clauses (§3-B) — a smaller index is the whole point, and the
  filter has been stable for the life of the feature.

---

## 5. Cross-cutting requirements

- **DDL.md** — a `chat_messages` row in the "Compressed text BLOB format"
  registry table (line ~178), the two new tables and three triggers as their
  own sections, the `qt_text` requirement restated for these columns, and a
  note on the id-mapping rationale (§2.5).
- **Help docs** — `help/search.md` (`url: *`, because the search bar is on
  every page) gets the §4 contract in its "Messages" bullets. It has no
  "In-Chat Navigation" section today, and neither do the other two `url: *`
  docs (`sidebar.md`, `width-toggle.md`); add one with
  `help_navigate(url: "/")` to match its own "Open this page" link, or note the
  wildcard exemption in the commit — but decide, don't skip.
- **Changelog** — plain American English, under the existing `### 4.10-dev`
  storage section for PR-1 ("message search is an index probe instead of a
  table scan; queries with punctuation now work; whole-word semantics") and a
  new line for PR-2 ("conversation text takes about a third less disk;
  nothing is lost").
- **Backups / restore / `.qtap` export / job child** — verified to go through
  the repository (§2.6); no code change. **Verify explicitly in PR-1's tests**
  that a restore into a fresh instance leaves `chat_messages_fts_map` with the
  same count as eligible messages.
- **CLI** — PR-2: `decodeText` on the four columns in `db messages` /
  `db message`; version bump. Raw SQL, `--repl` and `db log` already have what
  they need. A `db fts-rebuild` verb is a reasonable follow-up, not a
  requirement — the startup guard covers the failure mode.
- **Logging** — every new backend path fires debug logs per CLAUDE.md: the
  translator's chosen path (fts / fallback) and token count at `debug`, the
  startup guard's count comparison at `debug` and its rebuild at `warn`, the
  migrations' per-batch progress at `debug`.
- **Tests** — unit tests for `fts-query.ts` (the table in §3-C is the
  fixture list: prefix, phrase, quote doubling, operator words, `C++`, empty);
  real-driver tests for the trigger round trips and the startup guard's rebuild
  (remember the repo rule: real-binding tests `require` `better-sqlite3` by
  absolute root path); a snapshot of the DDL strings so a drift is loud.

## 6. PR sequence

~~PR-0 — codec module, `registerCompressedColumns`, the `qt_text` UDF~~ —
**done in v4.10**, shipped with the `llm_logs` and `conversation_chunks`
compression.

1. **PR-1** — `chat-message-fts.ts` (DDL + rebuild), the
   `create-chat-message-fts-v1` migration, the startup guard, `fts-query.ts`,
   `searchMessagesGlobal` switched to FTS with the documented fallback, the
   snippet fix, help + changelog + DDL.md. *`chat_messages` is not yet
   compressed at this point*, so the change is purely "search got faster and
   more correct" and can be reverted by dropping five schema objects.
2. **PR-2** — register `chat_messages`' text columns as compressed, the
   transaction-collection fix, the CLI decode, the
   `compress-chat-message-text-v1` migration + `PRETTY_LABELS` + DDL.md.
   Backup, migrate, `npx quilltap db optimize`, measure, and record the
   measured figure in the changelog.
3. **PR-3 (follow-up)** — relevance ordering as a search option, now that the
   index can provide it cheaply.

## 7. Expected outcome

`chat_messages` 515 MB → ~332 MB, and global message search from a 55 ms full
scan to a 0.2 ms index probe. The 4.10 storage work already took the reference
instance from 2.0 GB to 1.48 GB (see `docs/CHANGELOG.md`, "databases take
about a quarter less disk") without touching this table, so the combined
result should land near **1.3 GB** — the figures in §0 and §1 predate that
work but describe bytes it did not move.

## 8. Non-goals / invariants

- `chat_messages.content` may change **encoding**, never **meaning**. No lossy,
  truncated or normalized form may ever be stored.
- The codec is the single source of truth for the format. No call site may
  compress, decompress, or sniff the magic byte itself.
- `chat-message-fts.ts` is the single source of truth for the FTS DDL. No call
  site may write to `chat_messages_fts` or `chat_messages_fts_map` directly —
  the triggers own them, and the rebuild helper is the only bulk writer.
- The 512-byte floor is measured, not tuned by feel. Changing it requires
  re-running the §1.3 measurement.
- `trigram` is rejected on measured cost. Re-proposing it requires new numbers.
- Search stays capped at 100 results and `createdAt DESC` ordered in this spec.
- The per-chat search/replace operations in `chats-search.ops.ts` are out of
  scope; they match hydrated strings in JS and are unaffected.
