# Bug 203 — Editing a memory leaves its vector and derived fields stale

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase B) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix B, appendix D) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — a hand-edited memory is still found, gated and ranked by the text it had before the edit, and an importance edit does not move the number recall and housekeeping read |
| **Who it bites** | anyone who edits a memory in the memory editor (or calls `PUT /api/v1/memories/[id]`) with a non-BUILTIN embedding profile; with BUILTIN the vector is eventually rebuilt, the rest is still stale |
| **Provenance** | Original to v4. The route predates `reinforcedImportance` (Memory Gate fields), the embedded anchor line (episodic recall overhaul), the frozen archive and the Commonplace mirror (consolidation and hot/cold tiers, `d585480`); each added derived state the route was never taught to maintain |
| **Defect site** | `app/api/v1/memories/[id]/route.ts:76-113` (PUT; raw `updateForCharacter` at `:93`, only follow-up `scheduleRefit` at `:104`); line numbers at `4a38222` |
| **Fix site** | `lib/memory/memory-edit.ts` (`editMemory`, new); `app/api/v1/memories/[id]/route.ts` (PUT); `lib/memory/memory-service.ts` (`updateMemoryWithEmbedding` keeps the row tier on a re-added vector) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `PUT /api/v1/memories/[id]` no longer calls `repos.memories.updateForCharacter` directly. It calls the new `editMemory(characterId, id, patch, { userId })` in `lib/memory/memory-edit.ts`, which: routes the row update through `updateMemoryWithEmbedding` (re-embeds with `buildMemoryEmbeddingText` when summary or content changes, and updates the vector store); recomputes `reinforcedImportance` with `calculateReinforcedImportance(importance, reinforcementCount)` when importance changes; validates `relatedMemoryIds` (each must exist and belong to the same character, else the route answers `400`) and writes added and removed links on the neighbours too; calls `invalidateFrozenArchive(characterId)` and publishes `memories`; and, when the row is a hot consolidation digest, rebuilds the Commonplace mirror file for its subject bucket (old and new subject if `aboutCharacterId` moved) from every hot embedded digest in that bucket via `writeCommonplaceDigestsToVault`. The Phase B `updateMemory` in `admission/` remains the structural home; this is the same behaviour on today's code. Remaining gap: if the re-embed itself fails, `updateMemoryWithEmbedding` still logs and keeps the old vector (unchanged behaviour). Tests: `__tests__/unit/lib/memory/update-memory.test.ts`. Review follow-up: the remaining gap is closed — `updateMemoryWithEmbedding` now embeds the edited text before writing and puts the embedding in the same update, throwing `MemoryReembedError` (row untouched) when it cannot; `editMemory` returns `embedding-failed` and the route answers `502`. The private Commonplace mirror copy in `memory-edit.ts` is gone; it calls `mirrorCommonplaceForSubjects` (the copy had drifted: it skipped unembedded digests that consolidation mirrors).

## Symptom

Open a memory in the memory editor (`components/memory/memory-editor.tsx:68-76`, which sends a
`PUT`), rewrite its content, and save. The row shows the new text, but:

- `memories.embedding` and the character's vector index still hold the vector of the old text, so
  semantic recall, the gate's near-duplicate search and the search tool all match the memory by
  what it used to say;
- raising or lowering importance leaves `reinforcedImportance` where it was, so ranking, the
  frozen archive fill, the recap bands and housekeeping protection keep using the old value;
- the frozen archive for that character keeps the old line until the chat's compaction generation
  changes;
- if the row is a consolidation digest, `Commonplace/*.md` in the vault keeps the old digest text,
  and the extractor reads that file back as canon.

## Root cause

`PUT` (`app/api/v1/memories/[id]/route.ts:76`) validates the body against `updateMemorySchema`
(`:18-27`) and passes it straight to `repos.memories.updateForCharacter` (`:93`), which is a plain
row update (`lib/database/repositories/memories.repository.ts:531-554`). Nothing re-embeds, nothing
recomputes `reinforcedImportance`, nothing calls `invalidateFrozenArchive`, nothing publishes the
`memories` realtime topic, nothing rewrites the Commonplace mirror.

The only follow-up is `scheduleRefit(user.id)` (`:104`). That returns early unless the default
profile's provider is `BUILTIN` (`lib/embedding/embedding-job-scheduler.ts:51-54`); for BUILTIN it
debounces a TF-IDF refit that enqueues a full reindex, which does re-embed the row — though without
the anchor line (bug 204). For any other provider the stale vector stays until something else
re-embeds the row.

A correct path already exists and is unused here: `updateMemoryWithEmbedding`
(`lib/memory/memory-service.ts:630-694` at `4a38222`, used by search-and-replace) re-embeds when content, summary or anchors
change and updates the vector store. It does not recompute `reinforcedImportance` or invalidate
anything either.

The same schema accepts `relatedMemoryIds` (`:26`) as arbitrary UUIDs: not checked for existence or
character, and not written to the other side of the link.

## Why it survived

Editing a memory by hand is rare next to extraction, the editor shows the new text immediately,
and nothing visible reads the vector. The dev instance runs BUILTIN often enough that the refit
hides the missing re-embed.

## Fix

Phase B adds `updateMemory(characterId, id, patch)` in `admission/`, and the PUT route calls it.
It re-embeds through `memoryIndex.upsert` (with `embeddingTextFor`) when summary, content or
anchors change; recomputes `reinforcedImportance` from §3.4 when importance changes; validates
`relatedMemoryIds` (must exist, same character) and writes them on both sides; then invalidates the
frozen archive, publishes `memories`, and refreshes the Commonplace mirror when the row is a digest.

## Verify

With a non-BUILTIN embedding profile, edit a memory's content to something unrelated and save.
`quilltap memories` search (or the `search` tool) for a phrase only in the new text finds it; a
phrase only in the old text no longer ranks it first. Raise its importance from 0.3 to 0.9: the row's
`reinforcedImportance` moves with it.
