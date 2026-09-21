---
title: Chat-Message Full-Text Search (FTS5) + Text Column Compression — Implementation Spec
audience: Claude Code (quilltap-server)
status: ready to implement
target: main DB (quilltap.db); measured against instance "Friday"
supersedes: none — successor to features/complete/db-size-reduction-spec.md
---

# Chat-Message FTS5 + Text Column Compression

## 0. Purpose & scope

[db-size-reduction-spec.md](complete/db-size-reduction-spec.md) took `quilltap.db`
from ~837 MB to its current size by collapsing regenerable caches, cold-tiering
chunk embeddings, and quantizing vectors. It stopped at a hard line, stated in
its §9: *"Never modify `chat_messages.content`."*

That line was drawn to protect the text from being **lost**. It has since become
the thing blocking the largest remaining win. `chat_messages` is 515 MB of the
932 MB main DB, and 355 MB of that is `content` — real prose, no slack, nothing
derived. It cannot be deleted, cold-tiered, or regenerated. It can only be
**stored smaller**.

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
backend, and the `qt_text()` UDF all exist and are covered by tests. What
remains here is registering `chat_messages`' columns (trivial) and the FTS5
work that makes doing so safe (Parts B–D).

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
for ~133 MB of the result; compression pays for it roughly 2.4× over.

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
standard library, so this adds no dependency.

### 1.4 Environment facts

Verified against `node_modules/better-sqlite3` (the SQLCipher build aliased in
the root `package.json`):

- SQLite **3.53.2**
- `ENABLE_FTS5` compiled in
- `contentless_delete=1` supported (needs ≥ 3.43)
- `tokenize='trigram'` available
- User-defined functions via `db.function(...)` work inside triggers — verified
  with a round-trip insert/update/delete test against a compressed column

---

## 2. Grounding facts (verified against the codebase)

### 2.1 The current search is a full scan

[chats-search.ops.ts:94](../../../lib/database/repositories/chats-search.ops.ts)
`searchMessagesGlobal` builds a JS `RegExp`, passes it as `content: { $regex }`,
and [query-translator.ts:234](../../../lib/database/backends/sqlite/query-translator.ts)
converts it to `LOWER(content) LIKE '%…%'`. Its one caller is
[app/api/v1/ui/search/route.ts:199](../../../app/api/v1/ui/search/route.ts).

The filter is `chatId IN (…) AND type='message' AND role IN ('USER','ASSISTANT')`,
sorted `createdAt DESC`, capped at 100 results. There is **no index that can
serve it** — every global search reads all 355 MB.

### 2.2 The codec layer already exists

[backend.ts:717](../../../lib/database/backends/sqlite/backend.ts) `registerBlobColumns`
registers per-table columns whose values are transformed on the way in
([json-columns.ts:287](../../../lib/database/backends/sqlite/json-columns.ts)
`documentToRow`) and back on the way out (`SQLiteCollection.hydrateRow`,
[backend.ts:378](../../../lib/database/backends/sqlite/backend.ts)).

**This spec adds a second codec of the same shape.** It does not invent a
mechanism; it follows the one the embedding codec already uses.

### 2.3 The self-describing-blob precedent

[lib/embedding/float32-conversion.ts](../../../lib/embedding/float32-conversion.ts)
is the model to copy exactly:

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

---

## 3. Architecture

Four parts. Parts A and B are independent of each other and can ship separately;
C depends on B; D depends on A and B.

### Part A — the text-compression codec (BUILT, v4.10)

`lib/database/text-compression.ts` exists and is in production for `llm_logs`
and `conversation_chunks`. It is described here because Parts B–D depend on
its exact semantics. Structure, doc-comment conventions and naming mirror
`lib/embedding/float32-conversion.ts`.

```
Byte layout:
  [0]      magic   = 0x51            ('Q' — distinct from the 0xEB embedding magic)
  [1]      version = 0x01
  [2]      codec   : 0x01 = brotli
  [3..]    payload
```

A stored value is treated as compressed **iff** it is a BLOB whose first two
bytes are the magic and a version this build knows. Anything else — TEXT, or a
BLOB that fails the check — decodes as a plain UTF-8 string. A `TEXT` column
holding legacy plaintext therefore keeps working untouched, which is what makes
Part D optional rather than blocking.

```ts
export const TEXT_BLOB_MAGIC = 0x51;
export const TEXT_BLOB_VERSION = 0x01;
export const TEXT_CODEC_BROTLI = 0x01;
/** Below this, compression is a net loss — measured, see spec §1.3. */
export const TEXT_COMPRESSION_MIN_BYTES = 512;

export function textToBlob(value: string): Buffer | string;
export function blobToText(value: Buffer | string | null): string | null;
export function isCompressedTextBlob(value: unknown): boolean;
```

`textToBlob` returns the original **string** when the input is under the floor,
so short rows stay TEXT and stay greppable by any tool that looks at the file.

**Registration:** `registerCompressedColumns(table, columns)` already exists on
the SQLite backend alongside `registerBlobColumns`, threaded through
`getCollection` into `SQLiteCollection`, applied in `documentToRow` and
reversed in `hydrateRow`. The remaining step for this spec is one line:
register `chat_messages` → `['content','opaqueContent','description','context']`
beside the existing registrations in
[manager.ts](../../../lib/database/manager.ts) — **but only after Part B
lands**, since compressing `content` breaks the `LIKE` search until FTS5
replaces it.

**Column types stay as they are.** SQLite is dynamically typed; a BLOB lives
happily in a column declared `TEXT`. No DDL change, no table rebuild, no
migration needed for reads. This is the single most important property of the
design — state it in the module doc comment so nobody "fixes" the DDL later.

### Part B — the FTS5 index

**Contentless, application-independent, trigger-maintained.**

```sql
CREATE VIRTUAL TABLE chat_messages_fts USING fts5(
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
how `content` is encoded.

**Sync is by trigger, using a UDF.** `qt_text(value)` — the SQL-visible form of
`blobToText` — already exists
([text-codec-function.ts](../../../lib/database/backends/sqlite/text-codec-function.ts))
and is registered on every connection, including the migration helper and the
CLI. So the triggers can be written directly:

```sql
CREATE TRIGGER chat_messages_fts_ai AFTER INSERT ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(rowid, content) VALUES (new.rowid, qt_text(new.content));
END;
CREATE TRIGGER chat_messages_fts_ad AFTER DELETE ON chat_messages BEGIN
  DELETE FROM chat_messages_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER chat_messages_fts_au AFTER UPDATE OF content ON chat_messages BEGIN
  DELETE FROM chat_messages_fts WHERE rowid = old.rowid;
  INSERT INTO chat_messages_fts(rowid, content) VALUES (new.rowid, qt_text(new.content));
END;
```

Verified working end-to-end, including that an UPDATE correctly retires the old
terms and a DELETE empties the index.

Doing it in triggers rather than in the repository is deliberate: `chat_messages`
is written from the parent process, from restore, from migrations and from
several repository methods. A trigger cannot be bypassed by a new write path;
an application-layer hook can, and silently.

**`qt_text` must be registered on every connection that touches the main DB** —
the parent, the forked child's readonly connection, ad-hoc maintenance
connections, and the CLI. Register it in the same place and with the same
"before any other statement" discipline as `applySqlcipherKey`
([sqlcipher-key.ts:22](../../../lib/database/backends/sqlite/sqlcipher-key.ts)).
A connection that opens without it will fail any write to `chat_messages` with
"no such function", which is a loud, immediate failure rather than a silent
index drift — that is the desired behaviour, but it means the CLI's
`--write` path must register it too.

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

Two hard requirements fall out:

1. **Append `*` to the final token.** Without it, `walk` loses half its hits
   because `LIKE` matched `walking` and a bare token match does not. With it,
   2007 vs 2010 — close enough that no user will notice.

2. **Detect queries that tokenize to nothing meaningful and fall back.**
   `C++` collapses to the token `c` and matches 152 rows bare, 14,260 with a
   prefix — worse than useless. The rule: tokenize the query with the same
   tokenizer; if every token is shorter than 2 characters, or the query is
   entirely punctuation, **do not use FTS**. Fall back to the `LIKE` path via
   `qt_text(content)`, scoped to the candidate `chatId` set. It is slow, it is
   correct, and it is rare.

The translator must also escape `"` by doubling it and wrap each token as a
quoted phrase, so a user typing FTS5 operator syntax (`OR`, `NEAR`, `-`) gets a
literal search rather than a syntax error or a surprise.

**This behaviour change is user-visible and must be documented in `help/`**, per
CLAUDE.md. The honest summary for users: search now matches whole words and word
beginnings rather than any run of letters, it ignores accents, and it is much
faster.

### Part D — the backfill migration

**Migration ID: `compress-chat-message-text-v1`.** Template:
[migrations/scripts/quantize-embeddings.ts](../../../migrations/scripts/quantize-embeddings.ts),
which is the same job in every structural respect.

- keyset-paginate by `rowid`, `BATCH_SIZE = 500`, one transaction per batch
- skip any value already passing `isCompressedTextBlob` → idempotent and
  resumable after interruption
- skip any value under `TEXT_COMPRESSION_MIN_BYTES`
- `shouldRun()` samples ≤ 50 rows and returns true if any is still plaintext
- `reportProgress(i + 1, total, 'messages')` every iteration (throttled
  internally; the commit skill blocks a migration without it)
- a `PRETTY_LABELS` entry in [lib/startup/prettify.ts](../../../lib/startup/prettify.ts),
  house voice, about the user's data — e.g. *"Pressing the transcripts into
  smaller trunks"*

**The FTS index is built in the same migration**, after the compression pass, by
`INSERT INTO chat_messages_fts(rowid, content) SELECT rowid, qt_text(content)
FROM chat_messages WHERE content IS NOT NULL` in batches. Building it second
means it indexes rows already in final form and the triggers stay quiet during
the compression pass (compression only touches `content`, which would otherwise
fire the update trigger 142,697 times for nothing).

Order matters and must be enforced with `dependsOn`:
`['sqlite-initial-schema-v1']`, and the migration must run **after** the FTS
table and triggers exist. Create them in the migration itself rather than in
`ensureCollection`, so a fresh install and an upgrade take the same path.

Unlike `quantize-embeddings-v1`, **this migration is not one-way** — brotli is
lossless and `blobToText` reconstructs the exact original string. A physical
backup is still advised, but the recovery story is "decompress", not
"re-embed from source".

---

## 4. Search-behaviour contract

State this in `help/` and in the module doc comment:

- Search matches **whole words and word prefixes**, not arbitrary substrings.
  Searching `walk` finds *walking* and *walked*; it no longer finds *sidewalk*.
- Accents are folded: `café` and `cafe` find each other.
- Punctuation is not indexed. A query that is only punctuation or only
  one-character tokens falls back to the slower exact scan.
- Results are still capped at 100 and still ordered `createdAt DESC` — **not**
  by FTS rank. Changing the ordering to relevance is a deliberate follow-up, not
  a side effect of this change.
- Only `type='message'` rows with `role IN ('USER','ASSISTANT')` are indexed,
  matching the current filter. System events, informs and staff messages stay
  unsearchable, exactly as today.

That last point needs care: the triggers as written index **every** row. Either
add the role/type condition to the trigger `WHEN` clause, or keep the index
complete and apply the filter in the join. Prefer the `WHEN` clause — a smaller
index is the whole point, and the filter has been stable for the life of the
feature.

---

## 5. Cross-cutting requirements

- **DDL.md** — new virtual table, its triggers, the `qt_text` UDF requirement,
  and a note that `chat_messages` text columns may hold BLOBs.
- **Help docs** — the §4 contract, with `url` frontmatter and a matching
  `help_navigate(...)` "In-Chat Navigation" section.
- **Changelog** — plain American English; user-facing lines are "search is much
  faster" and "conversations take less disk", not the mechanism.
- **Backups/restore** — `chat_messages` rows restore through the repository, so
  the codec applies and the triggers rebuild the index. Verify explicitly: a
  restore into a fresh instance must produce a populated `chat_messages_fts`.
- **`.qtap` export** — exports carry message text as JSON strings. The exporter
  reads through the repository and therefore gets decompressed strings; confirm
  no export path reads `content` via raw SQL. If one does, it must call
  `qt_text()` or `blobToText`.
- **The forked job child** reads via a readonly connection and must register
  `qt_text` — see BACKGROUND_JOBS_CHILD.md.
- **CLI** — `quilltap db message <id>`, `db messages --chat`, and any raw SQL
  the user runs against `content` need `qt_text` registered; `db --repl` should
  expose it too.
- **Logging** — every new backend path fires debug logs per CLAUDE.md.

## 6. PR sequence

~~PR-1 — codec module, `registerCompressedColumns`, the `qt_text` UDF~~ —
**done in v4.10**, shipped with the `llm_logs` and `conversation_chunks`
compression.

1. **PR-1** — FTS5 table, triggers, and the query translator;
   `searchMessagesGlobal` switched to FTS with the documented fallback. Index
   built for existing rows by a standalone backfill. Help + changelog.
   *`chat_messages` is not yet compressed at this point*, so the change is
   purely "search got faster" and can be reverted cleanly.
2. **PR-2** — register `chat_messages`' text columns as compressed, then the
   `compress-chat-message-text-v1` migration + `PRETTY_LABELS` + DDL.
   Backup, migrate, `npx quilltap db optimize`, measure.
3. **PR-3 (follow-up)** — relevance ordering as a search option, now that the
   index can provide it cheaply.

## 7. Expected outcome

`chat_messages` 515 MB → ~332 MB, and global message search from a 55 ms full
scan to a 0.2 ms index probe. Combined with the already-shipped image and
`llm_logs` work, `quilltap.db` and its siblings should land near 1.2 GB from
2.07 GB.

## 8. Non-goals / invariants

- `chat_messages.content` may change **encoding**, never **meaning**. No lossy,
  truncated or normalized form may ever be stored.
- The codec is the single source of truth for the format. No call site may
  compress, decompress, or sniff the magic byte itself.
- No call site may write to `chat_messages_fts` directly — the triggers own it.
- The 512-byte floor is measured, not tuned by feel. Changing it requires
  re-running the §1.3 measurement.
- `trigram` is rejected on measured cost. Re-proposing it requires new numbers.
- Search stays capped at 100 results and `createdAt DESC` ordered in this spec.
