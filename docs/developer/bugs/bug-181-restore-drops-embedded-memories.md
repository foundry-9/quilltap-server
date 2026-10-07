# Bug 181 — restoring a full backup drops every memory that has an embedding

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-10-07, by the v5 port's review of its whole-row restore validation (P4.161 / the `94fbb1ae3` boot-hardness unification) |
| **Fixed** | — |
| **Severity** | **High.** Silent, permanent data loss on the restore path: every memory that carries an embedding is refused and skipped — its content, not just its vector. On an instance with an embedding profile that is effectively every memory. The restore reports success with one `Failed to restore memory: [invalid_union …]` warning per lost memory |
| **Who it bites** | anyone restoring a FULL backup (the default — `compact` is off unless asked for, `backup-service.ts:598-605`) of an instance whose memories have been embedded. A compact backup is unaffected: it nulls every embedding first (`backup-service.ts:581`) |
| **Provenance** | **Pinned.** v5 has taken the fix (it decodes the shape before validating); `system_restore_state`'s both-ways table `INDEX_KEYED_EMBEDDING` asserts v4 still refuses the row and v5 lands it, and trips the day v4 converges |
| **Defect site** | the backup writes `data.memories` raw — `backup-service.ts:207-210` (`repos.memories.findByCharacterId`, whose rows carry `embedding` as a `Float32Array`) and `:665` (`writeJsonArrayFile(… 'memories.json', data.memories)`, a plain `JSON.stringify`); the restore re-creates each one through `repos.memories.create` (`restore/restore.ts:261-271`), whose `_create` validates `MemorySchema` (`base.repository.ts:130-141, 350-378`), and `MemorySchema.embedding` (`lib/schemas/memory.types.ts:73-84`) accepts a `Float32Array`, a `number[]`, a `Buffer` or a JSON string — not a plain object |
| **Fix site** | not yet fixed — either `backup-service.ts` (serialize memory embeddings as a `number[]`, or through the existing `encodeEmbedding` the chunk and vector-entry rows already use, `:53`, `:251`, `:333`) or the restore (decode an index-keyed object before `create`); see "The fix" |
| **v5 status** | **Pinned** — fixed in v5 (`restore::rows::decode_index_keyed_embedding`, ruled 2026-10-07); `INDEX_KEYED_EMBEDDING` in `system_restore_state` |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

Take a full backup of an instance whose memories are embedded, then restore it
(either mode). The restore completes, the character and chat counts look right,
and the Commonplace Book is empty — or holds only the memories that were never
embedded. The summary's `warnings` carry one line per lost memory:

    Failed to restore memory: [
      {
        "code": "invalid_union",
        "errors": [
          [ { "code": "invalid_type", "expected": "Float32Array", "path": [],
              "message": "Invalid input: expected Float32Array, received object" } ],
          …

and the log carries, per memory, `Data validation failed {collection:
memories}`, `Error creating entity`, `Error creating memory {characterId}`
and the WARN `Failed to restore memory {memoryId}`.

## Root cause

A memory read through the repository is schema-parsed, so its `embedding`
is a `Float32Array`. `writeJsonArrayFile` serializes each row with
`JSON.stringify`, and `JSON.stringify(new Float32Array([0.25, -0.5]))` is the
index-keyed OBJECT `{"0":0.25,"1":-0.5}` — not an array. On restore that
object reaches `MemorySchema.embedding`, whose four union options are
`z.instanceof(Float32Array)`, `z.array(z.number())`, `z.instanceof(Buffer)`
and `z.string()`; an object matches none of them, the union refuses, and the
restore's per-row `catch` skips the memory.

The backup already knows how to write a vector — `encodeEmbedding`
(`backup-service.ts:53`) is applied to conversation chunks (`:251`) and
vector entries (`:333`) — but `data.memories` is written as read.

Measured against v4's real code at `94fbb1ae3` (the v5 port's
`restore-archive-memory-refusals.zip`, row `ad…09` carrying
`embedding: {"0": 0.25}`): v4's restore refuses it with the `invalid_union`
error above. The memory path in `lib/backup/` is unchanged at `b3f937076`.

## Why it survived

The restore reports success and its summary counts `memories` from the
archive's rows, not from the rows it wrote (measured: 13 in the summary with
eight of them refused), so the summary looks whole. A backup made with
`compact` never shows it, and the per-row warnings are easy to read as a
handful of bad rows rather than all of them.

## The fix

At the source: write memory embeddings in a shape the schema accepts — map
`data.memories` through `{ ...memory, embedding: memory.embedding ?
Array.from(memory.embedding) : null }` (or `encodeEmbedding`, with the matching
decode on restore) before `writeJsonArrayFile`. Backups already written still
carry the object shape, so the restore should also decode it: an `embedding`
that is a plain object whose keys are exactly `"0"…"n-1"` (canonical decimal,
no gaps) with every value a number becomes the `number[]` of those values
before `repos.memories.create`. Anything else is left for the schema to refuse,
as today. (This decode is what v5 does.)

## Verify

Embed a few memories, take a full (non-compact) backup, and restore it into a
fresh instance: every memory lands, each with a non-NULL `embedding` of the
original length, and the summary carries no `Failed to restore memory`
warning. A unit test over the restore's memory phase with one memory carrying
`embedding: {"0": 0.25, "1": -0.5}` asserts the row is created with that
vector.
