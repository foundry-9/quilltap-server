# Bug 233 — Search and replace leaves memories with the old text's embedding

| | |
|---|---|
| **Status** | Fixed 2026-10-12 |
| **Found** | 2026-10-12, fixing review finding #9 on PR 90 |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — recall and the gate match a replaced memory against its old wording until something else re-embeds it |
| **Who it bites** | anyone who runs search and replace with memories in scope |
| **Provenance** | Original to v4 |
| **Defect site** | `lib/search-replace/search-replace-service.ts:184-206` (rewrites the rows, then calls `updateMemoryWithEmbedding` with the already-written text); `lib/memory/memory-service.ts:703-715` (re-embeds only when the text differs from the stored row) |
| **Fix site** | `lib/search-replace/search-replace-service.ts` (new pure `planMemoryReplacement`; each row through `editMemory`); `MemoriesRepository.replaceInMemories` removed |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Search and replace no longer rewrites memory rows first. For each
matching memory it computes the replaced content, summary and keywords from the row as read
(`planMemoryReplacement`) and writes them through `editMemory`, which embeds the new text before it
writes and stores text and vector together, then invalidates the frozen archive, publishes
`memories` and re-mirrors a digest. A row whose new text cannot be embedded is left unchanged and
named in the result's `errors`. The repository's `replaceInMemories` (its only caller) is gone.
Test: `__tests__/unit/lib/search-replace/search-replace-memories.test.ts`.

## Symptom

After replacing "Laura" with "Lauren" across a character's memories, the memories read "Lauren" but
their embeddings still encode "Laura". A recall query about Lauren ranks them as if they still said
Laura, and the next gate check compares new candidates against the old vectors.

## Root cause

`replaceInMemories` writes the new text first. The loop then calls `updateMemoryWithEmbedding` with
the row's new `content` and `summary`; that function re-embeds only when the incoming text differs
from the stored row (`contentChanged`), which it no longer does, so nothing is re-embedded. The call
is wrapped in a `try` that only logs, so nothing reports it.

## Why it survived

The loop reads as "regenerate embeddings", and the progress bar says so; no test checks that the
stored embedding changed.

## Fix

Re-embed the replaced rows directly: compute the embedding text with `buildMemoryEmbeddingText`
(resolving the memory timezone first) and write the embedding through the same path a forced
re-embed uses, or pass the pre-replacement text so the change is detected. Since the PR 90 review,
`updateMemoryWithEmbedding` embeds before writing; replacing through it with the old row as the
baseline would also keep text and vector in one write.

## Verify

Test: replace a word in a memory, then assert the stored embedding equals the embedding of the new
text, not the old.
