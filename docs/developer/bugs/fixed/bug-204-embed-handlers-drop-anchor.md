# Bug 204 — Background re-embeds drop the memory anchor line

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase B) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix B) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — after any reindex, every memory's vector loses the date and place signal the episodic spine put there, and gated rows and repaired rows are compared in two different shapes |
| **Who it bites** | anyone who reindexes embeddings (manual reindex, embedding-profile change, the mismatched-dimension repair, or a BUILTIN TF-IDF refit, which ends in a reindex) and then relies on episodic recall |
| **Provenance** | Original to v4. The anchor line came in with the episodic recall overhaul (`buildMemoryEmbeddingText`, `lib/memory/episodic.ts:72`); the background handlers predate it and were not updated |
| **Defect site** | `lib/background-jobs/handlers/embedding-generate.ts:146`; `lib/background-jobs/handlers/embedding-refit.ts:94` (vocabulary corpus, see below) |
| **Fix site** | `lib/background-jobs/handlers/embedding-generate.ts`; `lib/background-jobs/handlers/embedding-refit.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Both handlers now build a memory's text with `buildMemoryEmbeddingText(memory.summary, memory.content, memory)` from `lib/memory/episodic.ts`, the same builder the gate and create paths use. `embedding-generate` (every reindex row) embeds the anchored text; `embedding-refit` fits the BUILTIN TF-IDF vocabulary on the anchored text, so anchor-only tokens (`when`, `place`, entity words) enter the vocabulary. The move to `index-store/embeddingTextFor` stays with Phase B. Tests: `__tests__/unit/lib/background-jobs/handlers/embedding-memory-anchor-text.test.ts`.

## Symptom

A memory written through the gate is embedded as `summary\n\ncontent\n(when: 2026-07-14 · place:
Lighthouse Point)`. After a reindex the same row is embedded as `summary\n\ncontent` only. Date
and place stop contributing to its vector, so "the lighthouse last week" matches it less well than
it did before the reindex, and the gate compares new anchored candidates against unanchored
vectors.

## Root cause

`buildMemoryEmbeddingText` (`lib/memory/episodic.ts:72-80`) is documented as the single source of
truth for a memory's embedded text (`:62-67`). The gate (`memory-gate.ts`), the create paths, the
reinforcement re-embed and `generateMissingEmbeddings` all call it.

`handleEmbeddingGenerate` does not. It builds the text inline:

```ts
const textToEmbed = `${memory.summary}\n\n${memory.content}`;   // embedding-generate.ts:146
```

Every full reindex goes through this handler: `handleEmbeddingReindexAll`
(`lib/background-jobs/handlers/embedding-reindex.ts:81`) enqueues one `EMBEDDING_GENERATE` job per
row (`:155-187`). So a reindex rewrites the whole corpus without anchors.

**Correction to the spec's wording.** The spec says `embedding-refit` also *embeds* without the
anchor line. It does not embed rows. `embedding-refit.ts:94` builds the TF-IDF *fitting corpus*
from `summary\n\ncontent`, then enqueues a reindex (`:144-145`), which embeds through
`embedding-generate` as above. The corpus omission is still a defect for BUILTIN profiles: the
vectorizer skips terms not in its vocabulary
(`plugins/dist/qtap-plugin-builtin-embeddings/tfidf-vectorizer.ts:162-163`), so tokens that occur
only in anchor lines are never in the fitted vocabulary and add nothing even to rows embedded
with the anchor.

## Why it survived

The anchor line is invisible: the row's text is unchanged, and recall still returns the memory,
just ranked a little lower on time and place queries. Reindexes are infrequent and usually follow a
profile change, when other ranking differences are expected.

## Fix

Phase B moves `buildMemoryEmbeddingText` to `index-store/` as `embeddingTextFor(memory)`, and
`embedding-generate`, `embedding-refit` (its corpus), `reapply-profile` and the admission path all
call it. `embedding-generate` writes through `memoryIndex.upsert` instead of the
`VectorIndicesRepository`.

## Verify

Take a memory with `occurredAt` and `entities`. Record its vector, run a reindex for its profile,
and compare: the new vector equals the embedding of `embeddingTextFor(memory)`, anchor line
included. For BUILTIN, after a refit the fitted vocabulary contains the anchor tokens (`when`,
`place`, the entity words).
