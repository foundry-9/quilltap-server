# Bug 248 — A conversation render queues embeddings from a stale read, so new and changed chunks go unembedded

| | |
|---|---|
| **Status** | Fixed 2026-10-14 |
| **Found** | 2026-10-14, checking the `Ignite` instance after its 4.9.2 → 4.10.0-dev.184 upgrade |
| **Fixed** | 2026-10-14 |
| **Severity** | Medium — a chunk with no vector is missing from semantic conversation search (Scriptorium) until the chat renders again or the server restarts. Nothing is lost for good: the startup reconcile re-renders any chat with an unembedded chunk. A bulk re-render, such as an upgrade, leaves a whole cohort behind at once (108 chunks across 98 chats on Ignite) |
| **Who it bites** | every instance with an embedding profile. In normal use each chat's newest chunks were embedded one render late (Friday: 4 to 50 minutes after creation); after a bulk re-render, until the next boot |
| **Provenance** | Original to v4. The post-upsert re-read dates from Scriptorium Phase 1 (`a76240c27`, 2026-04-11); moving job handlers into the forked child made that read stale. Bug 17's fix (`62ab1bc8f`, 2026-08-06) made a content change clear the vector, which turned "keeps a stale vector" into "keeps no vector" |
| **Defect site** | `lib/background-jobs/handlers/conversation-render.ts` (step 4 re-read each chunk with `findByInterchangeIndex` after the step-3 `upsert` and queued only `!chunk.embedding`); `lib/database/repositories/conversation-chunks.repository.ts` `upsert` (insert ignored the id the child proxy had assigned) |
| **Fix site** | Same two files |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-14).** The render handler reads each chunk *before* its upsert and decides
from that row: a chunk is queued when the full re-embed flag is set, when it is new, when it has no
vector, or when its content changes. The id it queues is the existing row's, or for a new chunk the
id the upsert returned, and `ConversationChunksRepository.upsert` now keeps a caller-supplied id
on insert, so the child proxy's synthetic id is the row's real id. Tests:
`__tests__/unit/background-jobs/conversation-render.test.ts` (changed content queued despite the
stale vector; a new chunk queued under the upsert's id; read before write) and
`__tests__/unit/lib/database/repositories/conversation-chunks-upsert.test.ts` (insert keeps a
supplied id, and mints one otherwise).

## Symptom

On Ignite after the upgrade, every background job had completed and none had failed, yet 108 of
1,634 `conversation_chunks` rows had `embedding IS NULL`. All 108 were updated between
14:19:02 and 14:19:03 UTC, during a batch of 98 `CONVERSATION_RENDER` jobs that ran after the
`EMBEDDING_REINDEX_ALL` re-embed had finished. 106 of them still had an `embedding_status` row
saying `EMBEDDED`. No `EMBEDDING_GENERATE` job was pending for any of them.

On Friday, in ordinary use, recently created chunks were embedded 4 to 50 minutes after creation:
when the chat's *next* render ran, not their own.

## Root cause

Every job handler runs in the forked job child, whose repository proxy buffers writes and ships
them to the parent when the job ends, so a job cannot read its own writes. The render handler:

1. upserted every interchange chunk (`upsert` NULLs the vector of a chunk whose content changed,
   per bug 17);
2. then re-read each chunk with `findByInterchangeIndex` and queued an embedding only if
   `!chunk.embedding`.

The read in step 2 sees the committed row. For a changed chunk that is the old row with its old
vector, so nothing is queued, and then the buffered NULL commits. For a new chunk there is no row
at all, so again nothing is queued. Either way the chunk waits for the chat's next render, which
reads the committed NULL and queues it, or for the boot-time `reconcileConversationRendering`.

A second fault sat behind the first: for a buffered upsert the proxy returns a synthetic row with an
id it assigned (`syntheticWriteResult`), but the repository's insert built the row with a freshly
minted id, discarding it. A handler using the upsert's result could not have named the new row.

## Why it survived

The handler tests mocked the repository with read-your-writes semantics never in question: the
re-read mock returned whatever the test set up, independent of the upsert. Live, the lag repaired
itself on the next turn, and the boot reconcile cleared what was left, so chunks were never missing
for long enough to be noticed in search.

## Fix (as built — see the FIXED paragraph above)

Decide from the pre-write row, take the id from that row or from the upsert's result, and have the
repository keep a supplied id on insert.

## How to verify

1. On an instance with an embedding profile, restart the server so the boot reconcile re-renders
   any chat with an unembedded chunk, and let the queue drain. Then:

   ```sh
   npx quilltap db --instance Ignite "SELECT COUNT(*) total, SUM(embedding IS NULL) nulls FROM conversation_chunks"
   ```

   `nulls` should be 0, or only chunks with a FAILED embedding status (over the model's context).
2. Send one turn in a chat, wait for its render and embedding jobs, and confirm the newest chunk has
   a vector without a second turn.
