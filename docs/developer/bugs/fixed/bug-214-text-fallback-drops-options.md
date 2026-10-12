# Bug 214 — Memory search's text fallback ignores the recall options it is given

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase E) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix C) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — whenever embedding fails or the index has the wrong dimensions, recall silently returns a differently filtered and differently ranked set: no time window, no targeting multipliers, no anchor or probe hits, and the search tool's requested date range is dropped |
| **Who it bites** | any character whose embedding call throws (provider down, rate limit, network) or whose vector index was built with a different embedding profile; every recall path goes through it: the per-turn head, inter-character, Carina, first-message, voice-rewrite, the `search` tool, the Memories API search and `recall-replay` |
| **Provenance** | Original to v4. The text fallback predates the episodic and relevance work; each later option (`recallContext`, `occurredWithin`, `entityAnchors`, `extraProbes`, `excludeMemoryIds`, `weightClockMs`) was added to the vector path only |
| **Defect site** | `lib/memory/memory-service.ts:1395-1514` (`searchMemoriesText`); fallback calls at `:947` (dimension mismatch) and `:1270` (any thrown error); options declared at `:771-869`; line numbers at `4a38222` |
| **Fix site** | `lib/memory/memory-service.ts` (`searchMemoriesText`, `significantQueryWords`, `scoreTextMatch`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Targeted fix ahead of Phase E. `searchMemoriesText` now takes the same options object as `searchMemoriesSemantic` and honours: `excludeMemoryIds` (dropped from the pool), `occurredWithin` (the vector path's two-stage rule — a hard filter without a `recallContext`, hard only when at least `limit` hits survive with one, else the bounded `window↑` boost), `recallContext` (every recall multiplier via `combineRecallMultipliers`, with R1's boost gate switched off because a text score is not a cosine — the same treatment TF-IDF embeddings get), `extraProbes` (each probe searched and scored, a memory keeps its best score), `entityAnchors` (up to three phrases unioned into the pool; they still need a non-zero text score) and `weightClockMs` (the recency decay uses the replay clock). The stop-word list is a module constant. Not changed: `minScore` (a cosine floor has no meaning on the text scale), the raw-`importance` `minImportance` filter (same as the vector path), and related-memory expansion / the R6 background reserve (both need embeddings) — those stay with Phase E. Tests: `__tests__/unit/lib/memory/memory-service-text-fallback.test.ts`.

## Symptom

A character asks the `search` tool for memories from a given week. While the embedding provider is
unreachable, the tool returns keyword matches from any date. On the per-turn path, a retrospective
turn ("what happened at the harbour yesterday?") gets keyword hits with no time window and no
temporal or scope multipliers, and no entity-anchor or probe hits. `recall-replay` run while the
fallback is active includes memories created after the replayed turn. Nothing in the result says
the fallback ran, other than a warn in the log.

## Root cause

`searchMemoriesSemantic` (`memory-service.ts:771`) falls back to the private `searchMemoriesText`
in two places: on an embedding dimension mismatch (`:947`, warned once per character and dimension
pair) and on any thrown error in the semantic path (`:1266-1270`). Both pass the caller's full
`options` object.

`searchMemoriesText` (`:1395`) declares and reads only `limit`, `minImportance`, `source`,
`aboutCharacterId` and `includeCold` (`:1398-1404`). It ignores:

- `recallContext` (`:797`) — no targeting-tag multipliers, no R1–R6 recall adjustments;
- `occurredWithin` (`:813`) — no hard filter and no ×1.3 window boost; this is the `search` tool's
  time filter (`lib/tools/handlers/search-scriptorium-handler.ts:270-274`);
- `entityAnchors` (`:820`) and `extraProbes` (`:826`) — no anchor or probe union;
- `excludeMemoryIds` (`:843`) — today used only by `recall-replay` to drop rows created after
  `asOf` (`lib/memory/recall-replay.ts:252-256`);
- `weightClockMs` (`:854`) — `calculateEffectiveWeight(memory)` is called with the real clock
  (`:1492`), so an `asOf` replay ranks by today's decay;
- `minScore` (`:776`) — the provider floor; any non-zero text score passes.

It also filters `minImportance` on raw `importance` (`:1451`) and has its own copy of the stop-word
list, rebuilt on every call (`:1414-1424`).

## Why it survived

The fallback is rarely exercised: a working embedding profile never reaches it, and the
dimension-mismatch case is warned about once and expected to be fixed by a reindex. Each new
option was added and tested on the vector path, where the tests run. The function is private, so no
test calls it directly.

## Fix

Phase E splits recall into stages (`recall/`: gather → hydrate → score → select). Text search
becomes a `gather` strategy that yields the same `RawHit` shape as vector search, so floor, window,
multipliers, related-memory expansion, exclusions and the background reserve apply to it exactly as
to vector hits. The stage trace records which strategy gathered each hit.

## Verify

Stage test (Phase E): with the embedding call mocked to throw, `assembleRecall` with an
`occurredWithin` window returns only rows inside it, honours `excludeMemoryIds`, and applies the
recall multipliers; the trace shows the text-gather strategy. Live: point a character at an
embedding profile with different dimensions and call the `search` tool with a date range; results
fall inside the range.
