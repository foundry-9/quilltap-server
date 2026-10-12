# Memory system refactor — one Commonplace Book, not nine

**Status:** Approved 2026-10-12 — every decision in §7 locked with Charlie the same day. Design only; nothing built yet.
**Owner:** Charlie
**Implementer:** Claude Code (Opus), phase by phase, in the order of §4.
**Scope:** `lib/memory/` (about 11k lines), `lib/chat/context/memory-injector.ts` and the recall
half of `lib/chat/context-manager.ts`, `lib/embedding/vector-store.ts`, `lib/tools/memory-dedup.ts`,
`lib/database/repositories/memories.repository.ts`, the memory job handlers and triggers, the
Memories API, the Memory settings tab, and the `quilltap memories` / `recall-replay` /
`memory-diff` / `anchor-probe` CLI commands.
**Supersedes, once built:** the open items in
[memory-consolidation-and-tiers.md](./memory-consolidation-and-tiers.md) (E2/E3),
[memory-recall-and-housekeeping-fixes.md](./memory-recall-and-housekeeping-fixes.md) (F7 replay),
[commonplace-relevance-fix.md](./commonplace-relevance-fix.md) (F3c, tuning harness) and
[episodic-recall-overhaul.md](./episodic-recall-overhaul.md) (§3 step 2). Those four move to
`complete/` at the end of Phase G with a one-line pointer here.

This is a handoff spec in the manner of
[wardrobe-refactor.md](./complete/wardrobe-refactor.md): a diagnosis, a table of defects to file
first, the work in phases, and what disappears. Line references were verified against the working
tree on 2026-10-12 (`0841000c7`); verify again before editing.

---

## 1. Diagnosis

The Commonplace Book has been built in nine layers since April: the gate, blended protection, the
whisper overhaul, relevance fix, episodic spine, day references, the F1–F9 repairs, recall
retuning, and consolidation with tiers. Each was specified against the symptom it fixed and each
was built well. What none of them supplied, and each re-derived locally, are six abstractions:

1. **A memory candidate.** The thing an extractor produces and the writer accepts is spelled five
   ways — `MemoryCandidate` (`cheap-llm-tasks/types.ts:13`, with three fields nothing ever fills),
   `ExtractedCandidate` (`memory-processor.ts:159`), `FoldEpisode` (`memory-tasks.ts:1203`,
   `narrative` for `content`), `ConsolidationDigestOutput` (`consolidation-tasks.ts:78`) and
   `CreateMemoryOptions` (`memory-service.ts:236`). Importance is defaulted four times on one path,
   once with `||` so a model's 0 becomes 0.5 (`memory-processor.ts:306`). Targeting tags are
   normalised twice and hard-coded once (`fold-episode-pass.ts:138`).

2. **An extraction context.** "Who is in the room, what they already know, what the clock says,
   which model may see this chat" is assembled separately by the per-turn handler, the Carina
   handler, the fold OTHER pass, the fold episode pass, the catch-up sweep and the dry run — with
   different results. The Carina handler forgets the project; the episode pass gets no uncensored
   fallback; the dry run uses a different profile and never folds; the character-hydration loop and
   the project-description lookup are each copied three times (creation map §6, items 9–14).

3. **An admission decision.** The gate decides and writes in one 160-line function whose decider
   has side effects (`resolveColdForAbsorb` promotes rows), whose action enum overloads three
   meanings (`SKIP_NEAR_DUPLICATE` is both ≥ 0.90 and "redirected to a digest"; `INSERT_RELATED` is
   both the band and the date-guard split), and which ignores subject, kind and source — a MANUAL
   candidate can reinforce an AUTO row about someone else. Combining two rows is written three
   times with three `reinforcementCount` semantics: atomic +1 in the gate, an absolute uncapped sum
   in `planMemoryMerge` (the very thing bug 182 removed), and a sum capped at 50 in consolidation.
   Link union is written five times. In the job child the gate cannot see rows it inserted a moment
   ago, so a turn that yields two tellings of one fact inserts both (gate map §7).

4. **A number.** Three quantities travel with a memory — how relevant it is to a query, how much
   it is worth saying, and how much it is worth keeping — and the code computes "worth" **ten
   different ways** (scoring map §1h): the no-floor blend for retrieval, the floored
   `effectiveWeight` for the fallback head, Carina, inter-character and archive fill *and* for
   housekeeping's demotion order, raw `reinforcedImportance` for consolidation, raw `importance`
   for first-message context and every `minImportance` filter, a cosine-only sort in the search
   tool, and a regex "specificity" score in dedup. The comment that says the 0.70 floor must not
   reach ranking (`memory-weighting.ts:104`) sits above four callers that use it for ranking. A
   fresh row stores `reinforcedImportance = importance` while the formula at count 1 gives
   `importance + 0.05`, so the first reinforcement is a step.

5. **A clock.** Event time is resolved on write as a UTC point date (`episodic.ts:126`: "last
   night" → yesterday 00:00Z) and on read as a local window (`day-references.ts`: "last night" →
   18:00–06:00 local). A memory written as "last night" can miss the query "last night". The
   classifier's date-only ranges are UTC days. Three calendars for one question.

6. **A delivery.** What the model was shown is recorded in four inconsistent places: access
   stamps on archive + head + inter-character *before* compression drops lines; the anti-repetition
   ring on the head only and only if the persona whisper posted; the recap never; the tool after
   its own cut. On a continue turn (no new user message) the whole recall bundle is computed,
   posted to the transcript, stamped accessed and written to the ring — and **never sent to the
   model** (`context-manager.ts:2810`, the `trailingOnly` list omits `llmRecallText`). The frozen
   archive is designed for a cached prefix (`frozen-archive-cache.ts:27`) and lands in the trailing
   user message.

Two infrastructural facts make all six worse:

- **The vector index is a second copy with no owner.** `vector_entries` mirrors
  `memories.embedding` with no foreign key and no tier; add-or-update-and-save is written four
  times; `DELETE /memories/[id]` and character archive leave orphan vectors, and an orphan at
  rank 1 blinds the gate's near-duplicate branch (gate map §8). `PUT /memories/[id]` edits content
  without re-embedding. `rebuildVectorIndex` stamps no tier, so cold rows recall as hot until the
  next process restart. Two of the three handlers that embed memories omit the anchor line that
  `episodic.ts:64` calls the single source of truth.

- **Maintenance is two jobs that step on each other.** Housekeeping demotes AUTO rows to cold
  with no `supersededById`; consolidation reads hot rows only; retention deletes superseded rows
  only. A demoted row is therefore never digested and never expires — a third tier in all but
  name. The cap counts MANUAL rows and digests, which are never demotable, so on a mature
  character it is unreachable and the "ineffective sweep" backoff exists to hide that. The
  consolidation vault mirror is written over host-RPC *before* the batch commits; a failed batch
  leaves `Commonplace/*.md` describing digests that do not exist. Per-character and user-wide jobs
  have different dedupe keys and can sweep one character concurrently.

Everything below follows from supplying the six abstractions, giving the index an owner, and
collapsing the two maintenance jobs into one — then deleting what they replace.

### 1.1 What is not broken (leave it)

- The extraction prompts' content (SELF/OTHER categories, importance anchors, the EVENT and
  AGREEMENTS blocks, canon rendering). This spec moves them; it does not rewrite them.
- The consolidation clusterer and planner (`consolidation-clustering.ts`, `consolidation-plan.ts`)
  are pure and tested. They gain a caller, not a rewrite.
- The R1–R4 recall tuning (`cap14`) and its probe set. The refactor must reproduce `cap14`'s
  probe scores exactly before any constant moves (§5).
- The three-state Concierge posture, the refusal ledger, and `resolveConciergeSettings`. Extraction
  asks them; it does not re-derive them.
- The fold summary itself (`context-summary.ts`) and the speaker-name resolver.
- FTS5 message search, compressed text columns, the LLM image budget — adjacent chokepoints, not
  touched.

---

## 2. Defects to file first

Each is verified against source (creation, gate, scoring and maintenance maps, 2026-10-12). File
them in the [bug catalogue](../bugs.md) as **bugs 199–226** before Phase A, one file each, with the
metadata table the catalogue requires. Fix the four marked **first** before any structural work;
the rest are closed by the phase named.

| # | Sev | Defect | Where | Closed by |
|---|---|---|---|---|
| 199 | **High** | A continue turn computes recall, posts the persona whisper, stamps the rows accessed and records them as whispered, but the `trailingOnly` list never carries `llmRecallText`, so the model is given nothing. | `context-manager.ts:2810` | **first** |
| 200 | **High** | `DELETE /memories/[id]` and character archive unlink the row but leave its vector; an orphan at rank 1 makes `bestMemory` undefined, the near-duplicate and reinforce branches are skipped, and the candidate is inserted. | `app/api/v1/memories/[id]/route.ts:132`, `lib/characters/archive-service.ts:764`, `memory-gate.ts:325-393` | **first** |
| 201 | **High** | The chat memory wipe (`DELETE /memories?chatId=`, `MEMORY_REGENERATE_CHAT`) deletes MANUAL rows, cold members and digests alike; the dedup tool reads every tier and source and can delete MANUAL rows and digests, leaving members with a dangling `supersededById`. | `memory-service.ts:1768`, `lib/tools/memory-dedup.ts:168,335` | **first** |
| 202 | Medium | On the per-turn paths entity-anchor hits get no literal boost, so the cosine floor removes verbatim place-name matches the comments say must survive. | `memory-service.ts:1116-1132` vs `:874-879,1006-1011` | **first** |
| 203 | Medium | `PUT /memories/[id]` edits content through raw `updateForCharacter` with no re-embed, no `reinforcedImportance` recompute, no mirror refresh, no archive invalidation. | `app/api/v1/memories/[id]/route.ts:89` | B |
| 204 | Medium | `embedding-generate` and `embedding-refit` embed `summary\n\ncontent` without the anchor line, so repaired rows embed differently from gated ones. | `handlers/embedding-generate.ts:146`, `embedding-refit.ts:94` | B |
| 205 | Medium | `rebuildVectorIndex` adds vectors with no tier, so cold rows pass `isHotVector` until the next `load()`. | `memory-service.ts:1588-1630` | B |
| 206 | Medium | The fold OTHER pass trims its window to the newest 60 messages but advances the watermark to the last message; the older messages are skipped for good. Regenerate inherits it. | `fold-other-pass.ts:194-197,409`, `memory-regenerate-chat.ts:125-130` | D |
| 207 | Medium | The fold episode pass has no watermark and no eligibility filter: a `forceRegenerate` fold re-extracts episodes over the whole history, and the date guard keeps them from being absorbed. | `context-summary.ts:390-393`, `fold-episode-pass.ts` | D |
| 208 | Medium | The consolidation vault mirror is written over host-RPC before the parent commits the batch; a failed commit leaves canon describing phantom digests. | `consolidation.ts:1040`, `commonplace-digest-vault-bridge.ts:71` | F |
| 209 | Medium | In the job child the gate cannot see rows it inserted in the same job: two tellings of one fact in one turn both insert; two `INSERT_RELATED` to one neighbour lose a link; two `REINFORCE` of one row lose footnotes. | `memory-gate.ts:325,352,366,393,704-710,600,666` | C |
| 210 | Medium | The housekeeping cap counts MANUAL rows and digests, which are never demotable; `character-memory-counts` counts all tiers against a hot-only cap. | `housekeeping.ts:222-356`, `route.ts:1003`, `memory-housekeeping-card.tsx:239` | F |
| 211 | Medium | Housekeeping demotes AUTO rows with no `supersededById`; consolidation loads hot rows only and retention deletes superseded rows only, so a demoted row is never digested and never expires. | `housekeeping.ts:378`, `consolidation.ts:348`, `repository:947` | F |
| 212 | Medium | Write-side event time is a UTC point date; read-side day references are local windows; the classifier's date-only ranges are UTC days. "Last night" written misses "last night" asked. | `episodic.ts:126`, `day-references.ts`, `memory-tasks.ts:~1556` | A |
| 213 | Medium | The fold episode pass gets no uncensored fallback, and `UncensoredFallbackOptions.isDangerousChat` is never set on any extraction path, which disables the uncensored retry chain. | `context-summary.ts:556-564`, `memory-processor.ts:418`, `fold-other-pass.ts:626` | D |
| 214 | Medium | The text-search fallback ignores `recallContext`, `occurredWithin`, `entityAnchors`, `extraProbes`, `excludeMemoryIds` and `weightClockMs`; the search tool's time filter is lost on fallback. | `memory-service.ts:1395-1514` | E |
| 215 | Low | The recap's medium bucket filters `reinforcedImportance` after a raw `importance` query; a row with importance 0.65 reinforced to 0.73 lands in no bucket. | `memories.repository.ts:443-470` | A |
| 216 | Low | A fresh row stores `reinforcedImportance = importance`, but the formula at count 1 yields `+0.05`; the first recompute is a step. | `memory-service.ts:520-522`, `reinforced-importance.ts:12` | A |
| 217 | Low | The dispatcher's vector-store invalidation keys `memories.delete` on the memory id (a no-op unload) and omits `memories.bulkDelete`. | `job-dispatcher.ts:762-773`, `job-topics.ts:154` | B |
| 218 | Low | `POST /memories` accepts a client-supplied `source: 'AUTO'` (which turns on the AUTO-only heuristics) and `skipGate`, never sets `witnessedContext: 'manual'` or `projectId`, and returns 201 when the gate reinforced an existing row. | `app/api/v1/memories/route.ts:76-88,491-518` | G |
| 219 | Low | `GET /memories/[id]` bumps `lastAccessedAt`; viewing a memory in the browser earns it the recent-access protection bonus. | `app/api/v1/memories/[id]/route.ts:58` | G |
| 220 | Low | `createMemoryDirect` leaves a row with no embedding when embedding fails — the case `SKIP_EMBEDDING_FAILED` exists to prevent. | `memory-service.ts:579-586` | C |
| 221 | Low | Per-character and user-wide housekeeping jobs have different dedupe keys; a watermark job and the daily sweep can run on one character at once. | `queue-service.ts:619-621`, `memory-service.ts:107` | F |
| 222 | Low | Carina memory extraction omits `projectId`, project description and the context summary, so a Carina answer in a project chat forms a memory with `projectId: null`. | `handlers/carina-memory-extraction.ts:127-144` | D |
| 223 | Low | Manual `?action=consolidate` accepts `clusterThreshold` and drops it: the job payload has no field for it. | `route.ts:983`, `queue-service.ts:650` | F |
| 224 | Low | The inter-character section's top-2 digests per character are the same rows the archive already carries (same SQL order); no section dedups against another. | `context-manager.ts:1756-1858`, `frozen-archive-cache.ts:157` | E |
| 225 | Low | Retention's clock is `updatedAt`, which link rewrites reset; every delete path leaves `consolidatedFrom` pointing at removed ids. | `repository:947`, `memory-gate.ts:770-930` | B |
| 226 | Low | `planMemoryMerge` writes an absolute, uncapped `reinforcementCount` through `updateForCharacter`, the pattern bug 182 removed from the gate. | `memory-merge.ts:118-121` | C |

Not filed, but fixed by the phases that reach them: the dry run's divergence from live extraction
(profile, timestamps, no fold pass, autonomous chats rejected); the `[+]` footnote cap not applied
on merge; `SKIP_NEAR_DUPLICATE` not counted as a reinforcement in job stats; `FoldEpisode.participants`
parsed and ignored; `MemoryChatSettings.conciergePolicy` passed and never read; `batchExtractMemories`,
`needsHousekeeping`, `handleInterCharacterMemory`, `deleteForCharacter`, `deleteBySourceMessageId`,
`deleteByChatId` dead; `memoryExtractionConcurrency` and `chat_settings.memoryExtractionLimits`
dead; `mergeSimilar` / `autoMergeSimilarThreshold` settable everywhere and read nowhere.

---

## 3. Target shape

```
lib/memory/
  index.ts                 public barrel (unchanged import path for callers)
  settings.ts              resolveMemorySettings(): one typed read of every memory knob
  candidate.ts             MemoryCandidateSchema — the one shape every producer emits
  time/                    MemoryClock: event-time resolve (write) and window resolve (read)
  scoring/                 relevance · salience · protection — one function each
  index-store/             MemoryIndex: the only writer of embeddings and tiers, any process
  admission/               decideAdmission (pure) · admitCandidate (parent) · foldInto (one combine)
  extraction/              ExtractionContext · passes (self-turn, other-turn, other-fold, episode-fold)
  recall/                  gather → hydrate → score → select → assemble → render → deliver
  maintenance/             one MEMORY_MAINTENANCE job: consolidate · demote · retire · mirror
  retire.ts                retireMemories(): the one deletion chokepoint
```

The public names below are the contract. Internal file layout within a folder is the
implementer's; the folder boundaries and the "only caller" rules are not.

### 3.1 `settings.ts` — one read

```ts
export interface MemorySettings {
  extraction: { limits: MemoryExtractionLimits; mode: MemoryExtractionModeSettings };
  admission:  { nearDuplicate: 0.90; reinforce: 0.85; related: 0.70; dateGuardDays: 7; footnoteCap: 8 };
  recall:     MemoryRecallSettings & { tuning: RecallTuning; minCosine: { neural: 0.30; tfidf: 0.10 } };
  maintenance: {
    enabled: boolean;                       // memoryMaintenance.enabled
    capFor(characterId: string): number;    // override → perCharacterCap → 2000; one resolver
    consolidation: MemoryConsolidationSettings;
    coldRetentionDays: number | null;
  };
}
export async function resolveMemorySettings(userId: string): Promise<MemorySettings>;
```

- **Every memory knob lives in `instance_settings`.** The façade reads `memoryRecall`,
  `memoryConsolidation`, `memoryExtractionMode`, `memoryExtractionLimits` and a new
  **`memoryMaintenance`** key (`{ enabled, perCharacterCap, perCharacterCapOverrides }`,
  `MemoryMaintenanceSettingsSchema` in `settings.types.ts`, accessors in `lib/instance-settings`).
  Migration `move-memory-maintenance-settings-v1` copies `chat_settings.autoHousekeepingSettings`
  for `SINGLE_USER_ID` into the key (dropping `mergeSimilar` / `autoMergeSimilarThreshold` on the
  way), then drops the column; precedent is `migrate-extraction-knobs-to-instance-settings-v1`.
  `?action=housekeeping-config` becomes `?action=maintenance-config`; the Almanack ledger
  (`phase3-ledgers.ts:638`) and the settings card read the key. `memoryCascadePreferences` stays
  where it is. Every default lives once, in the Zod schema's `.default()`. The six copies of the housekeeping defaults (`settings.types.ts:733`,
  `chat-settings.repository.ts:171`, `route.ts:768/789`, `memory-housekeeping-card.tsx:28`,
  `phase3-ledgers.ts:638`, `housekeeping.ts:98`) and the three of `memoryExtractionLimits`
  collapse onto it; the UI imports `MEMORY_SETTING_DEFAULTS` from a client-safe module.
- `capFor(characterId)` is the one cap resolver (override → `perCharacterCap` → 2000); the copies
  in `memory-service.ts:72` and `memory-housekeeping.ts:64` go, and the manual maintain action
  honours overrides like the sweep does.
- The admission thresholds stop being exported constants scattered across `memory-gate.ts`,
  `anchor-gate-probe.ts` and the dedup route (0.80). They are not user-settable; they are here so
  there is one place to read them.
- **Removed:** `mergeSimilar`, `autoMergeSimilarThreshold`, `HousekeepingOptions.mergeThreshold`
  / `userId` / `embeddingProfileId`, `HousekeepingResult.merged` / `mergedIds`,
  `memoryExtractionConcurrency` (and its API action and `memory-diff` read), the legacy
  `chat_settings.memoryExtractionLimits` column. The same migration drops that column and the
  dead key; pretty label in `lib/startup/prettify.ts`; no loop, so no `reportProgress`.
- The cap bounds differ three ways today (10–10,000 / 1–100,000 / 100–100,000). One Zod bound,
  100–100,000, on the schema; the API and the dialog validate through it.

### 3.2 `candidate.ts` — one shape

```ts
export const MemoryCandidateSchema = z.object({
  content: z.string().min(1),
  summary: z.string().min(1),
  keywords: z.array(z.string()).default([]),      // free words; targeting tags are NOT here
  targeting: TargetingTagsSchema,                 // { temporal, scope, context } — always present
  importance: z.number().min(0).max(1),           // parser default 0.5 is the ONLY default
  kind: MemoryKindEnum,
  when: z.string().nullable(),                    // model's phrase; resolved by MemoryClock
  entities: z.array(z.string()).max(12).default([]),
  subject: z.object({ holderId: UUID, aboutId: UUID.nullable() }),
  provenance: z.object({
    source: MemorySourceEnum,                     // AUTO | MANUAL | CONSOLIDATED
    witnessedContext: WitnessedContextEnum,
    chatId: UUID.nullable(), projectId: UUID.nullable(),
    sourceMessageId: UUID.nullable(),
    anchorTimeMs: z.number(),                     // the message clock the clock resolves `when` against
    pass: z.enum(['self-turn','other-turn','other-fold','episode-fold','carina','manual','consolidation','import']),
  }),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
```

- `MemoryCandidate` (cheap-llm-tasks), `ExtractedCandidate`, `FoldEpisode`,
  `ConsolidationDigestOutput`'s digest shape and `CreateMemoryOptions` all become this or a
  thin, typed view of it. `applyTargetingTags` and `consolidation-plan.ts:201-242` become one
  `normaliseTargeting` in this module; the episode pass's hard-coded tags become a `targeting`
  value. `temporal` / `scope` / `context` stop riding inside `keywords` on the candidate; the
  **row** keeps storing them in `keywords` as today (no schema change, the whisper and
  `parseTargetingTags` still read them there) — `toMemoryRow(candidate, resolved)` writes them in.
- The row-side `Memory` schema is unchanged in Phase A. One column is added in Phase B (§3.5).

### 3.3 `time/` — one clock

```ts
export interface MemoryClock { timeZone: string; nowMs: number }
export function clockFor(chat: Pick<Chat,'timelineMode'>, instance: InstanceSettings, nowMs?): MemoryClock;
export function resolveEventTime(phrase: string | null, anchorMs: number, clock): { occurredAt: string | null; window: TimeWindow | null };
export function resolveReferenceWindow(text: string, clock): TimeWindow | null;   // read side
export const DAY_REFERENCE_TABLE: ReadonlyArray<DayReferenceRule>;                 // the one table
```

- One rule table drives both directions. "Last night" on write stamps `occurredAt` at the
  **start of the same local window** the read side will ask for; "last week" is the previous
  local calendar week on both sides. The classifier's date-only `timeRange` is normalised to a
  local day in the chat's timezone, not UTC.
- **One calendar per instance:** instance `timezone` (`settings.types.ts:848`) →
  `QUILLTAP_TIMEZONE` → system. The per-chat `timezone` field (`settings.types.ts:102`) stays
  display-only and is **not** consulted for memory time; `clockFor` takes the instance settings
  and the chat's `timelineMode` only.
- `episodic.ts:126` (`resolveWhenPhrase`), `episodic-anchors.ts`, `day-references.ts` and the
  three anchor-resolution sites in the creation map (item 15) collapse here. `narrativeTime` is
  carried through untouched; `ExtractionClock.narrativeNow` (never assigned) is deleted.
- Backfill: none. Existing `occurredAt` values stay; the read window now has a local calendar and
  will mostly include them. Document the one-day skew for pre-refactor rows in the help page.

### 3.4 `scoring/` — three numbers, one function each

```ts
export function relevance(cosine: number): number;                                   // identity; named so it is greppable
export function salience(m: MemoryLike, clock: { nowMs: number }): SalienceBreakdown; // worth saying
export function protection(m: MemoryLike, clock): ProtectionBreakdown;               // worth keeping
export function reinforcedImportance(importance: number, count: number): number;     // stored column
export function rankForRecall(cands: ScoredCandidate[], ctx: RecallContext, tuning: RecallTuning): RankedCandidate[];
```

- **`reinforcedImportance(i, n) = min(1, i + log2(n) × 0.05)`** — `n = 1` gives `i`, so a fresh
  row and a recomputed one agree (bug 216). Migration `recompute-reinforced-importance-v1`
  rewrites the column for every row (`reportProgress` per 500 rows; pretty label). The repository's
  atomic `incrementReinforcement` uses the same function.
- **`salience`** = `reinforcedImportance × 0.5^(daysSince(max(createdAt, lastReinforcedAt)) / 30)`,
  **no floor**. This is today's `rawWeight`. It is the *only* "worth" used for ordering anything
  a model will see: the recall blend (`0.75 × relevance + 0.25 × salience`, unchanged), the
  fallback head, Carina, inter-character, archive fill, recap bands, first-message context, the
  search tool's final sort. `calculateEffectiveWeight` and its 0.70 floor are deleted; nothing
  needs them once protection has its own function.
- **`protection`** is today's `calculateProtectionScore` unchanged in formula (content ≤ 0.40,
  reinforcement ≤ 0.25, graph ≤ 0.10, recent access +0.10, episodic +0.10; threshold 0.5),
  **and it is also the demotion order**: maintenance demotes the lowest protection first, so the
  thing that decides whether a row may go also decides which goes first (bug-adjacent: today
  pass 3 orders by the floored weight and ignores every usage signal protection counts).
  `source ∈ {MANUAL, CONSOLIDATED}` returns `protected: true` with score 1.
- **Importance filters** (`minImportance`) compare `reinforcedImportance`, everywhere. The
  per-path values collapse to two named constants: `RECALL_MIN_IMPORTANCE = 0.3` (every prompt
  path: head, proactive, inter-character, Carina, voice-rewrite, replay) and `0` for the tool
  and the API. The fallback head's 0.5 and the inter-character 0.5 go.
- `rankForRecall` is `combineRecallMultipliers` + the blend + R6, moved, with one copy of the
  tuning defaults (`recall-tuning.ts:67` and `recall-tags.ts:289` become one). The multiplier
  table, the R1 gate and R2 cap are **unchanged** (§5 pins them).
- Deleted: `calculateEffectiveWeight`, `rankMemoriesByWeight` (one caller, the optimizer, which
  switches to `salience`), `reinforced-importance.ts` (moves here), the dedup tool's
  `scoreMemory`, the two copies of the 1.3 window boost (`conversation-summary-search.ts` imports
  `RECALL_MULTIPLIERS.occurredWithinWindow`), the two copies of the recap ramp constants, and the
  search tool's own 0.7 / 0.4 importance labels (it uses the repository's 0.7 / 0.3 tiers via one
  `importanceBand()` helper).

### 3.5 `index-store/` — the index gets an owner

```ts
export interface MemoryIndex {
  search(characterId, vector, opts: { limit; hotOnly: boolean; exclude?: Set<string> }): Promise<VectorHit[]>;
  upsert(characterId, entries: Array<{ id; embedding; tier }>): Promise<void>;
  setTier(characterId, ids, tier): Promise<void>;
  remove(characterId, ids): Promise<void>;
  reload(characterId): Promise<void>;          // drop the in-process copy; next search reloads from rows
}
export const memoryIndex: MemoryIndex;          // process singleton, parent or child
export function embeddingTextFor(m: Pick<Memory,'summary'|'content'|'occurredAt'|'narrativeTime'|'entities'>): string;
```

- **`memories.embedding` + `memories.tier` are the source of truth; `vector_entries` is retired
  for memories.** The in-process `CharacterVectorStore` loads `SELECT id, embedding, tier FROM
  memories WHERE characterId = ? AND embedding IS NOT NULL` (one query; `blobToFloat32` per row
  as today), and tier rides with the vector so `findColdIdsByCharacterId` stamping, `setTier`
  drift and the `rebuildVectorIndex` tier gap (bug 205) cease to exist. Check first that nothing
  but memories uses `vector_entries` (as of 2026-10-12 nothing does: `reapply-profile.ts`,
  `reconcile-embedding-dimensions.ts`, `repair-text-embeddings.ts`, backup/restore and six
  historical migrations). Migration `retire-memory-vector-entries-v1`: verify every
  `vector_entries` row has a matching `memories.embedding` (copy where the row is null — the
  table was the mirror, but be safe), then `DROP TABLE vector_entries`; `reportProgress` over the
  verify loop. Backup writes no `vector_entries.json`; restore ignores one from an older archive;
  `delete-service.ts` and the `VectorIndicesRepository` go. DDL.md and the backup docs change.
- **Every write of an embedding or a tier goes through `memoryIndex`.** The four
  add-or-update-and-save copies (`memory-gate.ts:496`, `memory-service.ts:677`,
  `consolidation.ts:578`, `embedding-generate.ts:173`), the three per-character removal loops
  (`memory-service.ts:1660,1730,1786`), `vectorStore.setTier` in housekeeping, and
  `embedding-generate`'s direct `VectorIndicesRepository` write all become one call. The
  repository's `updateForCharacter({ embedding })` is no longer called by anyone but
  `memoryIndex.upsert` — enforce with an ESLint `no-restricted-syntax` rule or a unit test that
  greps, as the `qt-*` gate does.
- `embeddingTextFor` is the one text (`buildMemoryEmbeddingText` moved); `embedding-generate`,
  `embedding-refit`, `reapply-profile` and the admission path call it (bug 204).
- **Child process:** the child's `memoryIndex` is read-only (it may load and search for
  consolidation clustering and the dry run); `upsert` / `setTier` / `remove` in the child throw.
  Writes reach the index through the parent — admission over host-RPC (§3.6) or the batch commit
  hook, which calls `memoryIndex.reload(characterId)` for every character whose `memories` rows a
  batch touched. The dispatcher's `WRITES_INVALIDATING_VECTOR_STORE` method list and
  `firstIdArg` go; the proxy records touched characterIds on every `memories.*` write
  (`characterId` is the first argument of every write method on `MemoriesRepository` — make that
  a stated invariant and a test).
- The `VectorStoreManager`'s unmemoised first load (two instances on concurrent first use) is
  fixed in passing: memoise the load promise.

### 3.6 `admission/` — decide, then apply, in the parent

```ts
export type AdmissionAction =
  | { kind: 'insert' }
  | { kind: 'insert-linked'; linkTo: string[]; reason: 'band' | 'date-guard' }
  | { kind: 'reinforce'; into: string; withFootnotes: boolean }     // 0.85–0.90, same occasion
  | { kind: 'absorb'; into: string; redirectedFrom?: string }        // ≥ 0.90, or 0.85+ redirected to a digest
  | { kind: 'promote-and-reinforce'; into: string }                  // cold, unsuperseded neighbour
  | { kind: 'reject'; reason: 'embedding-failed' | 'subject-mismatch' | 'empty' };

export function decideAdmission(input: {
  candidate: MemoryCandidate; embedding: Float32Array;
  neighbours: Array<Memory & { cosine: number }>;                   // top-K, both tiers, hydrated
  thresholds: MemorySettings['admission']; clock: MemoryClock;
}): AdmissionAction;                                                 // PURE — no I/O, no writes

export async function admitCandidate(candidate: MemoryCandidate, opts: { userId; embeddingProfileId?; dryRun? }): Promise<AdmissionOutcome>;
export function foldInto(survivor: Memory, absorbed: Array<Pick<Memory, …>>, caps): FoldPlan;   // PURE — the one combine
```

- **`decideAdmission` is pure.** It takes the neighbours already hydrated and returns a value.
  Promotion of a cold row is an *action*, not a side effect of deciding. The date guard inspects
  every neighbour ≥ 0.85, not only rank 1. Neighbours are filtered to the candidate's **subject
  bucket** (`holderId`, `aboutId`) and **kind** before thresholds apply, and a MANUAL candidate
  never reinforces or is absorbed into an AUTO row (it inserts and links). Digest neighbours are
  reached by following `supersededById` up to 3 hops once, in the hydration step, so the decider
  sees the digest as the neighbour.
- **`admitCandidate` runs in the parent.** From the job child it is a host-RPC method
  (`admitMemory`), beside `writeCommonplaceDigestsToVault` in `host-rpc-dispatcher.ts`. The child
  still does the expensive part (LLM extraction, embedding); the parent does top-K search, hydrate,
  decide, write, index update — a few milliseconds per candidate against a real read-your-writes
  connection and the atomic `incrementReinforcement`. This closes bug 209 outright, deletes
  `patchMemory`'s null-vs-undefined dance, `countReinforcement`'s local view, the NaN-count guards,
  and the buffered-`create` id injection for memories. Realtime `memories` is published by the
  parent in `admitCandidate` as today's chokepoints do.
- **`foldInto` is the one combine.** Reinforce (gate), near-duplicate fold (maintenance, §3.9) and
  consolidation's member merge all call it: footnotes capped at 8 against the growing content,
  `reinforcementCount` as a **delta** applied through `incrementReinforcement(by: n)` (extend the
  repository method with a count; cap 50 for digests stays where consolidation applies it),
  entities unioned ≤ 12, links unioned minus the group, earliest `occurredAt`, latest
  `lastReinforcedAt`, `reinforcedImportance` from §3.4. It replaces `reinforceMemory`'s body,
  `planMemoryMerge` / `applyMemoryMerge` (`memory-merge.ts` deleted) and the per-merge code in
  `memory-dedup.ts` (deleted, §3.9). Re-embedding after a fold is one call to `memoryIndex.upsert`.
- `createMemoryDirect` is deleted. Import, restore and consolidation's digest writes use
  `repos.memories.create` + `memoryIndex.upsert` explicitly and are the only non-admission
  inserts; the API's `skipGate` goes (bug 218).
- `AdmissionOutcome` carries the action, the resulting row, and a trace (`neighbours`, `cosines`,
  thresholds hit) that the extraction debug log stores instead of the ad-hoc strings
  `writeCandidate` builds today.

### 3.7 `extraction/` — one context, four passes, one writer

```ts
export interface ExtractionContext {
  chat: Chat; clock: MemoryClock; settings: MemorySettings['extraction'];
  cast: Map<string, CastMember>;             // every seat incl. the user character; hydrated once; raw reads
  canonFor(holderId, aboutId | null): Promise<CanonBlock>;   // memoised per context
  project: { id: string | null; description: string | null };
  route: { cheapLLM: CheapLLMSelection; uncensoredFallback: UncensoredFallbackOptions | null };  // Concierge-resolved ONCE
  rateLimit: RateLimiter;                    // live counter, not a snapshot; counts admissions as they land
  dryRun: boolean;
}
export async function buildExtractionContext(chatId, userId, opts: { dryRun?; connectionProfileId? }): Promise<ExtractionContext>;

export interface ExtractionPass {
  name: 'self-turn' | 'other-turn' | 'other-fold' | 'episode-fold';
  window(ctx, cursor: ExtractionCursor): TranscriptWindow;        // one renderer, one speaker map, one truncation rule
  prompt(ctx, window, holder, subjects): PromptParts;             // existing bodies, moved
  parse(raw: string, cap: number): MemoryCandidate[];             // one parser family → MemoryCandidateSchema
}
export async function runPass(pass, ctx, cursor): Promise<PassResult>;  // extract → cap → floor → admit (or collect)
```

- **One context per unit of work.** The per-turn handler, the Carina handler, the fold (both
  passes), the catch-up sweep, regenerate and the dry run call `buildExtractionContext` and hand
  it to `runPass`. The three cheap-LLM-config builders, three hydration loops, two project
  lookups, two speaker maps, two "last stamped message" clocks and five turn-opener scans
  (creation map, items 9–13) collapse into it. Carina gets the project (bug 222); the episode pass
  gets the uncensored fallback and `isDangerousChat` is set on it (bug 213).
- **Dry run is the same pipeline with `dryRun: true`**: same profile resolution, same
  timestamps, same fold passes, autonomous chats included; `admitCandidate` with `dryRun`
  decides and returns without writing. `memory-diff` therefore reports what live would do.
- **Caps are one rule per pass:** `cap = min(HARD_CANDIDATE_CAP, resolveMaxMemories(tokens))`
  (+1 event slot when the pass promises it — and then the writer honours it; today the fold pass
  truncates the slot it promised). The fold cap is budget-clamped like the turn cap.
- **Cursors, not watermarks by hand.** `ExtractionCursor` = `{ chatId, pass, afterMessageId }`,
  stored in a small `memory_extraction_cursors` table (`chatId, pass, messageId, updatedAt`;
  migration `add-memory-extraction-cursors-v1`, pretty label, backfills `other-fold` from
  `chats.otherExtractionWatermarkMessageId` and then drops that column). A pass advances its
  cursor only past messages its window actually covered; a window wider than
  `FOLD_OTHER_MAX_WINDOW_MESSAGES` is processed in consecutive slices, each advancing the cursor
  (bug 206). The episode pass gets a cursor (bug 207) and the same eligibility filter.
- **`createdAt` is the write clock on every path; `occurredAt` is the event.** The fold episode
  pass stops back-dating `createdAt` (`fold-episode-pass.ts:143`); import and restore preserve the
  row's own `createdAt`. The rate limiter counts admissions it saw, not `countCreatedSince`.
- The `MEMORY_EXTRACTION` job's payload gains `pass` and `cursor`; the `INTER_CHARACTER_MEMORY`
  type and its empty handler are deleted; `triggerTurnMemoryExtraction`'s unread `conciergePolicy`
  / `isDangerousChat` fields go; `batchExtractMemories` goes.
- Prompts: `memory-tasks.ts` (1,600 lines) splits into `extraction/prompts/{self,other,episode}.ts`
  and `extraction/parse.ts`. Bodies unchanged. The search-keyword distiller
  (`extractMemorySearchKeywords`) moves to `recall/query.ts`; `cheap-llm-tasks/memory-tasks.ts`
  is left with nothing and deleted. `lib/memory/index.ts` keeps exporting the public names.

### 3.8 `recall/` — a pipeline with a trace

```
query.ts      buildRecallQuery(turn) → { text, embedding (captured once), signals, probes, anchors, window }
gather.ts     vector top-K (+probes, +anchors) ∪ text-fallback → RawHit[]          ← fallback is a gather strategy
hydrate.ts    findByIds, tier/kind/subject filters, digest redirect
score.ts      relevance · salience · multipliers (scoring/rankForRecall)
select.ts     floor · window (hard/soft, R6) · related-expansion · budget cut
assemble.ts   pools: archive · head · interCharacter · recap · conversations; cross-pool dedup; one query embedding
render.ts     the section text (today's formatters, minus debug labels)
deliver.ts    RecallDelivery: what actually reached the model → accessed stamps · anti-repetition ring · debug log
```

- **`searchMemoriesSemantic` (500 lines) becomes the first five stages**, each a pure function
  over the previous stage's output plus a `RecallTrace` entry. The text fallback is a `gather`
  strategy that yields the same `RawHit` shape, so floor, window, multipliers, expansion and
  reserve apply to it too (bug 214). The tool, the API search and the replay harness call the same
  stages with different options; `includeCold` and `aboutCharacterId` are hydrate filters.
- **One embedding per turn.** `buildRecallQuery` embeds once; the head, the inter-character
  relevance half (today one re-embed per present character, `context-manager.ts:1756-1858`), the
  per-turn conversation summaries and the retrospective probes reuse it. The inter-character
  relevance half becomes a filter of the same gathered pool by `aboutCharacterId`, not N searches.
- **`assemble` dedups across pools**: a row appears in at most one of archive / head /
  inter-character / recap (bug 224). The archive keeps its composition (digests per present
  character, self digests, salience fill) and id-sort; its size is fixed per compaction generation
  (the retrospective flag no longer changes its token budget — the head borrows from the
  remainder instead).
- **`deliver` is the only writer of "what was shown".** It runs **after** Phase-2 compression and
  after the request body is assembled, with the ids whose lines survived; it stamps
  `lastAccessedAt`, appends the anti-repetition ring (head ids), and writes the debug record. A
  continue turn delivers the bundle in the trailing section like any other turn (bug 199). Carina,
  voice-rewrite, first-message and the tool call `deliver` with their own bundle; the Memories
  API search stamps nothing; the recap stamps what it rendered.
- **Debug labels leave the model's text.** `[m_abcd]`, `recall: past↓ cap1.4 gate×0.50`,
  `importance 0.80 · relevance 0.61 · weight 0.42` and the raw targeting tags
  (`scope: narrow`) are moved to `debugMemories` only. The model sees the age tag, the subject
  prefix, the summary, the provenance count and the human keywords. (This changes whisper bytes;
  the section is trailing, so no prefix-cache cost. Golden tests for the renderer are rewritten.)
- `memory-injector.ts` (823 lines) becomes `render.ts` + `assemble.ts`; the ~1,300 recall lines in
  `context-manager.ts` become one call: `const recall = await assembleRecall(plan)` … `await
  deliverRecall(recall, survivingIds)`. `frozen-archive-cache.ts`, `conversation-summary-search.ts`,
  `recall-history.ts`, `recall-tags.ts` (the multiplier table and `buildTurnRecallContext`),
  `memory-recap.ts` (the fetch half; the narrative call stays a cheap-LLM task) and
  `memory-subject.ts` move under `recall/`.
- **The replay harness measures the whole thing.** `recall-replay.ts` runs `buildRecallQuery` →
  `assemble` with an `asOf` clock, a pinned participant set, and the anti-repetition ring *as of
  that turn* (reconstructed from the chat's message `debugMemoryLogs`), and reports the trace per
  stage: what the archive removed, what the budget cut, what inter-character took, what the
  fallback path would have done. The probe set and `cap14` scores become a fixture
  (`__tests__/fixtures/recall-probes/`) and a test that asserts the shipped tuning reproduces them.

### 3.9 `maintenance/` — one job, ordered phases, parent-side ledger

```ts
export type MaintenancePhase = 'fold-near-duplicates' | 'consolidate' | 'demote' | 'retire' | 'mirror';
export interface MaintenanceRequest { characterId: string; phases: MaintenancePhase[]; reason: 'scheduled' | 'watermark' | 'manual'; dryRun?: boolean; settings?: Partial<…> }
export async function runMaintenance(req, ctx): Promise<MaintenanceReport>;   // the child; pure planning + buffered writes
```

- **One job type, `MEMORY_MAINTENANCE`**, replaces `MEMORY_HOUSEKEEPING` and
  `MEMORY_CONSOLIDATION` (both enums and handlers deleted; the dispatcher's `topicsForCompletedJob`,
  `invalidateFrozenArchivesForCompletedJob` and `checkConsolidationWatermarkAfterCommit` learn the
  one type). Dedupe key is `characterId` only; a user-wide sweep enqueues one job per character
  (so the daily sweep and a watermark job can never overlap on a character — bug 221). One
  scheduler (`maintenance/scheduler.ts`) owns the daily tick, the startup grace, the "ran within
  20 h" skip and the 30-minute post-consolidation delay, which becomes simply phase order.
- **Phases run in this order, each skippable by settings:**
  1. **`fold-near-duplicates`** — deterministic, LLM-free: pairs ≥ 0.90 in the same subject bucket
     and kind, both AUTO, hot, non-digest, same occasion (date guard) → `foldInto`. This is what
     the dedup tool becomes (the tool, its O(n²) scan, its own survivor score and the 0.80 default
     are deleted; the settings card calls this phase, with dry run). It never touches MANUAL,
     digests or cold rows (bug 201).
  2. **`consolidate`** — today's `runConsolidation`, with these changes: candidates are hot AUTO
     rows **and cold rows demoted by cap pressure** (`supersededById IS NULL`, bug 211), so
     demotion feeds consolidation instead of stranding rows; `clusterThreshold` rides in the
     request (bug 223); canon for the self bucket includes `Commonplace/Self.md` like the
     extractor's does (today `consolidation.ts:465` uses the card-only loader).
  3. **`demote`** — the cap applies to **demotable** rows only (hot, AUTO, non-digest); the report
     carries `hotTotal`, `demotable`, `protected` separately (bug 210). Order is `protection`
     ascending (§3.4). Retention-by-age (today's pass 1) is the same pass with the age/inactivity
     predicate folded into protection's content term; its three never-persisted knobs
     (`maxAgeMonths`, `maxInactiveMonths`, `minImportance`) are dropped from the API and dialog.
  4. **`retire`** — cold + superseded + AUTO + older than `coldRetentionDays` by
     `supersededAt` (new column, set when a row goes cold — not `updatedAt`, bug 225) →
     `retireMemories`.
  5. **`mirror`** — the Commonplace vault files for touched buckets.
- **All effects after commit.** The child returns the report; the parent's commit hook (the one
  place: `job-dispatcher.ts`'s post-commit path) applies `memoryIndex.reload`, invalidates the
  frozen archives, publishes `memories`, writes the vault mirror (bug 208 — the mirror no longer
  goes over host-RPC from the child), records the outcome in the **parent-side** ledger, and runs
  the consolidation watermark check. `housekeeping-outcome-cache.ts` (child map) and the
  consolidation debounce map (parent) become one `maintenance/ledger.ts` keyed by character,
  holding last run per phase, last effectiveness, and the debounce — in the parent, where every
  trigger decision is made. `maybeEnqueueHousekeeping`'s two throttles and
  `consolidation-triggers.ts`'s two throttles become one `shouldEnqueue(characterId, reason)`.
- The two paged load-and-yield loops become one `loadCorpus(characterId, { tiers, sources,
  pageSize: 250 })` async iterator in `maintenance/corpus.ts`.
- `getHousekeepingPreview` and `needsHousekeeping` go; preview is `dryRun: true`.

### 3.10 `retire.ts` — one deletion

```ts
export async function retireMemories(ids: string[], opts: { reason: RetireReason; keep?: 'manual' }): Promise<RetireReport>;
```

- Extends `deleteMemoriesWithUnlinkBatch` and is the **only** caller of
  `repos.memories.bulkDelete`. It scrubs `relatedMemoryIds` (as today), **and** `consolidatedFrom`
  on surviving digests, **and** `supersededById` on surviving members of a deleted digest (they
  become cap-demoted cold rows, which §3.9 consolidation will re-digest), removes vectors through
  `memoryIndex.remove`, invalidates frozen archives and publishes `memories` — in the parent; from
  the child it buffers and the commit hook does the effects.
- Callers: the item DELETE route, chat wipe (which now passes `keep: 'manual'` — regenerate never
  destroys a hand-written row; a digest whose `consolidatedFrom` empties is retired with its
  members, bug 201), message and swipe cascades, cascade-delete, character archive (bug 200),
  restore's delete service, the `retire` phase. `deleteMemoryWithUnlink`,
  `deleteMemoryWithVector`, the three `deleteMemoriesBy*WithVectors`, and the repository's unused
  `delete`, `deleteForCharacter`, `deleteBySourceMessageId`, `deleteByChatId` are deleted.
  `MemoriesRepository.bulkDelete` is renamed `bulkDeleteUnsafe` so a grep finds any new caller.
- The CLAUDE.md chokepoint line for memory deletion is rewritten to name this function.

### 3.11 Operator surfaces

- **Memories API.** `POST /memories` forces `source: 'MANUAL'`, sets `witnessedContext:
  'manual'`, takes `kind` / `when` / `entities` / `projectId`, drops `skipGate`, and returns the
  admission outcome: 201 with the row on insert, 200 with `{ action, memory }` otherwise (bug 218).
  `PUT /memories/[id]` goes through a new `updateMemory(characterId, id, patch)` in `admission/`
  that re-embeds when text or anchors change, recomputes `reinforcedImportance` when importance
  changes, validates `relatedMemoryIds` (must exist, same character) and writes them
  bidirectionally, then invalidates (bug 203). `GET /memories/[id]` stops stamping access (bug
  219). `?action=housekeep`, `housekeep-sweep`, `consolidate`, `extraction-concurrency` become
  `?action=maintain` (`{ characterId?, phases?, dryRun?, settings? }`) and
  `?action=maintenance-status`; `housekeeping-config` becomes `maintenance-config` and the five
  `*-config` actions validate through the façade's schemas. `system/tools?action=memory-dedup` is removed (its card calls `maintain` with
  `phases: ['fold-near-duplicates']`).
- **Settings tab.** The housekeeping, consolidation and dedup cards become one **Maintenance**
  card with per-phase toggles, "Run now" (per character or all) with dry run, the ledger's last
  outcome per phase, and the per-character cap overrides. Extraction grain and recall cards stay;
  the extraction-limits knobs (API-only today) get a small section on the extraction grain card.
  Defaults come from `MEMORY_SETTING_DEFAULTS`. The memory list's over-cap check compares
  demotable count to the cap. The housekeeping dialog on the character page becomes the same
  Maintenance dialog.
- **CLI.** `quilltap memories` gains `maintain --character <name> [--phases …] [--dry-run]`
  (replacing `consolidate`), and `validate` gains `--repair` (dangling `relatedMemoryIds`,
  `consolidatedFrom`, `supersededById`, rows without embeddings → enqueue). `db memories` gains
  `--tier`. `recall-replay` prints the stage trace. `anchor-probe` reads thresholds from the façade.
  Bump `packages/quilltap`'s version; it publishes at release.
- **Help.** `help/memory-housekeeping.md`, `memory-consolidation.md` and the dedup paragraph
  merge into `help/memory-maintenance.md` (`url: /settings?tab=memory&section=memory-maintenance`,
  In-Chat Navigation block); `memory-recall-relevance.md` loses the "same formula as retrieval"
  claim (it was false) and gains a paragraph on delivery; `episodic-memory.md` gets the local
  calendar note; `cli-memories.md` the new verbs. Voice per CLAUDE.md.

---

## 4. The work, in order

**One PR per phase, merged to main.** Each phase keeps every public name working so main stays
releasable between phases; each ends with `npx tsc`, `npm run lint`, the memory unit suites, the
probe-set fixture test (from Phase E on), and a V4test walkthrough of the surfaces named. Each phase
has its own CHANGELOG entry (plain voice). Friday upgrades no earlier than after Phase B, and only
after a backup.

### Phase 0 — file the bugs; fix 199, 200, 201, 202 as they stand

Small, local fixes on the current code (they would otherwise be carried through every phase):
deliver recall on continue turns; remove the vector on item delete and character archive; make
the chat wipe and the dedup tool skip MANUAL rows, digests and cold rows; apply the literal boost
to entity-anchor hits on the per-turn paths (or exempt them from the floor — whichever the
comment at `memory-service.ts:874` intends; read it and pick). Tests for each.

### Phase A — the three numbers, the clock, the candidate, the façade

- `settings.ts`, `candidate.ts`, `time/`, `scoring/` as in §3.1–3.4.
- Migrations: `recompute-reinforced-importance-v1`, `move-memory-maintenance-settings-v1`.
- Every ranking consumer switches to `salience`; every `minImportance` to `reinforcedImportance`
  and the two named constants; `calculateEffectiveWeight` deleted. The recap's band query becomes
  one `reinforcedImportance` predicate (bug 215).
- Write-side `when` and read-side references both go through `MemoryClock` (bug 212).
- Tests: scoring formulas pinned (a table of inputs → outputs for all three), the clock's
  rule table in both directions on a fixed timezone, candidate schema round-trips for each
  producer, the façade's defaults equal the Zod defaults, a grep-test that no file but
  `scoring/` mentions `effectiveWeight`.
- **Acceptance:** `recall-replay` on the probe set reproduces `cap14` exactly (the blend already
  used `rawWeight`; only the fallback head, Carina, inter-character and archive fill change order,
  and none of those is in the probe score). Housekeeping preview on V4test lists the same
  protected set as before (protection formula unchanged).

### Phase B — the index gets an owner; one deletion

- `index-store/` and `retire.ts` as in §3.5, §3.10; migration `retire-memory-vector-entries-v1`;
  `supersededAt` column (`add-memory-superseded-at-v1`, backfilled from `updatedAt` for rows that
  have a `supersededById`); DDL.md, export schema (`supersededAt`), backup/restore.
- All embedding and tier writers and all deleters rewired; dead repository methods removed;
  dispatcher invalidation by touched characterIds; `updateMemory` for the PUT route.
- Tests: an index round-trip (upsert → search → setTier → hotOnly search → remove); a
  parent/child test that a batch touching `memories` reloads the right stores (extend
  `job-dispatcher-frozen-archive.test.ts`); `retireMemories` scrubs all three link columns;
  a grep-test that nothing outside `index-store/` calls `updateForCharacter` with `embedding`
  and nothing outside `retire.ts` calls `bulkDeleteUnsafe`.
- **Acceptance:** on V4test, delete a memory in the browser, then extract a near-identical one
  and confirm the gate reinforces the live neighbour (bug 200 closed structurally); restart and
  confirm cold rows stay cold in recall (bug 205).

### Phase C — admission in the parent; one combine

- `admission/` as in §3.6; host-RPC `admitMemory`; `foldInto`; `incrementReinforcement(by)`;
  `memory-merge.ts`, `createMemoryDirect`, `patchMemory`, `countReinforcement`,
  `absorbNearDuplicate`, `reinforceMemory`, `linkRelatedMemories` (as separate functions) deleted;
  `anchor-gate-probe.ts` reads the façade and calls `decideAdmission` instead of re-deriving.
- Tests: `decideAdmission` table-driven over every branch including subject/kind/source mismatch,
  multi-neighbour date guard, digest redirect, cold promotion; `foldInto` pins footnote cap,
  delta counts, link union, anchor merge; an in-job test that two near-identical candidates in
  one extraction job produce one row with count 2 (bug 209).
- **Acceptance:** `memory-diff` on three V4test chats before and after shows the same inserts
  and strictly more reinforcements, never fewer.

### Phase D — extraction: one context, four passes, cursors

- `extraction/` as in §3.7; migration `add-memory-extraction-cursors-v1`; `memory-tasks.ts`
  split; `memory-processor.ts`, `fold-other-pass.ts`, `fold-episode-pass.ts`, the Carina
  handler's transcript shim, `fold-other-catchup.ts`, the dry-run action and
  `memory-regenerate-chat.ts` rewritten on `buildExtractionContext` + `runPass`;
  `INTER_CHARACTER_MEMORY` removed.
- Tests: `buildExtractionContext` once per unit of work (a spy on character hydration); cursor
  advance equals covered window across a 150-message chat in 60-message slices; dry run and live
  produce identical candidate lists given a mocked model; the episode pass receives the uncensored
  fallback; Carina memories carry `projectId`.
- **Acceptance:** V4test: a 4-character room turn mints no more candidates than before
  (count the job report); `memory-diff --dry-run` on an autonomous chat works; regenerate a
  long chat and confirm fold-grain observations cover its whole history.

### Phase E — recall as a pipeline; delivery

- `recall/` as in §3.8; `context-manager.ts`'s recall block replaced by two calls;
  `memory-injector.ts` dissolved; the search tool, the API search, Carina, voice-rewrite,
  first-message and the recap on the stages; `recall-replay` on the trace; probe fixture test.
- Tests: each stage pure and table-tested; `assemble` cross-pool dedup; `deliver` after
  compression (a line cut by compression is not stamped); continue-turn delivery; one embedding
  call per turn (spy); renderer goldens without debug labels; fixture test reproducing `cap14`.
- **Acceptance:** the probe fixture passes unchanged. On V4test, a continue turn's request body
  contains the recall section; `debugMemoryLogs` shows the stage trace; the inter-character
  section never repeats an archive row.

### Phase F — one maintenance job

- `maintenance/` as in §3.9; `MEMORY_MAINTENANCE`; scheduler; parent-side ledger; the dedup tool
  deleted; `housekeeping.ts`, `housekeeping-outcome-cache.ts`, `consolidation-triggers.ts`,
  `scheduled-housekeeping.ts`, both handlers deleted; `consolidation.ts` keeps its planner and
  model route and loses its loader, triggers and announce code.
- Tests: phase order and skipping; cap on demotable rows only; demote order equals protection
  ascending; demoted rows re-enter consolidation; retire by `supersededAt`; mirror only after
  commit (a failing batch leaves no vault file); per-character dedupe across scheduled and
  watermark reasons.
- **Acceptance:** on V4test with maintenance enabled: a dry run lists phases and counts;
  a real run on a character over cap demotes exactly `demotable − cap` rows, lowest protection
  first; `quilltap memories status` shows the ledger; no `Commonplace/*.md` appears when the
  job is made to fail after planning (force via a test flag).

### Phase G — surfaces, docs, retirement of the old specs

- API, settings tab, CLI and help per §3.11. DDL.md and `qtap-export.schema.json` final pass.
  CLAUDE.md: rewrite the memory-deletion chokepoint line; add chokepoint lines for
  `admitCandidate` / `foldInto`, `memoryIndex`, `MemoryClock`, `salience` / `protection`,
  `assembleRecall` / `deliverRecall`, `runMaintenance`, and `resolveMemorySettings`. Move the four
  superseded specs to `complete/` with a status line pointing here; `memory_management.md`'s
  file inventory (§9) is rewritten for the new layout. Update
  [update-documentation](/.claude/commands/update-documentation.md) if it lists any of them.
- Run the Friday backfill (E2 of the consolidation spec) **after** this phase, with the
  Maintenance card's dry run, and record the result in this spec's implementation notes.

---

## 5. Invariants to pin (write these tests first in each phase)

1. **Probe set.** The `cap14` scores on the 9 probe turns are a fixture; Phases A and E must
   reproduce them exactly before and after. Any tuning change is a separate commit with a new
   fixture row and Charlie's sign-off.
2. **Byte-stability within a compaction generation.** Two consecutive ordinary turns in one
   generation with no memory writes between them render an identical archive section.
3. **No model sees a debug label.** The renderer's output never contains `recall:`, `[m_`,
   `importance 0.` or a raw targeting tag.
4. **No row without an embedding is admitted.** `admitCandidate` returns `reject` when embedding
   fails twice; nothing else inserts an AUTO row.
5. **Every delete goes through `retireMemories`**; every embedding or tier write through
   `memoryIndex`; every worth-ordering through `salience` or `protection`. Each is a grep-test.
6. **`reinforcementCount` only ever increments** (atomic, by a delta). No code path writes an
   absolute count except `create` with 1 and import/restore with the bundle's value.
7. **MANUAL rows are never demoted, folded, consolidated or deleted by policy.** A wipe keeps them.
8. **Digests are never demoted or deleted by policy** while any member survives; retiring the
   last member retires the digest.
9. **The child never writes the index or the memories table except through a buffered batch
   or host-RPC admission.** `memoryIndex.upsert` in the child throws.
10. **Dry run equals live** given the same model output: the candidate list and the admission
    decisions are identical; only the writes differ.

---

## 6. What disappears

| Gone | Replaced by |
|---|---|
| `memory-gate.ts` (1,046 lines) | `admission/` (~500) |
| `memory-service.ts` (1,817) | `admission/`, `recall/`, `retire.ts`, `index-store/` |
| `memory-processor.ts`, `fold-other-pass.ts`, `fold-episode-pass.ts`, `cheap-llm-tasks/memory-tasks.ts` (~3,000) | `extraction/` (~1,500) |
| `memory-injector.ts`, ~1,300 lines of `context-manager.ts`, `frozen-archive-cache.ts`, `conversation-summary-search.ts`, `recall-history.ts`, `recall-tags.ts`, `recall-tuning.ts`, `memory-subject.ts`, `memory-recap.ts` (fetch half) | `recall/` |
| `housekeeping.ts`, `housekeeping-outcome-cache.ts`, `consolidation-triggers.ts`, `scheduled-housekeeping.ts`, two job handlers, `lib/tools/memory-dedup.ts`, `memory-merge.ts` | `maintenance/`, `foldInto` |
| `memory-weighting.ts`, `reinforced-importance.ts`, `episodic.ts`, `episodic-anchors.ts`, `day-references.ts`, `about-character-resolution.ts` (moves) | `scoring/`, `time/`, `admission/subject.ts` |
| `vector_entries`, `VectorIndicesRepository`, `vector-indices.types.ts` | `memories.embedding` + `memories.tier` behind `memoryIndex` |
| `MEMORY_HOUSEKEEPING`, `MEMORY_CONSOLIDATION`, `INTER_CHARACTER_MEMORY` job types | `MEMORY_MAINTENANCE`, `MEMORY_EXTRACTION { pass, cursor }` |
| `chats.otherExtractionWatermarkMessageId`, `chats.commonplaceRecallHistory` stays | `memory_extraction_cursors` |
| 6 copies of housekeeping defaults, 3 of extraction limits, 2 of tuning defaults, 4 of add-or-update-save, 3 of per-character vector removal, 5 of link union, 3 of cheap-LLM config, 3 of hydration, 2 of project lookup, 2 of speaker map, 5 of opener scan, 2 of `STOP_WORDS`, 2 of cosine, 2 of the 1.3 boost, 2 of the recap ramp | one each |
| `chat_settings.autoHousekeepingSettings` (moved), `mergeSimilar`, `autoMergeSimilarThreshold`, `memoryExtractionConcurrency`, `chat_settings.memoryExtractionLimits`, `needsHousekeeping`, `batchExtractMemories`, `handleInterCharacterMemory`, four unused repository deletes, `skipGate` on the API | nothing |

Net: about 11,200 lines in `lib/memory/` plus ~2,500 adjacent become roughly 7,000, with every
cross-cutting decision made once.

---

## 7. Decisions locked (Charlie, 2026-10-12)

Asked and answered; these are not open. A later change to any of them is a spec amendment with a
dated note here, not an implementer's call.

| # | Decision | Phase |
|---|---|---|
| 1 | **Retire `vector_entries` for memories.** `memories.embedding` + `memories.tier` are the only copy; migration verifies, copies any row where the mirror had a vector and the row did not, then drops the table. | B |
| 2 | **Admission runs in the parent, one host-RPC call per candidate.** The child extracts and embeds; the parent searches, decides, writes and updates the index. Batch per pass only if Phase C's timing shows the round trips matter. | C |
| 3 | **The cap counts demotable rows only** (hot, AUTO, non-digest). The report carries `hotTotal` / `demotable` / `protected`. After Friday's first maintenance dry run, lower her 10,000 override toward 2,000–2,500. | F |
| 4 | **A chat wipe spares MANUAL rows and any digest that still has a member**; near-duplicate folding never touches MANUAL, digests or cold rows. The per-row delete remains for a true purge. | 0, F |
| 5 | **Debug labels leave the whisper text.** `[m_…]`, `recall: …`, the importance / relevance / weight numbers and raw targeting tags go to `debugMemories` and the replay trace only. | E |
| 6 | **`reinforcedImportance(i, n) = min(1, i + log2(n) × 0.05)`**, so count 1 equals importance; one recompute migration over every row. | A |
| 7 | **The three manual-only retention knobs are dropped** (age and inactivity are already in protection's content term); **viewing a memory is not an access** — `GET /memories/[id]` stops stamping `lastAccessedAt`. | F, G |
| 8 | **One PR per phase to main.** | all |
| 9 | **Housekeeping settings move to `instance_settings.memoryMaintenance`**; the `chat_settings.autoHousekeepingSettings` column is dropped by migration. Every memory knob then shares one storage class behind `resolveMemorySettings`. | A |
| 10 | **One calendar per instance** for event time on both the write and read side: instance `timezone` → `QUILLTAP_TIMEZONE` → system. The per-chat timezone field stays display-only. Pre-refactor rows keep their UTC-point `occurredAt`; no backfill. | A |
| 11 | **One Maintenance card** replaces the Housekeeping, Consolidation and Dedup cards; three help pages merge into `help/memory-maintenance.md` and the old `section=` deep-links redirect to it. | G |
| 12 | **The inter-character relevance half is a filter of the turn's one gathered pool** by `aboutCharacterId`, deduped against archive and head — one embedding and one search per turn. | E |
| 13 | **`skipGate` leaves the API.** Import, restore and consolidation keep their explicit direct inserts; nothing else inserts around admission. | G |
| 14 | **Recall tuning constants do not move in this refactor.** The probe fixture enforces `cap14`. | A, E |
| 15 | **Bugs 199, 200, 201 and 202 are fixed on the current code first** (Phase 0), before any structural work. | 0 |

## 8. Risks

- **Scale of change.** Six of the seven phases touch the per-turn path. Mitigation: phase order
  (A and B are foundations with small behavioural surface; C–E each replace one layer behind
  the same public names), the §5 invariants as tests written first, and the probe fixture.
- **Host-RPC admission latency.** A turn with 11 candidates makes 11 round-trips. Each is a
  brute-force search over ≤ 30k vectors (~ms) plus three row writes. Measure in Phase C with
  the job report's timing; batch the RPC per pass if it matters.
- **Friday's corpus.** Phase A's recompute migration and Phase B's `vector_entries` verify loop
  walk ~5k rows; trivial. Phase F's first maintenance run on Friday should be a dry run reviewed
  by Charlie (consolidation spec E2 applies unchanged).
- **Tests and the jest conventions.** Real-binding tests must require `better-sqlite3` by absolute
  root path; bare `jest.mock` factories; see the memory notes on jest. The parent/child tests
  follow `child-proxy-memory-housekeeping.test.ts`.
- **v5.** Every schema move here (two new columns, one new table, one dropped table, one dropped
  column) is a D23 follow for quilltap-v5 — re-dump `fresh_schema.json`, never by hand.

---

## Chores (per repo rules; the implementer owes these per phase)

`docs/CHANGELOG.md` (plain voice) · `help/*.md` with `url` frontmatter + In-Chat Navigation ·
`docs/developer/DDL.md` · `public/schemas/qtap-export.schema.json` · `lib/startup/prettify.ts`
label and `reportProgress` per migration · `docs/developer/API.md` for the `maintain` action ·
`packages/quilltap` version bump · CLAUDE.md chokepoint lines (Phase G) · bug files 199–226 opened
in Phase 0 and `git mv`'d to `fixed/` as each closes, with the index row updated both times.
