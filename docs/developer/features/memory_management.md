# Memory Management — The Commonplace Book

This document describes how character memories are **formed** in chat, **measured** for importance and protection, and **maintained** over time by the housekeeping and gate subsystems. It also catalogues the places where, at ~tens-of-thousands of memories per character, the Node main thread stalls on synchronous work.

> **Status caveat.** The commits on 2026-04-20 (`734a9f31`, `2ddb0507`, `b9fb1bc0`, `9c70fa55`) were written specifically to fix main-thread stalls and the cap-enforcement gate behavior. In practice the overall situation got **worse** after those commits, not better — the targeted hot paths inside `runHousekeeping` are faster, but the user-visible symptoms (first-page-load stalls, Salon freezes during chat, missing chat responses) did not clear up. The retrieval path (`searchMemoriesSemantic`) is the current prime suspect and is described in §6.

---

## 1. Data model

### 1.1 SQLite schema

Defined in `migrations/scripts/sqlite-initial-schema.ts` (table creation), extended by `migrations/scripts/add-memory-gate-fields.ts`.

```sql
CREATE TABLE memories (
  id                   TEXT PRIMARY KEY,
  characterId          TEXT NOT NULL,
  personaId            TEXT,
  aboutCharacterId     TEXT,                    -- Inter-character target
  chatId               TEXT,
  projectId            TEXT,
  content              TEXT NOT NULL,           -- Full memory text
  summary              TEXT NOT NULL,           -- Distilled form for injection
  keywords             TEXT DEFAULT '[]',       -- JSON array
  tags                 TEXT DEFAULT '[]',       -- JSON array of tag IDs
  importance           REAL DEFAULT 0.5,        -- LLM-derived, 0..1
  embedding            BLOB,                    -- Float32 unit vector
  source               TEXT DEFAULT 'MANUAL',   -- 'AUTO' | 'MANUAL'
  sourceMessageId      TEXT,
  lastAccessedAt       TEXT,
  reinforcementCount   INTEGER DEFAULT 1,
  lastReinforcedAt     TEXT,
  relatedMemoryIds     TEXT DEFAULT '[]',       -- JSON array of UUIDs
  reinforcedImportance REAL DEFAULT 0.5,        -- importance + log2(n+1)*0.05, cap 1.0
  createdAt            TEXT NOT NULL,
  updatedAt            TEXT NOT NULL
);
CREATE INDEX idx_memories_characterId ON memories(characterId);
CREATE INDEX idx_memories_chatId      ON memories(chatId);
CREATE INDEX idx_memories_projectId   ON memories(projectId);
```

The repository registers `embedding` as a BLOB column: `MemoriesRepository` constructor calls `registerBlobColumns('memories', ['embedding'])` so the column round-trips as a `Float32Array`.

### 1.2 Per-character vector store

A character's embeddings are mirrored into an in-process nearest-neighbor index at `lib/embedding/vector-store.ts`, persisted to `<dataDir>/data/embeddings/<characterId>.json` (or equivalent). All gate lookups and retrieval searches go through this store; the SQLite `embedding` column is the durable source of truth, but the runtime queries the in-memory index.

### 1.3 TypeScript types

Canonical Zod schemas in `lib/schemas/memory.types.ts`. `Memory` carries every column above, plus a couple of derived fields on hydration.

---

## 2. Formation — how a memory gets written

### 2.1 Trigger point

Every finalized assistant turn goes through `lib/services/chat-message/message-finalizer.service.ts`, which calls into `lib/services/chat-message/memory-trigger.service.ts`:

- `triggerMemoryExtraction()` — single-character memories
- `triggerInterCharacterMemory()` — multi-character observations (one job per (observer, subject) pair, last 5 assistant messages from others)

These are **fire-and-forget**: they do not await extraction, they enqueue a background job via `enqueueMemoryExtraction` / `enqueueInterCharacterMemory` in `lib/background-jobs/queue-service.ts`. The chat response returns before extraction runs.

### 2.2 Background processing

Handler: `lib/background-jobs/handlers/memory-extraction.ts` → `processMessageForMemory()` in `lib/memory/memory-processor.ts`.

Pipeline:

1. **Rate-limit check** (`resolveExtractionRateLimit`): counts memories created for this character in the last hour via `countCreatedSince`. Three outcomes:
   - `allow` — normal flow
   - `throttle` — raise the importance floor for this extraction
   - `skip` — over hard cap, drop the entire extraction

   Settings shape: `MemoryExtractionLimits` in `lib/schemas/settings.types.ts` (`enabled`, `maxPerHour`, `softCap`, `throttleFloor`). Currently API-only — no UI card.

2. **Candidate generation** (two parallel cheap-LLM calls via `Promise.all`):
   - `extractMemoryFromMessage()` — memories the character forms about the user. **Skipped entirely** when `ctx.userCharacterId` is missing (no user-controlled character resolved); a one-time Host whisper (`systemKind: 'no-user-character'`) is posted to the chat from `postHostNoUserCharacterAnnouncement` to prompt the operator. This avoids the legacy null-attribution pile.
   - `extractCharacterMemoryFromMessage()` — memories about the character's own experiences (self-referential)
   - For multi-character: `extractInterCharacterMemoryFromMessage()` also runs

   Candidate cap per call = `Math.ceil(maxTokens / 8000)` (previously `/4000` — halved in `b8f0d201`).

3. **Per-branch write helpers** in `memory-processor.ts` (replacing the legacy single `createMemoryFromCandidate` that wrote `aboutCharacterId: ctx.userCharacterId || null` for *both* branches):
   - `createUserMemoryFromCandidate()` — `aboutCharacterId = ctx.userCharacterId`
   - `createSelfMemoryFromCandidate()` — `aboutCharacterId = ctx.characterId` (true self-reference)

   Both flow into `createMemoryWithGate()` in `lib/memory/memory-service.ts`, which then invokes the Memory Gate (see §4.1).

### 2.3 Name-presence safety net (v1) + holder-dominance tiebreaker (v2)

`createMemoryWithGate()` calls `applyNamePresenceCheck()` before insert. For AUTO memories with a non-self `aboutCharacterId`, it loads both the holder and the about-character and runs `resolveAboutCharacterId()` from `lib/memory/about-character-resolution.ts`. The resolver applies two rules:

1. **Presence (v1):** the about-character's name + aliases (plus generic `user` / `the user` for `controlledBy: 'user'` characters) must appear in `summary + content`. Absent → flip to holder.
2. **Dominance (v2):** when both holder and about-character are named, count word-boundary hits for each. If the holder is mentioned **strictly more often**, flip to holder. Ties go to the about-character (Q3 policy). Holder names exclude `user`/`the user` so generic aliases only count toward the about-character side.

Manual memories (`source !== 'AUTO'`) bypass the safety net so explicit operator attributions are honoured. The shared helpers (`namesForAboutCharacter`, `namesForHolder`, `nameAppears`, `countNameOccurrences`, `resolveAboutCharacterId`) back both migrations (`align-about-character-id-v1` and `-v2`), so runtime and backfill apply identical rules.

### 2.4 Manual creation

`POST /api/v1/memories` (and per-character routes) call `createMemoryWithEmbedding()` or `createMemoryWithGate()` with `source: 'MANUAL'`. Manual memories **bypass the gate's skip decisions** in housekeeping — `source === 'MANUAL'` is a hard override against deletion — and they bypass the name-presence safety net so the operator's explicit attribution is preserved.

---

## 3. Measurement — scoring

Three distinct numbers travel with every memory. Keep them straight.

### 3.1 `importance` (raw)

LLM-derived, 0..1, produced at extraction time by the cheap-LLM. Default 0.5 when missing. Never mutates after write.

### 3.2 `reinforcedImportance` (boosted)

```text
reinforcedImportance = min(1.0, importance + log2(reinforcementCount + 1) * 0.05)
```

Defined in `lib/memory/memory-gate.ts::calculateReinforcedImportance`. Recomputed on every REINFORCE decision (see §4.1). Used as the base for both retrieval ranking and housekeeping protection, falling back to `importance` when null.

### 3.3 `effectiveWeight` — retrieval ranking

`lib/memory/memory-weighting.ts::calculateEffectiveWeight`. Used when packing memories into context for the LLM.

```text
base           = reinforcedImportance ?? importance
referenceTime  = max(createdAt, lastReinforcedAt)       // not lastAccessedAt
daysOld        = (now - referenceTime) / 86400000
decay          = 0.5 ^ (daysOld / halfLifeDays)         // halfLifeDays = 30
raw            = base * decay
floor          = base * importanceFloor                  // importanceFloor = 0.70
effectiveWeight = max(raw, floor)
```

Time-decay reference is `max(createdAt, lastReinforcedAt)` — **passive retrieval does NOT reset the clock**. This was deliberate: we didn't want a feedback loop where popular-but-stale memories re-anchor themselves just by being pulled into context.

Final retrieval ranking (`searchMemoriesSemantic`, memory-service.ts:543-547) is a blend:

```text
finalScore = cosineSimilarity * 0.4 + effectiveWeight * 0.6
```

### 3.4 Protection score — the housekeeping gate

`lib/memory/memory-weighting.ts::calculateProtectionScore`, introduced by `b9fb1bc0`. Replaces the old four-rule gate where `importance >= 0.7` was effectively immortality. On one Friday-instance character, 19,303 of 19,524 memories (98.9%) were previously protected by that bright line — the cap-enforcement pass was a no-op.

Four additive components:

```text
// 1. Content component — time-decayed, capped so LLM rating alone can't protect
decay            = 0.5 ^ (daysSinceRefTime / 30)
contentComponent = min(0.40, base * max(decay, 0.10))

// 2. Reinforcement bonus — log-saturates
reinforcementBonus = min(0.25, log2(count + 1) * 0.08)

// 3. Graph degree bonus — related-memory links
graphDegreeBonus = min(0.10, relatedMemoryIds.length * 0.025)

// 4. Recent access bonus — binary, 90-day window
recentAccessBonus = (daysSinceAccess < 90) ? 0.10 : 0

score = min(1, contentComponent + reinforcementBonus + graphDegreeBonus + recentAccessBonus)
```

A memory is **protected** (not a deletion candidate) when `score >= 0.5` (`PROTECTION_THRESHOLD` in housekeeping.ts). `source === 'MANUAL'` short-circuits the calc and returns protected.

`lastAccessedAt` is populated fire-and-forget by `searchMemoriesSemantic` via `bumpAccessTimes → MemoriesRepository.updateAccessTimeBulk` at the end of every vector-hit and text-fallback return (one `updateMany` per search, not N round-trips). Both the Memory Gate's write-time duplicate check (`findSimilarMemories`/`findSimilarMemoriesWithEmbedding`) and direct `findById` calls in the `/api/v1/memories/[id]` route intentionally do not update it — those aren't retrievals-into-context. Before this wiring landed, only the Memories search API route called `updateAccessTime` at all; on a 17.7k-memory corpus built entirely through chat, only 13 rows had ever had their `lastAccessedAt` set, which meant the recent-access component was structurally starved of signal.

The `0.40` content cap is deliberate: a fresh 0.8-importance memory with no usage signals scores `0.40 + 0.08 (default count=1) = 0.48`, just *under* the threshold. The memory has to earn the remaining 0.02+ from at least one usage signal (a single graph link, an extra reinforcement, or recent access) to become protected. This preserves the blended-score design goal that LLM-rated importance is one opinion among several, not a final verdict.

> **Why distinct from effectiveWeight?** Retrieval decay and protection decay both use a 30-day half-life, but they play different roles. Retrieval has a 70% floor on weight so well-ranked memories always surface even when old. Protection has no floor on score — but it does cap each input component (content at 0.40, reinforcement at 0.25, graph at 0.10, access at 0.10) so the 0.5 threshold is a meaningful boundary regardless of which signals fire. Protection originally used a 365-day half-life and no content cap, which on a 20k-memory character made fresh high-importance memories effectively immortal: a 1-day-old memory at importance 0.7 scored ~0.70, well above the 0.5 threshold, and the cap-enforcement pass deleted zero rows while pinning the main thread for 15 minutes per run. The 30-day half-life helped older memories decay but left young-memory protection untouched — and on a corpus where 97% of memories are <30 days old, that mattered. The content cap addresses the young-memory half of the problem.

---

## 4. Maintenance

### 4.1 The Memory Gate

`lib/memory/memory-gate.ts::runMemoryGate`. Pre-write filter invoked on every auto-extracted and (as of `fae5f437`) every inter-character candidate. Also used by `createMemoryWithGate` for manual creation.

Thresholds:

| Constant | Value | Effect |
| --- | --- | --- |
| `NEAR_DUPLICATE_THRESHOLD` | 0.90 | Skip entirely — no write, no reinforce |
| `MERGE_THRESHOLD` | 0.85 | REINFORCE existing memory |
| `RELATED_THRESHOLD` | 0.70 | INSERT + bidirectional link (0.70–0.85 band) |
| (below 0.70) | — | INSERT as standalone |
| `GATE_TOP_K` | 5 | Only check the 5 closest vector matches |

Flow:

1. Generate embedding for `summary + "\n\n" + content`. One retry at +500ms on failure; if still failing, return `SKIP_EMBEDDING_FAILED` (no row written — a memory without an embedding is invisible to future gate checks, so we refuse to create it).
2. `vectorStore.search(embedding, 5)` — top-5 cosine-similarity matches.
3. Hydrate those 5 memories via `repos.memories.findByIds([...])` — **not** a full scan.
4. Decide based on best match against the thresholds above.

REINFORCE path (`reinforceMemory` in memory-gate.ts:229):

- Extract novel details from the candidate content that aren't already in the existing memory's content. Deterministic regex extraction (proper nouns, numbers, dates, technical terms, stop-word filter) — no LLM call.
- Append novel details as `[+]`-prefixed footnotes to `content`.
- `reinforcementCount += 1`, `lastReinforcedAt = now`.
- Recompute `reinforcedImportance`.
- Re-embed if content changed; replace the vector in the store.

INSERT_RELATED path (`linkRelatedMemories` in memory-gate.ts:318):

- Create the new row normally.
- For each memory in the 0.70–0.85 band, push the new id into its `relatedMemoryIds` and push its id into the new memory's `relatedMemoryIds`. Bidirectional.

### 4.2 Housekeeping

`lib/memory/housekeeping.ts::runHousekeeping`. Three passes over a character's memories, invoked:

- **Scheduled**, once per 24h via `lib/background-jobs/scheduled-housekeeping.ts` — enqueues a `MEMORY_HOUSEKEEPING` job per user whose `autoHousekeepingSettings.enabled` is true
- **On-demand**, from the "Run housekeeping now" button (settings > data & system) — same handler

Defaults (`DEFAULT_OPTIONS` in housekeeping.ts:84):

- `maxMemories: 2000`
- `maxAgeMonths: 6`
- `maxInactiveMonths: 6`
- `minImportance: 0.3`
- `mergeSimilar: false` (opt-in — it's expensive and runs on-demand only)
- `mergeThreshold: 0.9`

**Pass 1 — retention policy** (housekeeping.ts:231-258)

For each memory (sorted by importance desc, createdAt desc):

- Is it protected (§3.4)? → keep.
- `effectiveImportance >= minImportance`? → keep.
- Is it `>= maxAgeMonths` old AND low-importance AND (never accessed OR `>= maxInactiveMonths` inactive)? → delete.

Protection result for each memory is cached in `protectedMap` (added in `2ddb0507`) so pass 3 doesn't recompute it.

**Pass 2 — similarity merge** (housekeeping.ts:262-335, off by default)

For each remaining memory:

- `vectorStore.search(embedding, 10)`
- Any match `>= mergeThreshold` that isn't already in the delete set gets merged — keep the higher-importance memory, delete the other.

**Pass 3 — hard cap enforcement** (housekeeping.ts:337-381)

If survivors still exceed `maxMemories`:

- Pre-check: if every unprotected survivor is already deleted, skip the scoring + sort (added in `734a9f31` — critical for 98.9%-protected characters where the old code would score and sort 19k entries just to find zero to delete).
- Otherwise: score every survivor with `calculateEffectiveWeight`, sort ascending by score, delete the lowest until under cap, skipping protected ones.

**Write-back** (housekeeping.ts:385-396):

- Single `repos.memories.bulkDelete(characterId, ids)` call.
- Remove the same ids from the vector store.
- `vectorStore.save()` once at the end.

### 4.3 Retrieval for context

`lib/memory/memory-service.ts::searchMemoriesSemantic` (line 466). Called from `lib/chat/context/memory-injector.ts::formatMemoriesForContext` during turn prep.

1. Embed the query.
2. Check stored-vs-query embedding dimensions — mismatch falls back to text search immediately.
3. `vectorStore.search(queryEmbedding, limit * 3)` — top `3 × limit` matches.
4. **Hydrate all matches** — this is the hot spot, see §6.
5. Apply `minImportance` and `source` filters.
6. Sort by blended score (`0.4 * cosine + 0.6 * effectiveWeight`).
7. Return top `limit`.

Fallback text search (`searchMemoriesText`, line 567): full-phrase match then per-word broadening with stop-word filtering, scored with the same blended formula.

### 4.4 Ancillary maintenance jobs

- **Embedding repair** — `lib/background-jobs/handlers/embedding-refit.ts` and `embedding-reindex.ts`. Both load `findByCharacterId` in full; see §6.
- **Missing-embedding backfill card** — settings UI, calls `generateMissingEmbeddings()` in memory-service.ts (line 792). Loops in `batchSize`-sized groups, saving the vector store between batches.

---

## 5. Configuration surface

From `lib/schemas/settings.types.ts` and `help/memory-housekeeping.md`:

```ts
autoHousekeepingSettings: {
  enabled: boolean                         // default false
  maxMemoriesPerCharacter: number          // default 2000
  maxAgeMonths: number                     // default 6
  maxInactiveMonths: number                // default 6
  minImportance: number                    // default 0.3
  perCharacterCapOverrides: Record<uuid, number>  // UI: Memory Housekeeping card
}

memoryExtractionLimits: {                  // API-only, no UI
  enabled: boolean                         // default false
  maxPerHour: number                       // hard cap
  softCap: number                          // throttle start
  throttleFloor: number                    // min importance when throttled
}
```

---

## 6. Event-loop hot spots — where the main thread stalls

This is the problem we are actively fighting. The attempts on 2026-04-20 (`734a9f31`, `2ddb0507`, `b9fb1bc0`, `9c70fa55`) targeted the housekeeping sweep specifically, and they did make that function cheaper, but overall responsiveness on the 32k-memory Friday instance did not improve meaningfully. The list below separates **fixed-but-still-slow** from **unfixed** sites.

### 6.1 `searchMemoriesSemantic` full-table hydration — FIXED

Phase 1 of the retrieval-performance plan (commit `perf(memory): hydrate only matched memories in semantic search paths`). All three call sites in `lib/memory/memory-service.ts` (`searchMemoriesSemantic`, `findSimilarMemories`, `findSimilarMemoriesWithEmbedding`) now mirror the Memory Gate's pattern:

```ts
const matchedIds = vectorResults.map(vr => vr.id)
const memories = await repos.memories.findByIds(matchedIds)
```

Per-turn retrieval cost now scales with *hit count* (~60) rather than corpus size (~20k). The full-corpus hydration that used to pin the main thread for seconds per chat turn no longer happens on the read path at all. `generateMissingEmbeddings` and `rebuildVectorIndex` still scan the whole corpus, but those are cold, user-initiated paths.

### 6.2 Housekeeping `findByCharacterId` — FIXED to paginate, still heavy

`lib/memory/housekeeping.ts:186-191`

```ts
const LOAD_BATCH_SIZE = 250
for await (const batch of repos.memories.findByCharacterIdInBatches(characterId, 250)) {
  for (const memory of batch) memories.push(memory)
  await new Promise<void>(resolve => setImmediate(resolve))
}
```

Fixed in `734a9f31` — used to be a single 19k-row synchronous read with Zod validation inline. Now paginates at 250/page with `setImmediate` between pages. Helps, but the housekeeping sweep itself is still O(n) over the character's memories afterward.

### 6.3 Housekeeping hot-loop logger overhead — FIXED

`calculateEffectiveWeight` used to emit a `logger.debug` call with seven `.toFixed()` fields every invocation. On a 19.5k character this produced ~20k context objects per cap-enforcement pass — constructed even when the debug level was disabled, because the arguments were evaluated eagerly. Removed in `2ddb0507`.

### 6.4 Housekeeping O(n²) delete-set lookups — FIXED

`memoriesToDelete` was an array with `.includes()` / `.filter(!includes)` inside per-memory loops across three passes. Swapped to `Set<string>` in `2ddb0507`. Also `mergeSourceSet` replaces an `.some()` scan, and `entryById` is pre-built once instead of a `.find()` per iteration in the merge pass.

### 6.5 Housekeeping double protection computation — FIXED

Pass 1 and pass 3 both called `isProtectedMemory` on every survivor. Pass 1 now populates `protectedMap`; pass 3 reads from it (fallback to compute only if the key is missing). `2ddb0507`.

### 6.6 Housekeeping never yielded — FIXED

Both big loops in housekeeping now `await setImmediate()` every 500 items:

```ts
const YIELD_INTERVAL = 500
if ((i + 1) % YIELD_INTERVAL === 0) {
  await yieldTick()
}
```

`2ddb0507`. Lets HTTP, SSE, and other jobs get a turn inside a sweep.

### 6.7 Housekeeping cap-enforcement no-op skip — FIXED

When every remaining memory is protected, the old code still scored and sorted them. `734a9f31` added a pre-check (`hasDeletionCandidate`) that skips the entire O(n) scoring + O(n log n) sort in that case.

### 6.8 Scheduler startup tick — FIXED but suggestive

`lib/background-jobs/scheduled-housekeeping.ts:26-31`

```ts
const STARTUP_GRACE_MS = 5 * 60 * 1000        // was 30s
const RECENT_RUN_WINDOW_MS = 20 * 60 * 60 * 1000
```

Every restart used to fire housekeeping 30s after boot, which pinned the main thread during the window when Next.js was still compiling routes. The browser saw `TypeError: Failed to fetch` on `/api/v1/session`, `/api/v1/quick-hide-tags`, and `/api/v1/help-chats/*`. Fixed in `734a9f31`:

- Startup grace increased to 5 minutes.
- Startup tick short-circuits if a `scheduled`-reason sweep completed in the last 20h.
- The MEMORY_HOUSEKEEPING job type now has a 15-minute timeout (was 3 min default).
- `enqueueMemoryHousekeeping` defaults `maxAttempts: 1` — retries used to re-run the entire sweep from scratch on timeout.

### 6.9 Character optimizer / embedding repair — UNFIXED

Each of these still does a full `findByCharacterId`:

- `lib/services/character-optimizer.service.ts:341, 360`
- `lib/background-jobs/handlers/embedding-refit.ts:80`
- `lib/background-jobs/handlers/embedding-reindex.ts:152`
- `lib/backup/backup-service.ts:112`, `lib/backup/restore-service.ts:338, 453, 534`
- `lib/cascade-delete.ts:331`
- `lib/export/ndjson-writer.ts:184, 255`, `lib/export/quilltap-export-service.ts:118, 135`

Backup/export/cascade-delete are cold paths and acceptable — they're expected to be slow. The embedding-repair handlers run on-demand and inside a background job, but they're still unpaginated Zod validation, so during an embedding-refit the main thread will stall on a 32k character's ingest.

### 6.10 Per-candidate cap — FIXED

`b8f0d201` halved the per-call candidate cap from `ceil(maxTokens / 4000)` to `ceil(maxTokens / 8000)`. On a 32k-context cheap-LLM this drops from 8 to 4 candidates per extraction, ≈50% reduction in gate+embed work for a multi-character turn.

### 6.11 Async extraction queue — FIXED

Pre-`b8f0d201`, memory extraction was `await`-ed inline in the chat finalizer — a chat turn didn't return until all extraction LLM calls + embedding calls + gate checks + writes had finished. Moved to the background job queue; the chat turn now returns as soon as extraction is enqueued.

### 6.12 Float32 embeddings + unit-vector migration — FIXED

`b8f0d201` + `normalize-embeddings-unit-vectors-v1` migration. Embeddings round-trip as `Float32Array`; cosine similarity collapses to a dot product (no `Math.sqrt` per compare) because all vectors are L2-normalized at write time.

---

## 7. Why the recent commits "mostly made things worse"

> **Postscript.** The section below describes the state on 2026-04-20, the day the first wave of housekeeping fixes landed and the corpus-wide slowness was still visible. Everything it names as an unfixed contributor was addressed over the following day. §10 is the retrospective of what actually changed across 4.3-dev, from the user-visible perspective.

The 2026-04-20 commits did what their messages claim — each individually makes the housekeeping sweep cheaper, less log-noisy, and better-yielding. The honest assessment:

1. **We fixed the wrong hot path.** The instrumentation that pointed at `runHousekeeping` was correct — that function *was* pinning the thread for minutes during the daily sweep. But the *visible* stalls the user reports happen during chat, not during sweeps. The retrieval path (§6.1) is a per-turn cost we never addressed; if we were watching the wrong cost centre, an "improvement" to housekeeping wouldn't show up as a user-visible win.
2. **Blended protection removed immortality but didn't unblock deletion.** `b9fb1bc0` correctly demolished the `importance >= 0.7 = immortal` rule, so the cap pass is no longer a no-op. But the immediate effect on a 32k character is a much larger deletion candidate list, meaning the sweep now actually *does* work (including vector-store writes and `bulkDelete` SQLite writes) where before it silently exited.
3. **The startup-grace lengthening hides symptoms rather than fixing them.** Pushing the first sweep from 30s → 5min helped the specific "page didn't load after restart" failure, but the underlying issue — the sweep is heavy enough to contend meaningfully with Next.js compile/request handling — is unchanged, it's just mis-timed away from the restart window.
4. **`9c70fa55`'s Zod fix was a prerequisite, not a speedup.** That commit unblocked the "Run housekeeping now" button from erroring; it didn't make the sweep faster.

Net effect on a 32k-memory instance: housekeeping is faster per-item and better-behaved under the event loop, but every chat turn still pays the §6.1 full-table hydration, and the now-functional cap pass does real I/O it previously skipped. The UX budget went backward.

---

## 8. Open work

Ranked by expected impact on the 32k-memory case:

1. **Move extraction/embedding/gate work to a true worker thread.** The project memory `project_job_queues_worker_threads.md` tracks this. The background-job queue is still in-process; a `Worker` would remove every embedding-generation and Zod-validation cost from the main thread entirely. Verify Electron compatibility (the `better-sqlite3-multiple-ciphers` driver should be safe in a worker, but the vector-store singleton needs thought).
2. **Paginate the embedding-repair handlers** (§6.9) the same way housekeeping was paginated in `734a9f31`. Low-impact per incident but user-initiated, so visible when it fires.
3. **Add a UI for `memoryExtractionLimits`** so the user can actually throttle extraction on a runaway chat without editing settings.json. API-only today.
4. **Search-hit counter as a retrieval signal.** Tracked in `project_search_hit_counter.md`. Bumps a per-memory counter when tool-search retrieves it; feeds back into the blended protection score as a softer proxy alongside `lastAccessedAt`.
5. **Rank-normalize LLM importance.** Tracked in `project_importance_rank_normalize.md`. Optional sharpening layer; only worth trying if the cheap-LLM importance output is monotonic enough that percentile normalization helps.

---

## 9. File inventory

| Area | File | Key exports |
| --- | --- | --- |
| Types | `lib/schemas/memory.types.ts` | `MemorySchema`, `Memory` |
| Gate | `lib/memory/memory-gate.ts` | `runMemoryGate`, `reinforceMemory`, `linkRelatedMemories`, `calculateReinforcedImportance` |
| Service | `lib/memory/memory-service.ts` | `createMemoryWithGate`, `createMemoryWithEmbedding`, `searchMemoriesSemantic`, `generateMissingEmbeddings` |
| Processor | `lib/memory/memory-processor.ts` | `processMessageForMemory`, `processInterCharacterMemory` |
| Housekeeping | `lib/memory/housekeeping.ts` | `runHousekeeping`, `getHousekeepingPreview`, `needsHousekeeping`, `isProtectedMemory` |
| Weighting | `lib/memory/memory-weighting.ts` | `calculateEffectiveWeight`, `calculateProtectionScore`, `rankMemoriesByWeight`, `formatRelativeAge` |
| Injection | `lib/chat/context/memory-injector.ts` | `formatMemoriesForContext`, `formatInterCharacterMemoriesForContext` |
| Triggers | `lib/services/chat-message/memory-trigger.service.ts` | `triggerMemoryExtraction`, `triggerInterCharacterMemory` |
| Job handlers | `lib/background-jobs/handlers/memory-extraction.ts`, `memory-housekeeping.ts`, `embedding-refit.ts`, `embedding-reindex.ts` | `handleMemoryExtraction`, `handleMemoryHousekeeping` |
| Scheduler | `lib/background-jobs/scheduled-housekeeping.ts` | `scheduleHousekeeping`, `runScheduledHousekeeping` |
| Repository | `lib/database/repositories/memories.repository.ts` | `findByCharacterId`, `findByCharacterIdInBatches`, `findByIds`, `searchByContent`, `bulkDelete`, `countCreatedSince` |
| Vector store | `lib/embedding/vector-store.ts` | `getCharacterVectorStore`, `getVectorStoreManager` |
| Schema DDL | `migrations/scripts/sqlite-initial-schema.ts`, `migrations/scripts/add-memory-gate-fields.ts` | — |

---

## 10. 4.3-dev retrospective — what actually changed

This document was originally written at the point where §7's assessment was still true: housekeeping had been made cheaper but the user-visible chat stalls on a 32k-memory instance had not cleared. Over the two days that followed, the remaining hot paths were addressed and the protection model was rewritten. The list below is the complete set of memory-subsystem changes that landed in 4.3-dev, grouped by where in the pipeline they sit. The changelog (`docs/CHANGELOG.md` under `4.3-dev`) carries the full narrative — this is the one-line-per-fix index.

### 10.1 Write path (extraction → gate → insert)

- **Async extraction via the background job queue.** `finalizeMessageResponse` previously `await`-ed extraction inline, holding the request open for 30–40 s after the SSE `done` event. Now enqueues `MEMORY_EXTRACTION` / `INTER_CHARACTER_MEMORY` jobs and returns immediately; the **Mem** badge surfaces the queue state.
- **Hard candidate cap of 5 per extraction call** (`HARD_CANDIDATE_CAP`) on top of the existing `ceil(maxTokens / 8000)` formula — defense-in-depth against a cheap-LLM that ignores the prompt ceiling.
- **Per-call candidate cap halved** from `ceil(maxTokens / 4000)` to `ceil(maxTokens / 8000)`. For a 32k-context cheap-LLM profile, 8 → 4 candidates per extraction.
- **Memory Gate targeted lookup.** The gate's pre-write similarity check used `findByCharacterId` to hydrate the top-5 vector matches; now uses `findByIds(top5.map(r => r.id))`. Per-insert read drops from a 20k-row full-table scan to a five-row PK lookup.
- **No-embedding-no-write.** When the embedding call fails twice, the gate returns `SKIP_EMBEDDING_FAILED` instead of falling through to the old keyword-overlap gate (which has been deleted outright). Prevents the creation of NULL-embedding rows that were invisible to every future gate check.
- **`NEAR_DUPLICATE_THRESHOLD = 0.90`** tier above the merge band: candidates whose best neighbor scores ≥ 0.90 resolve to `SKIP_NEAR_DUPLICATE` — the observation is absorbed silently, neither inserted nor reinforcing.
- **`MERGE_THRESHOLD` raised 0.80 → 0.85.** Reinforcement reserved for genuinely duplicate-enough matches; the 0.70–0.85 band now produces `INSERT_RELATED`.

### 10.2 Read path (semantic retrieval)

- **`searchMemoriesSemantic` hydrates only matched ids** (§6.1). The three call sites in `memory-service.ts` now do `findByIds(vectorResults.map(r => r.id))`. Per-turn retrieval cost scales with hit count (~60), not corpus size (~20k).
- **Bounded top-K heap in `CharacterVectorStore.search`.** The full-array `Array.prototype.sort` with a user comparator was pinning the event loop for minutes at 20k entries × agent-mode sub-turn. Replaced with a hand-rolled min-heap of size `limit` and parallel-arrays (`heapScores[]` + `heapResults[]`) so sift comparisons read a primitive. Small-corpus fallback (< 1000 entries or `limit * 4 >= entries.size`) keeps the linear path for correctness and simplicity.
- **`lastAccessedAt` bumped fire-and-forget on every retrieval.** New `MemoriesRepository.updateAccessTimeBulk` runs one `updateMany` per search (20–60 rows) instead of N round-trips. `searchMemoriesSemantic` calls it on both vector-hit and text-fallback returns, so context builder, proactive recall, first-message context, and `search_scriptorium` all inherit the fix through one injection point. The recent-access component of the protection score is no longer starved of signal.
- **Dimension-mismatch fallback.** If the search-profile embedding and the stored-index embedding have different dimensions, `searchMemoriesSemantic` falls back to text search immediately rather than silently returning zero results.
- **Text-search fallback broadened.** When the full-phrase match returns too few rows, the fallback now searches for individual significant words (stop-word filtered), so multi-word queries don't silently return nothing.

### 10.3 Vector-search infrastructure

- **Float32Array end-to-end.** `blobToEmbedding` returns a `Float32Array` rather than boxing each vector into a `number[]` of doubles. Type flows through every embedding-carrying schema, repository signature, and cosine call site. Four-times-less RAM and tighter JIT loops.
- **Unit-vector normalization at write time.** All stored embeddings are L2-normalized in the single choke-point `generateEmbeddingForUser`. `cosineSimilarity` collapses to a dot product — no per-comparison `Math.sqrt`. Migration `normalize-embeddings-unit-vectors-v1` normalizes existing rows in place (idempotent).
- **Mount-chunk cache.** Document-mount chunk embeddings are cached resident by mount point (`lib/mount-index/mount-chunk-cache.ts`), invalidated on re-embed / delete / reindex. `searchDocumentChunks` reads the cache instead of re-decoding thousands of BLOBs per turn.
- **Embedding BLOB registration at init.** BLOB columns for `memories`, `vector_entries`, and `conversation_chunks` are now registered at DB init time rather than lazily in repositories — fixes the race that occasionally wrote embeddings as JSON text.
- **Chat-related embeddings prioritized.** Memory and conversation-chunk embeddings enqueue at priority 10; mount-chunk and help-doc embeddings at priority 0. Large document-store scans no longer starve real-time chat responsiveness.
- **Embedding-generate OOM fix.** `EMBEDDING_GENERATE` writes directly via `VectorIndicesRepository` instead of loading the entire character vector store into memory — previously, generating one memory's embedding loaded all 12k+ vectors just to insert one row.

### 10.4 Housekeeping — event loop and completion

- **Big loops yield every 500 items.** `await new Promise(setImmediate)` between iterations in both the retention and cap-enforcement passes, so HTTP, SSE, and other jobs get a turn during a long sweep.
- **Paginated corpus read.** Initial memory read uses `findByCharacterIdInBatches(characterId, 250)` — sorted by `id` for a stable boundary. Previously loaded all 19,523 rows through Zod in one synchronous chunk before pass 1's yields could help.
- **Hot-loop logger overhead removed.** `calculateEffectiveWeight` no longer emits a `logger.debug` with seven `.toFixed()` calls per invocation — those fired eagerly regardless of log level and cost ~20k context-object constructions per cap-enforcement pass.
- **O(n²) delete-set lookups → `Set<string>`.** The retention and cap passes used arrays with `.includes()` / `.filter(!includes)` inside per-memory loops — ~380M comparisons in the worst case at 19k rows. Both now use a shared `Set`.
- **Double protection-score computation eliminated.** Pass 1 populates `protectedMap`; pass 3 reads from it instead of recomputing.
- **Cap-enforcement no-op skip.** When every unprotected survivor is already deleted, the O(n) scoring + O(n log n) sort is skipped entirely.

### 10.5 Housekeeping — scheduling and retry

- **15-minute job timeout** specifically for `MEMORY_HOUSEKEEPING` (was 3 minutes). The default stays for other job types.
- **`maxAttempts: 1`** by default for housekeeping. Retries used to re-run the entire sweep from scratch on timeout, including across server restarts — the scheduler re-enqueues naturally anyway.
- **5-minute startup grace** (was 30 s). The first sweep after boot no longer competes with Next.js route compilation and first-page-load requests.
- **Startup tick skips if a recent scheduled sweep completed.** `findRecentByType` on `BackgroundJobsRepository` returns the last `MEMORY_HOUSEKEEPING` job; if it completed within 20h, the startup tick short-circuits. The 24-hour `setInterval` still fires on its own cadence.
- **Watermark backoff on ineffective sweeps.** `lib/memory/housekeeping-outcome-cache.ts` records each sweep's `deleted` / `totalBefore` / `capUsed`. `maybeEnqueueHousekeeping` consults it and skips the post-extraction enqueue when the previous sweep was ineffective — `deleted < max(10, floor(excess × 0.01))` — within the last hour. Scheduled daily sweeps are unaffected.
- **`Run housekeeping now` routes to the sweep-all-characters path.** The button used to POST to `?action=housekeep` which required `characterId` and bounced with a Zod validation error. New `?action=housekeep-sweep` wraps `enqueueMemoryHousekeeping(user.id, { reason: 'manual' })`.

### 10.6 Protection model (the blended score)

- **Four-component blend replaces the `importance ≥ 0.7 = immortal` rule.** `calculateProtectionScore` combines content, reinforcement, graph degree, and recent access (§3.4). The threshold is 0.5.
- **Content half-life 365 → 30 days.** A 30-day-old memory at importance 0.7 drops from ~0.70 to ~0.35 on content alone, at which point the usage bonuses have to actually fire for the memory to stay protected.
- **Content cap at 0.40.** `maxContentContribution` clamps the content component so LLM rating alone can't cross the threshold — a fresh 0.8-importance memory scores `0.40 + 0.08 (default count=1) = 0.48`, just under 0.5. The memory must earn the remaining 0.02+ from usage evidence. Addresses the young-memory half of the problem that the half-life alone couldn't reach (97% of Friday's corpus was < 30 days old).
- **`HousekeepingResult.capUsed`** added so the outcome cache evaluates effectiveness against the exact cap the sweep ran with (per-character override, global cap, or default), not a guess.

### 10.7 Observability

- **Per-phase timing instrumentation on chat-turn context build.** Debug-level logs at the parallel compression + proactive-recall `Promise.all`, `buildMessageContext`, `buildSystemPrompt`, the conversation token-count pass, the memory retrieval + format block (reporting `pre-searched` / `semantic-search` / `skipped`), and the inter-character memory block. `searchMemoriesSemantic` also emits one `[Memory] Semantic search timings` line per call with `embedMs` / `vectorSearchMs` / `hydrateAndRankMs` / `totalMs`. Invisible at the default `info` level; flip to `debug` when chasing a stall.

### 10.8 Net effect on the Friday instance

After all of the above, on the character that originally carried ~20k memories:

- A chat turn's semantic search reports `hydrateAndRankMs: 10–13` at 9k-corpus (and scales with hit count, not corpus size, above that).
- Watermark-triggered housekeeping is actively backing off instead of thrashing the main thread — visible as `[Housekeeping] Skipping watermark sweep — previous sweep deleted zero within backoff window` after every extraction.
- `lastAccessedAt` coverage grew from 13 rows / 17,726 (pre-fix) to a meaningful share of actively-retrieved memories, populated in bulk by every semantic search.
- The scheduled daily sweep will now do real work against the content cap (deleting fresh-but-usage-starved memories) instead of silently skipping everything as immortal.

The user-visible symptom that opened this document — Salon freezes during chat, `TypeError: Failed to fetch` on `/api/v1/session`, first-page-load stalls after restart — no longer reproduces on the corpus that originally demonstrated it.
