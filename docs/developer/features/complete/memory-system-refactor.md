# Memory system refactor — one Commonplace Book, not nine

**Status:** Approved 2026-10-12 — every decision in §7 locked with Charlie the same day. **Phase 0 done 2026-10-12** (bugs 199–226 filed; 199, 200, 201 fixed; 202 closed as not a defect, see §7 amendment). **Phase A done 2026-10-12** (see the Phase A amendment in §7 for where it departs from §3). **Phase B done 2026-10-13** (see the Phase B amendment in §7). **Phase C done 2026-10-13** (see the Phase C amendment in §7). **Phase D done 2026-10-13** (see the Phase D amendment in §7). **Phase E done 2026-10-13** (see the Phase E amendment in §7). **Phase F done 2026-10-13** (see the Phase F amendment in §7). **Phase G done 2026-10-13** (see the Phase G amendment in §7) — all seven phases landed. **Friday backfill (E2) done 2026-10-13** (recorded at the end of §7); the spec moved to `complete/` that day. **Bugs 203–226 fixed 2026-10-12 as targeted fixes on the current code**, ahead of their phases; the phases remain the structural work. Already landed and to be carried, not redone: the `reinforcedImportance` formula and its recompute migration (decision 6), the instance calendar in `lib/memory/memory-calendar.ts` (decision 10), `memories.supersededAt` (Phase B), the cap on demotable rows (decision 3), no access stamp on GET and no `skipGate` on the API (decisions 7, 13), and a chat episode watermark column (`episodeExtractionWatermarkMessageId`) that Phase D's cursor table should absorb.
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
[wardrobe-refactor.md](./wardrobe-refactor.md): a diagnosis, a table of defects to file
first, the work in phases, and what disappears. The four code audits the diagnosis rests on are
reproduced in full as Appendices A–D at the end. Line references were verified against the working
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
them in the [bug catalogue](../../bugs.md) as **bugs 199–226** before Phase A, one file each, with the
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

### 2.1 Carried forward from the 203–226 targeted fixes (2026-10-12)

Bugs 203–226 were fixed on the current code ahead of their phases. These pieces were left for the
phases and must not be lost:

| Phase | Item | Recorded in |
|---|---|---|
| B | A digest whose `consolidatedFrom` empties is left in place; `retireMemories` retires it with its last member. Existing dangling `consolidatedFrom` ids are not repaired (`memories validate --repair`). | [bug 225](../../bugs/fixed/bug-225-retention-clock-links.md) |
| C | Links and footnotes are now deltas against the live row (bug 231, fixed 2026-10-12: `addRelatedMemoryIds` / `removeRelatedMemoryIds` / `appendReinforcementFootnotes`). `foldInto` should keep writing them that way. | [bug 231](../../bugs/fixed/bug-231-cross-job-link-race.md) |
| C | The per-job memory overlay in `child-repositories-proxy.ts` (bug 209's fix) is deleted once admission runs in the parent. | [bug 209](../../bugs/fixed/bug-209-child-gate-blind-writes.md) |
| D | The dry run now passes project id, description and summary (bug 230, fixed 2026-10-12); the rest of smell A.6 #27 (profile, timestamps, fold passes, autonomous chats) remains. | [bug 230](../../bugs/fixed/bug-230-dry-run-no-project.md) |
| D | `chats.episodeExtractionWatermarkMessageId` (bug 207) and `otherExtractionWatermarkMessageId` fold into `memory_extraction_cursors`. | [bug 207](../../bugs/fixed/bug-207-episode-pass-no-watermark.md) |
| E | The text-search fallback still ignores `minScore` and filters raw `importance`, and has no related-memory expansion or R6 background reserve. | [bug 214](../../bugs/fixed/bug-214-text-fallback-drops-options.md) |
| E | The inter-character section is deduped against the archive by id but not backfilled; rows cut from the archive by its token budget can still appear there. | [bug 224](../../bugs/fixed/bug-224-recall-sections-overlap.md) |
| B | Both scrubs are now SQL removal deltas (`removeConsolidatedMembers`, and `removeRelatedMemoryIdsEverywhere` for bug 234, fixed 2026-10-12); `retireMemories` keeps them. A digest created and member-deleted in the same job is still not scrubbed. | [bug 234](../../bugs/fixed/bug-234-related-scrub-lost-update.md) |
| D | The episode pass's idle catch-up (bug 232, fixed 2026-10-12: `foldEpisodeCatchup`, `lib/memory/fold-episode-catchup.ts`, shared rules in `fold-catchup.ts`) folds into the cursor table and single sweep. | [bug 232](../../bugs/fixed/bug-232-episode-no-idle-catchup.md) |
| F | Housekeeping may now demote protected AUTO rows, last, when over the cap (decision 3). Review on Friday's first maintenance dry run. | [bug 210](../../bugs/fixed/bug-210-cap-counts-protected-rows.md) |

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

**Done 2026-10-12.** 199–201 fixed as written. 200's character-archive half did not reproduce (archive drops the whole index). 202 was not changed: see the §7 amendment.

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

**Done 2026-10-13** (see the Phase G amendment in §7). The Friday backfill below is still owed.

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
| 10 | **One calendar per instance** for event time on both the write and read side: instance `timezone` → `QUILLTAP_TIMEZONE` → system. The per-chat timezone field stays display-only. Pre-refactor rows keep their UTC-point `occurredAt`; no backfill (*reversed — see the PR 90 review amendment below*). | A |
| 11 | **One Maintenance card** replaces the Housekeeping, Consolidation and Dedup cards; three help pages merge into `help/memory-maintenance.md` and the old `section=` deep-links redirect to it. | G |
| 12 | **The inter-character relevance half is a filter of the turn's one gathered pool** by `aboutCharacterId`, deduped against archive and head — one embedding and one search per turn. | E |
| 13 | **`skipGate` leaves the API.** Import, restore and consolidation keep their explicit direct inserts; nothing else inserts around admission. | G |
| 14 | **Recall tuning constants do not move in this refactor.** The probe fixture enforces `cap14`. | A, E |
| 15 | **Bugs 199, 200, 201 and 202 are fixed on the current code first** (Phase 0), before any structural work. | 0 |

**Amendment (2026-10-12, Phase 0).** Decision 15 is met for 199–201. Bug 202 is closed as *not a
defect*. R5 of the recall retuning (2026-10-08) deliberately keeps entity-anchor hits under the cosine
floor, with related expansion as the only exemption, and a test pins it. Boosting or exempting anchor
hits would also move `cap14` against decision 14. Charlie chose to keep R5; only the misleading
comments were corrected. Any change to the floor's exemptions is a tuning change under §5.1.

**Amendment (2026-10-12, review of PR 90).** Decision 10's "no backfill" is reversed: the owner's
review of PR 90 asked for one. Once the anchor line and the day windows read `occurredAt` on the
instance calendar, a legacy UTC-midnight point date reads as the previous day anywhere west of
Greenwich. Migration `rezone-legacy-memory-occurred-at-v1` re-stamps every row whose `occurredAt` is
exactly a UTC midnight at local midnight of the same calendar date in the instance zone (resolved as
`refreshMemoryTimeZone` resolves it). It runs once, before the new resolver writes anything, so on an
ordinary upgrade every UTC-midnight row is legacy; there is deliberately no `createdAt` cutoff, since an
instance still on old code keeps writing legacy rows. The residual case is a development instance that
ran the bug-212 code before this migration in a UTC−6 zone, where a post-fix "last night" (18:00 local)
is itself a UTC midnight. No re-embed is needed: legacy
vectors carry the UTC date, which is the date the re-stamped value reads. Every path that builds
embedding text or an extraction prompt now resolves the zone first (`refreshMemoryTimeZone`) and
passes it explicitly, so the parent and a cold job child render the same date.

**Amendment (2026-10-12, Phase A).** Phase A landed as §3.1–3.4 describe, with these departures:

- `MemoryCandidate.targeting` is **nullable**. A hand-written memory carries `null`, stores no tag
  keywords and reads as the defaults (present / wide / information), as manual rows always have.
  Every extractor's candidate carries tags.
- `rankForRecall` is not built in Phase A; recall keeps its blend (`computeRankingBlend`, now in
  `scoring/relevance.ts`) and the search tool keeps its cross-source sort. Both move with Phase E.
  The dedup pass's `scoreMemory` is left for Phase F.
- The clock's day windows are **closed**: `to` is the next boundary minus 1 ms, so adjacent
  windows never share an instant. A write-side "today" phrase is stamped at the **start** of its
  window (local midnight), not at the anchor, so the read side's "today" window contains it.
  `rules.ts` holds the one table (`DAY_REFERENCE_TABLE`, out to fourteen days ago); write-only
  phrases (weekdays, "last month", ISO dates) stay in `clock.ts`.
- `?action=housekeeping-config` stays as an alias of the new `?action=maintenance-config`.
  `?action=extraction-concurrency` and the housekeep result's `merged` / `mergedIds` /
  `wouldMerge` are removed. `move-memory-maintenance-settings-v1` also drops the three dead
  `chat_settings` columns (`autoHousekeepingSettings`, `memoryExtractionLimits`,
  `memoryExtractionConcurrency`) and the `memoryExtractionConcurrency` instance key; a restore of an
  older backup derives `memoryMaintenance` through `withMemoryMaintenanceFromLegacy`.
- The Carina pass is still labelled `self-turn` in its candidate provenance (`carina` exists in
  the enum for Phase D's pass split).
- The `cap14` replay acceptance and the V4test housekeeping preview were not run in this
  environment (no V4test instance). The probe-set ordering is unchanged by construction (the
  blend already read reinforced importance); the protection formula moved file but not value,
  and `protection-and-age.test.ts` pins it.

**Amendment (2026-10-13, Phase B).** Phase B landed as §3.5 and §3.10 describe, with these
departures:

- **The child's index writes buffer; they do not throw yet.** §3.5 and invariant 9 make
  `memoryIndex.upsert` / `setTier` / `remove` throw in the job child, which presumes admission has
  already moved to the parent (Phase C). Until it does, the gate, consolidation and housekeeping
  still run in the child, so there the index's row writes go through the repository proxy (buffered,
  committed with the job — invariant 9's "buffered batch") and the child's own cache is updated in
  place so the same job sees its vectors. The parent drops its cache for every character a committed
  batch touched. Phase C turns the child-side writes into the throw.
- **The index has two methods §3.5 does not list.** `indexInserted` caches the vector of a row its
  creator has just inserted *with* that vector (admission's create, a consolidation digest), so a
  new row is never written twice and never exists without its embedding (invariant 4).
  `shape(characterId, queryDims)` reports size, dominant length and matching count, which recall
  and the anchor probe use to detect a profile mismatch. `upsert` takes an optional `alongside`
  patch written in the same row update, so an edit or a digest revision never puts new text beside
  an old vector.
- **Mixed vector lengths are held, not refused.** With the mirror gone the cache loads whatever the
  rows hold, so a corpus part-way through a re-embed has two lengths. Search scores entries matching
  the query's length; recall falls back to text only when none match. A full reindex therefore no
  longer empties the index first: until each row is re-embedded, a same-length model swap compares
  against the old model's vectors (previously the store was deleted and recall used text search).
- **The digest cascade skips retention.** Invariant 8 retires a digest with its last member. Applied
  to `coldRetentionDays`, that would delete every digest whose superseded members aged out — the
  digest exists to outlive them. `retireMemories` cascades for every reason except `'retention'`.
- **Dispatcher invalidation keeps bug 217's shape table** rather than reloading on every `memories.*`
  write: link, count and footnote writes do not change what the cache holds, and reloading on them
  dropped the cache after nearly every turn. The table now lists only the `memories` writes that
  change a vector, a tier or a row.
- **Restore backfills from an older archive's mirror.** §3.5 says restore ignores
  `vector-entries.json`; it reads it only to give a memory that arrived with no embedding the vector
  its archive kept beside it, the same safety the migration applies.
- `rebuildVectorIndex` stays as a cache reload (the `PUT ?action=embeddings` route) and reports rows
  without an embedding as `failed`. `MemoriesRepository.delete` throws rather than being removed: the
  base repository declares it. `memories validate --repair` (dangling ids already on disk) stays
  with the CLI work in Phase G.
- The V4test acceptance walk (delete in the browser, re-extract, restart) was not run in this
  environment; `memory-index-and-retire.test.ts` covers the same paths against real SQLite.

**Amendment (2026-10-13, Phase C).** Phase C landed as §3.6 describes, with these departures:

- **`decideAdmission` takes a candidate *view*, not the candidate.** Its input is
  `{ holderId, aboutId, kind, source, occurredAt }`, the hydrated neighbours and the thresholds —
  no embedding and no clock, since event time is resolved before admission and the decider reads
  only `occurredAt`. `admitCandidate(candidate, resolved, opts)` takes the clock's resolved
  anchors beside the candidate for the same reason; `admitRow` is the same call for a row already
  built (`toAdmissionRow`, which replaces `toCreateMemoryOptions`), and `admitPrepared` is the
  parent half the `admitMemory` host-RPC runs.
- **The action union differs in detail.** `reinforce` has no `withFootnotes` (it always writes
  them); `promote-and-reinforce` carries `withFootnotes` (false for a cold near-duplicate, which is
  promoted and absorbed by count). `insert-linked.reason` adds `'mismatch'`. `reject` is
  `'embedding-failed' | 'empty'`: a subject mismatch is not a rejection.
- **A close neighbour the candidate may not fold into is linked.** At or above the reinforce
  threshold, a neighbour about a different subject (a self memory reads as the holder whether
  `aboutCharacterId` is null or the holder's id), of a different kind, an AUTO row under a MANUAL
  candidate, or a different occasion is excluded from folding and becomes a link target beside
  the related band. The date guard reads every such neighbour, so a same-occasion row below a
  different-occasion one still takes the candidate.
- **`promoteOnMatch` is gone with the AUTO→MANUAL promotion.** A hand-written memory never folds
  into an extracted row (it inserts and links, per §3.6); folded into a MANUAL row or a digest, it
  raises that row's importance when higher and the row keeps its source.
- **The child's index writes still buffer.** Admission no longer writes from the job child, but
  consolidation, housekeeping and the embedding jobs still do, so `memoryIndex` writes in the child
  cannot throw yet (invariant 9's throw waits for the last of them). After a parent-side admission
  writes, it sends the child the written vectors and tiers (`memory-index-patch`), which patch the
  child's cache without discarding in-place updates a running child job made.
- **Admission commits outside the job's write batch**, so the parent guards it three ways (review
  of PR 93): a per-character lock around search → decide → write (concurrent jobs cannot both
  insert one memory); an idempotency key per admission from the child (`jobId : content hash :
  occurrence in the attempt`) whose outcome the parent remembers for 24 hours, so a failed and
  retried job does not count its observations twice; and a second decision when the fold target is
  retired mid-write, inserting if it vanishes again. The ledger lives in the parent's memory: a
  restart between attempts forgets it.
- **`dryRun` is not built.** Nothing called it; Phase D adds the dry run on the extraction context
  and invariant 10's test with it.
- **The footnote cap limits footnotes only.** A fold re-embeds whenever the embedded text (content
  or anchor line) changed, at the cap too (bug 204's invariant); the old gate froze the vector at
  the cap. `applyFold` refuses to run in the job child.
- **Consolidation's member merge does not call `foldInto`.** A digest's content is written by the
  model, its count is an absolute sum capped at 50, and its links are remapped across every
  cluster of the run; none of that is a fold of rows into a survivor. It stays with the planner
  until Phase F. `foldInto` serves admission's reinforce and the dedup tool; one consequence is
  that a reinforce now takes the earliest `occurredAt` (within the date guard) instead of filling a
  null only, and a dedup fold now unions entities.
- **Watermarks.** The housekeeping watermark runs in the process that asked for the admission
  (the child, for extraction), where the housekeeping job records its outcomes, so its one-hour
  backoff still reads where it is written. The consolidation watermark runs in `admitPrepared` in
  the parent: extraction batches no longer carry `memories.create`, so the dispatcher's commit hook
  no longer sees them.
- **Round-trip timing was not measured** (no V4test instance in this environment); admission is
  one host-RPC call per candidate as decided. `memory-diff` acceptance on V4test was not run either.
  `admission-host-rpc.test.ts` drives the child → host-RPC → parent path (V8-serialised as the IPC
  channel does) and pins bug 209 and bug 231 there.
- Removed beyond §3.6's list: `createMemoryWithGate`, `createMemoryWithEmbedding`,
  `CreateMemoryOptions`, `MemoryGateOutcome`, `runMemoryGate`, `reembedMemory`,
  `promoteMatchedMemory`, and `skipGate` / `skipEmbedding` / `promoteOnMatch` on
  `MemoryServiceOptions`; `memory-gate.ts` is deleted outright (`extractNovelDetails` moved to
  `admission/novel-details.ts`, the threshold constants to the façade's `ADMISSION_THRESHOLDS`
  only). The Memories API answers `action` with the action kind (`insert`, `reinforce`, …).

**Amendment (2026-10-13, Phase D).** Phase D landed as §3.7 describes, with these departures:

- **The pass interface is shaped by calls, not by `window`/`prompt`/`parse` triples.** An
  `ExtractionPass` says which cheap-LLM calls it makes over a `TranscriptWindow` (`calls(ctx,
  window)`); each `PassCall` carries its holders, its messages and its own `parse(raw)` into
  `DraftBatch`es (holders, subject, drafts, pass floor, source message, time anchors). `runPass`
  owns the rest for every pass: rate limit → `executeCheapLLMTask` → parse (the pass's cap) →
  floor → `candidateFromDraft` → event time → `admitCandidate`. The episode pass's fragment
  linking is its `afterBatch` hook. Every parser yields `MemoryDraft`s (the episode parser too:
  narrative → content, episodic, targeting past/narrow/history), so every pass reaches
  `MemoryCandidateSchema` through one `candidateFromDraft`.
- **Turn passes have no cursor.** A turn is addressed by its opener (and, in autonomous rooms, its
  closing anchor) — `TurnLocator`, listed by `listExtractionTurns`, the one scan that replaces the
  five opener scans. Only the fold passes keep cursors, so the cursor table's `pass` is
  `'other-fold' | 'episode-fold'`.
- **Both watermark columns move.** The migration backfills `other-fold` *and* `episode-fold`
  (from `episodeExtractionWatermarkMessageId`, which Phase 0's bug 207 fix had added) and drops
  both. Exports and backups keep carrying the two field names on the chat; import and restore
  remap them with the messages and write them to the table (`extraction/cursor-bundle.ts`), so old
  and new bundles read the same way. A second migration, `drop-inter-character-memory-jobs-v1`,
  deletes queued rows of the retired job type, which would otherwise fail to parse.
- **`createdAt` is the source message's time on every extraction path, not the wall clock.** §3.7
  says "the write clock". Taken literally that would date every regenerated memory to the
  regenerate, which resets salience and protection's age term for a whole rebuilt corpus — a recall
  change outside this phase's remit (decision 14). What is uniform now is the rule: the fold OTHER
  pass (which used now) and the episode pass (which used the event date) use their source
  message, like the turn passes, and the turn passes use each slice's own last message rather than
  the turn's latest. `occurredAt` remains the event.
- **The rate limiter's memory lives in the parent.** "Counts admissions it saw" needs a count that
  outlives one unit of work, or the per-hour cap means nothing. Admission (already in the parent)
  records each AUTO insert in an in-memory ledger (`admission/rate-ledger.ts`); a context reads it
  once per character (host-RPC `countRecentAdmissions` from the child) and adds its own inserts as
  they land. A restart forgets the hour. Rebuilds of history (regenerate, queue-memories, import,
  the dry run) carry `backfill: true`: the limit is off for them and their inserts are not counted.
  A fold slice whose calls would all be skipped is deferred unread (cursor left before it), never
  passed over (review of PR 94). The limit now also applies to the episode pass, and a
  rate-limited character remains a subject of others' OTHER calls (the limit stops a holder gaining
  memories, not others observing them).
- **The route honours the global default cheap profile** (`buildCheapLLMConfig`). Of the three
  config builders only the context summary's did; extraction now resolves the same way.
- **Caps.** `passCap(base, maxTokens) = max(1, min(base, ceil(maxTokens / 8000)))` with base 2 for
  the turn passes, `foldCandidatesPerSubject` for `other-fold`. The episode pass keeps
  `FOLD_EPISODE_CAP` (2) without the budget clamp: it is per stretch, not per subject, and the
  spec names only the fold OTHER cap. On a default profile (8,000 output tokens) the fold OTHER cap
  falls from 3 to 1 per subject (plus the event slot). Kept on review of PR 94 (Charlie). Watch this
  against the V4test acceptance count; raise the clamp's divisor in a tuning commit if the fold pass
  goes too quiet.
- **The dry run embeds.** `admitCandidate({ dryRun: true })` embeds the candidate, gathers its
  neighbours and decides, writing nothing (`decideOnly`), so `memory-diff` reports decisions; a dry
  run therefore costs embedding calls. A whole-chat dry run decides as a regenerate would: past the
  rows the chat wipe would retire (`previewChatWipe`) and against its own would-be inserts (the
  parent-side `DryRunBook`), so a later near-duplicate reinforces an earlier candidate (review of
  PR 94). Invariant 10's test pins equality given the same admission decisions.
- **Regenerate enqueues the episode catch-up at once** and anchored turn jobs for autonomous rooms
  (smell 29); queue-memories and the dry run resolve the connection profile from the chat's seats
  first (smells 27, 28).
- **Not run in this environment:** the V4test acceptance walk (room-turn candidate count,
  `memory-diff` on an autonomous chat, regenerate coverage). The new tests cover the same paths
  with mocked models: `run-pass-invariants.test.ts`, `admission-dry-run.test.ts`,
  `fold-cursor-slicing.test.ts`, `context-and-carina.test.ts` and the migration's integration test.

**Amendment (2026-10-13, Phase E).** Phase E landed as §3.8 describes, with these departures:

- **Stage boundaries.** The floor and the window staging sit in `score`, not `select`: whether the
  window is hard or soft decides which multipliers apply, so it must precede `rankForRecall`.
  `select` is expansion, R6 and the cut. Expansion's neighbour read is `hydrateNeighbours` (in
  `hydrate.ts`, the pipeline's one other read), so `score` and `select` stay pure. The text
  strategy never expands and never reserves (as before). `searchRecall` drives gather → select and
  falls back to the text strategy on a vector failure or an empty index, as the old search did.
- **No digest redirect in `hydrate`.** Every prompt path reads hot rows only, and the tool and the
  Memories API deliberately return cold rows labelled, so there is never a hit to redirect.
- **Precedence across pools** is archive → head → inter-character. The recap is a narrative, not
  lines, so §3.8's "at most one of … recap" holds one way only: the recap is built without the rows
  the archive rendered (it reads that many more per tier so its tiers stay full), but the head and
  the inter-character section do not skip the recap's rows — a lossy summary may leave out the very
  line the chat-start turn needs (review of PR 95). The
  inter-character section dedups against what the earlier pools *rendered*, so a row the archive
  held but its budget cut stays eligible (bug 224's rule).
- **One embedding per ordinary turn.** The query stage embeds the query once; the head, the
  inter-character relevance half, the recap's relevant list and the per-turn list reuse it (the
  recap's list therefore searches with the turn's query rather than the newest message). A
  retrospective turn embeds more: its ≤ 2 probes, and — when it names anyone — the mini-recap's own
  `paraphrase — entities` query, kept so "remember Lighthouse Point?" still finds the conversation
  that names the place (review of PR 95). Knowledge retrieval still embeds the recent-window prose on
  its own: it is not memory recall and was left alone. The proactive pass's result is used only when
  it found something; an empty or failed proactive search gets the fallback's distil and search, as
  before (review of PR 95).
- **The inter-character relevance half reads the head search past its cut.** Decision 12's "one
  search" holds, but the head's search is cut to `headEntries × 3`, so the section filters the
  search's whole ranked list (`RecallSearchResult.ranked`, from the vector top `limit × 3`) by
  subject, five per character (review of PR 95).
- **The archive's token budget is the ordinary one on every turn**; a retrospective head borrows
  from what the archive leaves, never below the ordinary head budget.
- **Delivery** decides survival by text: a rendered line is delivered when the whole line is in the
  request's recall text verbatim (a bare body can turn up elsewhere), or — only in a section that
  compression rewrote, i.e. no longer present verbatim — when one compressed line holds at least
  60% of its significant words (three or more). The ring is written whenever the head delivered something,
  whether or not the whisper posted. §3.8's "the recap stamps what it rendered" is read narrowly:
  the recap renders a narrative, not rows, so the rows it summarised are not stamped (as before);
  a recap row the head delivers is stamped as a head line. The debug record rides on the reply: `BuiltContext.recallDebugLog`,
  written to the assistant message's `debugMemoryLogs` by the finalizer; memory extraction now
  appends after it (`withRecallLines`) instead of overwriting. Its `[Recall:ring]` line is what the
  replay reads back.
- **The replay keeps its two candidate tables** (old path inert, new path live) for the CLI and the
  probe-set runbook, and adds the text fallback's table, the stage trace (query, the new path's
  search stages, `assemble` over the new path's pool, archive uncached) and the rendered pools. The
  ring as of the turn comes from earlier replies' records; a chat older than those records ranks
  under its current ring and says so (`ringSource: 'chat'`).
- **`searchMemoriesSemantic` and `markMemoriesAccessed` are gone, not kept as names**: every caller
  moved to `searchRecall` / `searchMemories` and `stampAccessed`, and a grep-test holds that. The
  `lib/memory` barrel exports the recall stages.
- **The probe fixture is synthetic.** Friday's corpus is not in this environment, so
  `__tests__/fixtures/recall-probes/` is a nine-turn stand-in named after the probe-set slots,
  captured from the pre-Phase-E search under `cap14` before any recall code moved; the stages
  reproduce every row (order, relevance, salience, labels, blend) and its gold-at-head total. The
  real `cap14` replay on Friday and the V4test walkthrough (continue-turn request body, the stage
  trace in `debugMemoryLogs`, inter-character never repeating an archive row) were not run here;
  `assemble-deliver.test.ts` and the continue-turn test in `context-management.test.ts` cover the
  same paths with mocked providers.

**Amendment (2026-10-13, Phase F).** Phase F landed as §3.9 describes, with these departures:

- **The near-duplicate fold writes in the parent, not in the job's batch.** `applyFold` refuses to
  run in the child (it cannot read its buffered writes back), and a buffered fold would race
  admission: a candidate reinforcing a row the batch is about to retire is an observation lost. So
  the child plans (`planNearDuplicateFolds`, pure) and the parent applies
  (`applyNearDuplicateFolds`, host-RPC `foldNearDuplicates`) under admission's per-character lock
  (`withAdmissionLock`), re-reading every row first and skipping any that went cold, MANUAL or
  missing since planning; absorbed rows are retired only after their survivor took them in. Like
  admission, these writes commit outside the job's batch. Grouping is survivor-first, not
  transitive: rows are visited by `protection` descending and each claims the later rows that are
  near-duplicates *of it*, so A≈B≈C never folds C into A. Rows compare only within a bucket of
  subject, kind and embedding length, at admission's near-duplicate cosine for the default
  profile (0.90 neural, 0.80 Built-in TF-IDF, after PR 96).
- **Consolidation, demotion and retention still write the index from the child** (buffered, as
  Phase B allowed), so invariant 9's throw still waits. Every phase plans against one corpus read
  (`MaintenanceCorpus`), kept in step with each earlier phase's plan in dry run and live alike;
  the only dry/live difference is that a dry-run survivor keeps its old vector where a live fold
  re-embeds.
- **The child hands its summary to the parent on the `job-result` message** (a new `result` field;
  `setJobResult` in the child proxy). The dispatcher records it in the ledger only after the batch
  commits; the archive invalidation, realtime hints and mirror keep their existing commit hooks,
  now keyed on `MEMORY_MAINTENANCE`. `invalidateAllFrozenArchives` is no longer reached from a job
  (every maintenance job names its character).
- **Which phases run.** Scheduled runs ask for every phase; the job drops what settings forbid. A
  watermark asks only for what is due: the cap watermark (demotable ≥ 90% of the cap) for fold →
  demote → retire, the consolidation watermark (unconsidered > `watermark`) for consolidate →
  mirror. `memoryMaintenance.phases` (`foldNearDuplicates`, `demote`, `retire`, default on) is new:
  §3.9's "each skippable by settings" needed a setting, and Phase G's card will expose it. It
  gates every phase a scheduled or watermark request asks for, named or not; a phase asked for by
  hand (`exemptPhases`, set at enqueue: a manual request's phases, or all of them) runs regardless
  of it and of the enabled switches (review of PR 97). Consolidation keeps
  its own `memoryConsolidation.enabled`; `retire` also needs `coldRetentionDays`. A fold now runs
  automatically whenever maintenance is on (the old dedup tool was manual-only); it never touches
  MANUAL, digests or cold rows (decision 4).
- **The near-duplicate fold takes admission's lock one group at a time** (one survivor re-embed),
  never for the whole phase, and under a job's time budget stops starting groups after 40% of it
  (`FOLD_BUDGET_SHARE`); the rest are deferred to the next run and consolidation gets what the
  budget has left (review of PR 97).
- **The ledger's throttles keep the old values**: cap watermark 90%, 15 minutes between demotions,
  an hour's backoff after a demotion that moved fewer than max(10, 1% of the excess) — a demotion
  that found no excess included, as the old outcome cache did — six hours
  between watermark consolidations. The check itself is debounced to once per character per two
  minutes (the cap check used to run on every insert, the consolidation check every ten minutes).
  The ledger lives in parent memory and seeds itself once per process from the last 100
  `MEMORY_MAINTENANCE` rows, which replaces both durable job-table throttles.
- **Dedupe.** One job per character whatever the reason. A pending job widens to the union of the
  phases asked for (an unscoped job stays unscoped) and of the hand-asked `exemptPhases`, and merges
  `settings` (bug 223's threshold); merging a manual request never lends a scheduled phase its
  exemption. A running job never absorbs a request (it has read the corpus and may be past the
  phase): a new pending job is made, and the handler defers it two minutes, re-enqueued, while
  another run for the character is PROCESSING. A user-wide fan-out and the daily sweep read each
  owner's pending jobs once (review of PR 97). A live `?action=housekeep` enqueues rather than
  writing in-process, so nothing demotes beside a running job. Dry runs are
  never enqueued: they run in-process (the API, bounded as the consolidate dry run was), so the
  dedupe never needs a dry-run flag.
- **Retire** is planned from the corpus and is AUTO-only, as §3.9 says; the old SQL took any
  non-MANUAL row, so a superseded cold digest is no longer retention's to delete.
  `findExpiredColdIds` is removed.
- **Surfaces moved forward from Phase G where this phase needed them.** `POST ?action=maintain`
  (dry run user-wide only for the LLM-free phases) and `GET ?action=maintenance-status` landed
  here, because the acceptance names a dry run of the phases and the ledger in
  `quilltap memories status`; the CLI's status reads the ledger from the server and the job rows
  from the database. The dedup tool's deletion took `system/tools?action=memory-dedup` with it, so
  its card now previews and enqueues the fold phase through `maintain` (no threshold slider). The
  character page's dialog lost the three dropped knobs. `housekeep`, `housekeep-sweep` and
  `consolidate` remain as aliases over `runMaintenance`; the one Maintenance card, `maintain` in
  the CLI and the merged help page stay with Phase G.
- **Self canon** for the self bucket now includes `Commonplace/Self.md`
  (`loadCanonForSelfWithCommonplace`), as §3.9 asks.
- Migration `drop-housekeeping-consolidation-jobs-v1` deletes rows of the two retired job types,
  which would otherwise fail to parse.
- **Not run in this environment:** the V4test acceptance walk (dry run listing phases and counts,
  a real over-cap run demoting `demotable − cap`, `quilltap memories status`, the forced failure
  leaving no `Commonplace/*.md`). `run-maintenance.test.ts` and `ledger-and-triggers.test.ts`
  cover the same paths with mocked I/O; the failure is forced with
  `QUILLTAP_TEST_MAINTENANCE_FAIL_AFTER_PLAN=1` (honoured outside production only), and the dispatcher suite pins that a failed batch
  writes no mirror and records nothing in the ledger. Friday's first run should still be a dry run
  reviewed by Charlie (§8).

**Amendment (2026-10-13, Phase G).** Phase G landed as §3.11 describes, with these departures:

- **The aliases are gone, not kept.** `?action=housekeep` (GET and POST), `housekeep-sweep`,
  `consolidate` and `housekeeping-config` are removed (now `400 Unknown action`); their callers —
  the three retired cards, the character page's dialog and the CLI — moved to `maintain` and
  `maintenance-config` in the same phase. `maintain` brings `mirror` along whenever `consolidate` is
  named (`withImpliedPhases`, `maintenance/types.ts`), as the `consolidate` alias did.
  `extraction-concurrency` was already gone.
- **`validate --repair` runs in the server**, as `POST ?action=repair` (`repairMemoryGraph`,
  `lib/memory/repair.ts`), because the scrub must go through the retirement's removal deltas and
  `memoryIndex.setTier` in the process that owns the index. `findDanglingLinks` (repository) is one
  `NOT EXISTS` scan per link column; `scrubDanglingMemoryLinks` (`retire.ts`) removes what it
  finds — a member whose digest is gone keeps its tier and loses its `supersededById`, rather than
  §3.10's "cold", since a hot row with a dead digest pointer was never demoted. Rows without
  embeddings are queued through `enqueueMissingEmbeddings` (`index-store/backfill.ts`, now shared
  with `?action=backfill-embeddings`), at most 2,000 per call. The CLI asks for a dry run unless
  `--write` is given (the repo's rule for CLI writes), as `characters archive` does.
  Review of PR 98: the scrub writes only the rows the scan named (per-row `removeRelatedMemoryIds`,
  so a repair scoped to one holder touches that holder alone and announces exactly the holders it
  wrote); a digest every one of whose members is gone is retired through `retireMemories`
  (`reason: 'graph-repair'`) rather than left empty; `findDanglingLinks` has no fallback, so a
  failed scan is a 500; the embedding jobs are queued in one batch (`enqueueEmbeddingGenerateMany`:
  one read of the active jobs, one insert; `findIdsWithoutEmbedding` selects two columns); and the
  CLI's unscoped scan covers every holder in `memories`, orphans included, as the server's does.
- **Bug 244 was found here and fixed in the phase.** Moving the `*-config` actions onto the
  façade's schemas showed that Zod 4's `.partial()` re-applies every default, so every one-field
  settings write (the Consolidation card saved one field per change) reset the others.
  `patchSchemaOf` (`lib/schemas/patch-schema.ts`) is now the only way a partial write is
  validated; the CLAUDE.md line says so.
- **The Maintenance card** (`memory-maintenance-card.tsx`) also absorbed the consolidation
  particulars and the archive retention (stored in `memoryConsolidation`, shown beside the
  `retire` switch it governs). "Run now" is one dialog (`components/memory/maintenance-dialog.tsx`)
  shared with the character page, so there is no separate per-character Maintenance dialog
  component; the dry-run report view (`maintenance-report.tsx`) absorbed the old consolidation
  report dialog. The ledger reads `?action=maintenance-status` under the `memories` query
  namespace, so the existing realtime topic refreshes it — no polling. `memory-list.tsx` has no
  over-cap figure of its own; the cap comparison on demotable rows lives in the card's overrides
  list, the dialog's picker and the report's demote section.
- **Settings stored values.** `MemoryExtractionLimitsSchema.maxPerHour` gained the API's old
  10,000 upper bound, so the façade is the only bound.
- **The CLI** also resolves the server port from `--instance` for every memory verb that calls the
  server. After review it keeps no copy of the server's phase list or bounds: `maintain` sends what
  was typed and prints the server's 400. `--threshold` sets `clusterThreshold` only, which the
  Built-in TF-IDF profile does not read; the help says so.
- **Specs.** The four superseded specs moved to `complete/` with a pointer here; this spec stayed in
  `features/` until the Friday backfill was recorded below. `memory_management.md` §9 was rewritten;
  its other sections are kept as April history.
- **DDL.md / export schema final pass:** Phase G changed no schema. The passes confirmed
  `memory_extraction_cursors`, `supersededAt`, the retired `vector_entries` and the dropped
  `chat_settings` columns are documented, and the cursors ride exports under their old chat field
  names.
- **Not run in this environment:** the V4test walkthrough of the card, dialog and CLI against a
  live server, and the Friday backfill. Both need a real instance; the surfaces are covered by
  `memory-maintenance-card.test.tsx`, `maintenance-dialog.test.tsx`,
  `memories-consolidation-actions.test.ts`, `memory-graph-repair.test.ts` and the CLI's
  `memories-maintain-command.test.js`.

### Friday backfill (E2) — done 2026-10-13

The plan was: on the Commonplace Book tab, **Maintenance → Run maintenance…**, choose Friday, untick
nothing, **Dry run**; review the fold sets, the proposed digests and the demote count; then lower
Friday's cap override toward 2,000–2,500 (decision 3) and **Run for real**. Run by Charlie against
the live Friday instance on 2026-10-13 (times UTC).

**Migrations (22:24).** The ten refactor migrations ran in 2.96 s with no errors. Friday held 44,240
memories, not the ~5k §8 assumed, and it made no difference to the timings. `retire-memory-vector-entries-v1`
found every vector already on its row (44,240; 0 copied) and dropped 35 mirror entries for rows that no
longer existed. `recompute-reinforced-importance-v1` rewrote 3,166 rows and `rezone-legacy-memory-occurred-at-v1`
re-stamped 1,862. The maintenance settings carried a 2,000 cap and four per-character overrides,
Friday's at 10,000.

**Dry run, character Friday (22:28), cap 10,000.** Fold: 3,421 compared, 1 set. Consolidate: 4,532
candidates (2,338 of them already cold), 156 qualifying clusters, 10 attempted under the dry run's
budget, 10 digests proposed, 1,226 rows too young. Demote: 3,419 counted, 124 exempt (MANUAL rows and
digests), 0 to archive. Retire skipped (no retention window).

**Scheduled round (22:29–22:33).** The first daily round fired on its own after the dry run and did the
fold and the first 40 clusters: 1 folded, 38 digests created and 2 revised, 87 members superseded, 0
demoted. NanoGPT returned four 429s mid-run; every cluster succeeded on retry. Counted barely moved
(3,416): most consolidation members were already cold, so a digest takes few rows off the cap.

**Run for real (22:38), cap 10,000.** 39 digests created, 1 revised, 79 superseded, 0 demoted.

**Dry run at cap 2,500, then run for real (22:42).** The dry run showed 3,415 counted and 915 to
archive. The real run created 41 digests, superseded 80 and demoted **913** (3,413 counted − 2,500);
the highest protection score demoted was 0.52. Nothing was retired. Thirty-five qualifying clusters
remain for the daily rounds.

Of the other three overrides, only Laura's (4,000 against 2,833 counted) is near its cap; every other
character sits far under the 2,000 default. Left as they are.

Three report labels read wrong on these figures and were fixed afterwards: "Clusters found" counted
singleton clusters (now the qualifying clusters), "Protected" was the exempt MANUAL rows and digests,
and the ledger's back-off note blamed a demotion that had no excess to move.

### V4test dogfood — done 2026-10-13

The phase acceptance walks recorded above as "not run in this environment" were run on V4test
(Built-in TF-IDF embeddings, DeepSeek cheap LLM; database backed up to
`data/backups/pre-dogfood-2026-10-13/` first). Every consolidation setting changed for the test was
restored afterwards.

| Phase | Acceptance | Result |
|---|---|---|
| B | Delete a memory in the browser; the gate sees the live neighbour, not the dead vector | Pass. Deleted `637cb80b` (one of an identical pair) from Lorian's Memories tab; a semantic search of the live index for its exact text returned only the twin `38b5d56a`, and two re-extractions never named the deleted id |
| B | Restart; cold rows stay cold in recall (bug 205) | Pass. After a restart none of Lorian's 10 cold rows appeared among the 35 ids of a full recall replay |
| C | `memory-diff` on three chats | Run (no pre-refactor baseline exists to compare). Admission chained within the dry run (`dry-run:` targets) and reinforced live rows; with TF-IDF, paraphrases mostly land as `insert-linked`, as the thresholds intend |
| C | Live admission in the parent | Pass. A live turn's jobs reinforced (with footnotes, re-embedding where the text changed), absorbed, linked and inserted, each logged as `Memory admitted` |
| D | A room turn mints no more candidates than before | 3 candidates for a two-speaker turn, one more dropped by the hybrid floor. No baseline; nothing runaway |
| D | `memory-diff --dry-run` on an autonomous chat | Not run: V4test has no autonomous room |
| D | Regenerate a long chat; fold-grain observations cover its history | Pass. `regenerate-all` (14 chats, 88 extraction jobs, none failed) moved every chat's other-fold cursor to its last message; "Roses, Rain…" (51 messages) has fold-grain memories from messages 9–47 and self memories from 8–49 |
| E | A continue turn's request body carries recall (bug 199) | Pass. A Skip let Riya answer with no new user message; her logged request's trailing message holds "You remember the following entries… Memory Anchors" |
| E | `debugMemoryLogs` shows the stage trace | Pass, on live turns and in `recall-replay` (query → gather → hydrate → score → select → assemble → deliver) |
| E | Inter-character never repeats an archive row | Pass. `skippedAsDelivered` 7 and 12 on two turns, nothing re-rendered |
| F | Dry run lists phases and counts | Pass, in the CLI and the dialog; the all-character table matches the CLI row for row |
| F | Real over-cap run demotes exactly `demotable − cap` | Pass on Friday (913 = 3,413 − 2,500, above). V4test's largest holder has 36 counted rows, below the 100 minimum cap |
| F | `quilltap memories status` shows the ledger | Pass, including after a restart (seeded from the job rows) |
| F | A job failing after planning writes no `Commonplace/*.md` | Pass. With `QUILLTAP_TEST_MAINTENANCE_FAIL_AFTER_PLAN=1` the job went DEAD ("failed after planning (test flag)"); digests stayed at 4, the vault files kept their 09:05 stamps and the ledger recorded nothing. Run again without the flag: one digest written and `Commonplace/Riya.md` refreshed after commit |
| G | Card, dialog and CLI against a live server | Pass. Exempt counts, "Clusters worth folding", the muted within-cap ledger note (refreshed by the realtime topic, no reload), the all-character dry-run guard, `validate`, `validate --repair` dry and `--write` on a clean graph, and a one-field `consolidation-config` write leaving the other fields alone (bug 244) |

Found in the walk:

- **Bug 245** (fixed 2026-10-14): a turn reopened by Skip, nudge or continue was extracted again
  from its first line, so the earlier speakers' fresh memories were reinforced by their own
  source; an autonomous room's speakers each re-read the room. The turn grain now has a cursor
  (a `turn` row in `memory_extraction_cursors`): lines at or before it ride along as context,
  never material, and a rebuild bounds each autonomous speaker by the previous anchor. This
  retires §3.7's assumption that "the per-turn passes need no cursor".
- **Bug 246** (fixed 2026-10-14): consolidation's fixed 4,000-token budget let `deepseek-v4-flash`
  spend it all reasoning; the empty answer was skipped as unparseable. The cluster call now takes
  the routed profile's budget, 4,000 as a floor.
- `quilltap memories status` printed "0 of 0 over the cap ⚠ ineffective" for a demotion with no
  excess, the same wording the ledger card had; fixed to "within the cap".
- `quilltap memories maintain --character all --dry-run` with no `--phases` fails with the server's
  "a dry run that includes consolidation names one character", as the help says; the dialog
  disables Dry run in the same case and says why. Left as is.

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

---

## Appendices — the four audit reports (2026-10-12)

The diagnosis and the defect table were drawn from four parallel code audits run against
`0841000c7` on 2026-10-12, one per slice of the pipeline. They are reproduced here, lightly
reformatted, so an implementer can check a claim without re-deriving the map. Line numbers are
as of that commit; re-verify before editing. The audits describe; they do not propose — the
proposal is §3.

### Appendix A — Creation and extraction

This covers every path that ends at a memory row, from the trigger to the gate. Every LLM-derived
path persists through `createMemoryWithGate` in `lib/memory/memory-service.ts:373`. Import,
restore and consolidation write the row directly.

#### A.1 Entry points

**A. Live per-turn extraction (main path)**

- Triggers:
  - `triggerTurnMemoryExtraction` in `lib/services/chat-message/memory-trigger.service.ts:56`.
  - Called from `message-finalizer.service.ts:517` when `turnInfo.isUsersTurn || chatType==='autonomous'`.
  - Also called from the courier route `app/api/v1/chats/[id]/messages/[messageId]/route.ts:202`, on every reply with no gating.
  - Also called from `lib/services/help-chat/orchestrator.service.ts:655`. Help chats do get per-turn extraction.
  - Brahma never extracts (`brahma-console/orchestrator.service.ts:10`).
- What the trigger does: it resolves the opener with `findTurnOpenerMessageId` (`turn-transcript.ts:67`). Autonomous chats use the latest ASSISTANT message as the anchor (`memory-trigger.service.ts:77-89`). It then calls `enqueueMemoryExtraction` (`queue-service.ts:521`). Dedup key: (chatId, opener, anchor, foldOtherCatchup).
- Handler: `handleMemoryExtraction` in `lib/background-jobs/handlers/memory-extraction.ts:30`.
  - Hydrates characters (:90-98) and builds the transcript with `buildTurnTranscript`.
  - Resolves Concierge (:125), `getMemoryExtractionLimits()` (:126), project description (:134-147) and `sourceMessageTimestamp` (:157-168: latest assistant, then opener, then chat.createdAt).
  - Calls `processTurnForMemory` and throws `CheapLLMTaskLostError` when `passesLostToTimeout > 0` (:201-209).
- Processor: `processTurnForMemory(ctx: TurnMemoryExtractionContext)` in `lib/memory/memory-processor.ts:370`.
  - Resolves the cheap LLM once (:402-414). The uncensored route is used when `isDangerousChat && policy.routeDirect`.
  - Builds `orienting` (:426), `clock` (:433) and a per-character rate-limit pre-pass (:443, `resolveExtractionRateLimit` :57).
  - SELF pass (:518-596): one call per allowed slice. Canon comes from `loadCanonForSelfWithCommonplace` + `renderSelfCanonBlock`. Calls `extractSelfMemoriesFromTurn` (task `memory-extraction-self`). Throttle mode applies `applyImportanceFloor(rl.floor)`.
  - OTHER pass (:603-743): gated by `getMemoryExtractionModeSettings().otherPass`. `fold` skips it. `hybrid` applies `perTurnOtherFloor` (:700). It makes one multi-subject call per observer via `extractOtherMemoriesFromTurn` (task `memory-extraction-other`). Subjects are the allowed slices plus the user character, deduped (:478-512).
  - Persistence: `writeCandidate` (:255). It resolves `occurredAt`/`narrativeTime` with `resolveEpisodicAnchors` (anchor: slice `lastMessageCreatedAt`, then `sourceMessageTimestamp`, then turnTimestamp, then now). Dry-run collects instead of writing. Otherwise it calls `createMemoryWithGate({..., source:'AUTO', witnessedContext, tags: []})`.
- Caps (`cheap-llm-tasks/memory-tasks.ts`):
  - `HARD_CANDIDATE_CAP = 2` (:42) and `EVENT_EXTRA_SLOT = 1` (:45).
  - `resolveMaxMemories` (:65) = `min(2, max(1, ceil(maxTokens/8000)))`.
  - `capCandidates` (:56) applies the soft-raise when an "anchored event" is present (`kind==='episodic' && (when || entities)`).
  - SELF parser: `parseMemoryCandidateArray` (:835). OTHER parser: `parseOtherCandidatesBySubject` (:718), which collects up to cap+1 per subject.
- Transcript render: `renderTurnContext` (:860), with `ORDERED_TURN_TRANSCRIPT_HEADING` (:852).

**B. Carina answers**

- Enqueued by `carina.service.ts:809` through `enqueueCarinaMemoryExtraction` (`queue-service.ts:568`, dedup on carinaMessageId).
- Handler: `lib/background-jobs/handlers/carina-memory-extraction.ts:33`. It builds a synthetic one-slice `TurnTranscript` (:97-115) and calls `processTurnForMemory`.
- Only SELF memories form, because there is no user character and therefore no subjects.

**C. Fold-grain OTHER pass**

- `runFoldOtherPass` in `lib/memory/fold-other-pass.ts:156`. It is called from `lib/chat/context-summary.ts:578`, after the summary fold.
- Fold cadence: `FOLD_TURN_BATCH=5`, `FOLD_TAIL_FLOOR=5`, `FOLD_TRIGGER_DELTA=10` (`context-summary.ts:50-52`).
- Runs only in `fold`/`hybrid` mode (:162).
- Applies the watermark `chats.otherExtractionWatermarkMessageId` (:175-192), the eligibility filter `isFoldOtherEligibleMessage` (:130), and `FOLD_OTHER_MAX_WINDOW_MESSAGES = 60` (:71, slice at :197).
- Observers are the characters who spoke. Subjects are the observers plus the user character.
- Rate limit is per observer (:297). Canon: `loadCanonForObserverAboutSubject`.
- Calls `extractOtherMemoriesFromFold` (`memory-tasks.ts:1055`). It uses the same OTHER prompt with `grain:'fold'`, which prepends `FOLD_GRAIN_OTHER_BLOCK`, and the same task type `memory-extraction-other`. Per-subject cap is `foldCandidatesPerSubject` (default 3), not budget-clamped. Messages are truncated to 1500 chars.
- Hard re-slice to cap at :370. Writes through the shared `writeCandidate` with a synthetic `writeCtx` (:286). Advances the watermark when no pass timed out (:408).
- Idle catch-up:
  - Daily sweep `enqueueFoldOtherCatchups` (`lib/background-jobs/maintenance/fold-other-catchup.ts:33`) calls `findFoldOtherCatchupCandidates` (:479).
  - Constants: `FOLD_OTHER_CATCHUP_IDLE_MS = 2h`, `FOLD_OTHER_CATCHUP_LOOKBACK_MS = 30d`, `FOLD_OTHER_CATCHUP_MAX_CHATS = 50` (:74-80).
  - It enqueues MEMORY_EXTRACTION with `foldOtherCatchup:true`. The handler branch (`memory-extraction.ts:46`) runs `runFoldOtherCatchup` (:568), which resolves the cheap LLM and Concierge itself.

**D. Fold episode pass**

- `runFoldEpisodePass` in `lib/memory/fold-episode-pass.ts:57`, called from `context-summary.ts:556`.
- Calls `extractEpisodesFromFold` (`memory-tasks.ts:1295`, task `fold-episode-extraction`, prompt `FOLD_EPISODE_PROMPT` :1223). Cap is `FOLD_EPISODE_CAP = 2` (:1221) and the parser clamps importance to [0.2, 1] with default 0.6.
- Each episode is written for every present CHARACTER participant through `createMemoryWithGate` (:133). Keywords are hard-coded `[...entities, 'past', 'scope: narrow', 'history']`, `kind:'episodic'`.
- Afterwards it links fragments via `findByCharacterAndSourceMessageIds`, with `MAX_FRAGMENT_LINKS = 8` (:35).

**E. Re-extraction and regeneration**

- queue-memories: `handleQueueMemories` (`app/api/v1/chats/[id]/actions/memories.ts:68`) calls `enqueueMemoryExtractionBatch` (`queue-service.ts:1156`, no dedup). It handles autonomous chats with anchors and does not wipe first. The UI caller is `app/salon/[id]/hooks/useMemoryActions.ts:81`.
- Dry run: `handleExtractMemoriesDryRun` (:166). It runs `processTurnForMemory({dryRun:true})` with a worker pool (concurrency 4, max 32) and streams NDJSON. Its consumer is the CLI `packages/quilltap/lib/memory-diff-command.js:279`.
- Regenerate chat: `handleMemoryRegenerateChat` (`handlers/memory-regenerate-chat.ts:28`). It wipes with `deleteMemoriesByChatIdWithVectors`, enqueues one job per USER opener with `skipDedupCheck`, and calls `rebuildFoldGrainObservations` (:131), which resets the watermark and enqueues a catch-up with `foldOtherIgnoreIdle`.
- Regenerate all: `handleMemoryRegenerateAll` (`memory-regenerate-all.ts:31`) fans out per-chat regenerate jobs. Entry point is `app/api/v1/memories/route.ts:1252` (`?action=regenerate-all`).
- SillyTavern import: `lib/import/sillytavern-import-service.ts:625-647` calls `enqueueMemoryExtractionBatch`.
- Legacy: `handleInterCharacterMemory` (`handlers/inter-character-memory.ts`) has an empty body (drain only).

**F. Manual and API creation**

- `POST /api/v1/memories`: `handleCreateMemory` (`app/api/v1/memories/route.ts:491`) calls `createMemoryWithEmbedding` (`memory-service.ts:359`), which wraps the gate and throws away the outcome.
- Schema at :76 accepts `source: 'AUTO'|'MANUAL'` and `skipGate`.
- `app/api/v1/memories/[id]/route.ts` is update/delete only.
- There are no store/remember tools under `lib/tools/`. `lib/tools/memory-dedup.ts` is dedup/merge only, and `search-scriptorium-handler.ts` is read-only.

**G. Non-gate writes**

- Import: `importMemories` (`lib/import/quilltap-import/import-entities.ts:437`) calls `repos.memories.create(payload, {id})` at :529, then re-embeds.
- Restore: `lib/backup/restore/restore.ts:343` calls `globalRepos.memories.create(..., {id})`.
- Consolidation digests: `executePlan` (`lib/memory/consolidation.ts:596`) calls `repos.memories.create(create.data, {id, createdAt: now})`. Prompt is `CONSOLIDATION_SYSTEM_PROMPT` (`consolidation-tasks.ts:170`), schema `ConsolidationDigestSchema` (:50). Keyword tags are re-normalised in `consolidation-plan.ts:201-242`.

**H. CLI (`packages/quilltap/`)**

- No CLI path creates memories.
- `memories-commands.js` is read-only (ls/find/grep/show/tree/status/validate, plus semantic search through the API at :645).
- `memories-consolidate-command.js:87` posts `?action=consolidate`.
- `memory-diff-command.js` drives the dry run.

**Gate pre-processing (applies to all gate paths).** `createMemoryWithGate` first runs
`applyNamePresenceCheck` (:142, AUTO only; it can collapse `aboutCharacterId` to the holder) and
`applyEpisodicFallbackAnchors` (:195, AUTO only; regex `extractNovelDetails` fills
entities/occurredAt, `FALLBACK_ANCHOR_MAX_ENTITIES=6`). It then calls `runMemoryGate`.
`skipGate`/`skipEmbedding` lead to `createMemoryDirect`.

#### A.2 Candidate shapes in flight

| Type | Where | Notes |
|---|---|---|
| `MemoryCandidate` | `cheap-llm-tasks/types.ts:13` | All fields optional. `temporal/scope/context` are declared but never populated (the parser folds them into `keywords`). |
| `ExtractedCandidate` | `memory-processor.ts:159` | Dry-run copy of MemoryCandidate plus attribution and resolved anchors. |
| `WriteOptions` | `memory-processor.ts:236` | Wraps candidate and context, plus three mutable output arrays. |
| `CandidateWriteContext` | `memory-processor.ts:225` | Structural subset of `TurnMemoryExtractionContext`; fold-other builds one by hand (`fold-other-pass.ts:286`). |
| `OtherSubjectInput` | `memory-tasks.ts:622` | Re-declared ad hoc as `ResolvedSubject` in `memory-processor.ts:648` and `fold-other-pass.ts:313`. A local `Subject` type at `memory-processor.ts:478` and `Seat` at `fold-other-pass.ts:226` are near-duplicates. |
| `FoldEpisode` | `memory-tasks.ts:1203` | A separate shape (`narrative` vs `content`, `participants` field). |
| `FoldEpisodeMessage` / `FoldOtherMessage` | `memory-tasks.ts:1192` / `:1044` | `FoldOtherMessage` is an alias. |
| `ConsolidationDigestOutput` | `consolidation-tasks.ts:78` (zod) | Third candidate shape. |
| `CreateMemoryOptions` | `memory-service.ts:236` | Gate input. Overlaps `memoryRowFromOptions` (:502). |

Duplication: `MemoryCandidate`, `ExtractedCandidate`, `FoldEpisode` and `ConsolidationDigestOutput`
all carry content/summary/keywords/importance/kind/when-or-occurredAt/entities under different names
and with different optionality.

#### A.3 Prompts (all in `lib/memory/cheap-llm-tasks/memory-tasks.ts`)

- SELF: `selfBodyForCap` (:269), assembled by `getSelfMemoryExtractionPrompt` (:416).
  - First person, past tense. Categories: SELF-HINGES, REVELATIONS, STATE, INTENT, GESTURES, EVENTS.
  - Importance anchors: 0.90 / 0.65 / 0.40 / 0.20 (:323).
  - Preambles: `FIRST_PERSON_USER_CLAUSE` (:405) for user-controlled subjects and `AUTONOMOUS_ROOM_USER_ABSENCE_CLAUSE` (:386).
- OTHER: `otherBodyForCap(cap, grain)` (:465), assembled by `getOtherMemoryExtractionPrompt` (:633).
  - Third person, multi-subject, output tagged by `subjectIndex`.
  - Importance anchors: 0.90 / 0.60 / 0.55 / 0.40 / 0.20 (:529).
  - Fold grain prepends `FOLD_GRAIN_OTHER_BLOCK` (:458). There is no first-person clause.
- Episodic: `FOLD_EPISODE_PROMPT` (:1223) is a standalone prompt with a different clock rendering (an inline `CLOCK:` line, :1314) and none of the AGREEMENTS/TAGS/ORIENTING blocks. It has one sentence on assent.
- Shared blocks: `EVENT_INSTRUCTION_BLOCK` (:168, defines kind/when/entities and the "one beyond cap" rule), `AGREEMENTS_INSTRUCTION_BLOCK` (:192), `TAGS_INSTRUCTION_BLOCK` (:209, temporal/scope/context), `ORIENTING_CONTEXT_SKIP_BULLET` (:153), `renderOrientingContext` (:97, 1500-char truncation), `renderClockBlock` (:127).
- Output fields asked for: content, summary (3–8 words), keywords (2–4), importance, kind, when, entities, temporal, scope, context. `occurredAt` is never asked of the model; it is resolved server-side.
- "Already known": only canon, from `lib/memory/cheap-llm-tasks/canon.ts`. Prior memories are never shown to the extractor; dedup is left entirely to the gate.
  - SELF canon (`renderSelfCanonBlock` :123): MANIFESTO/PERSONALITY/DESCRIPTION/IDENTITY, then `Commonplace/Self.md`.
  - OTHER canon (`loadCanonForObserverAboutSubject` :255 → `loadHandCanon` :274): vault `Others/<name>.md`, else identity, else description, then `Commonplace/<name>.md`.
  - Cap: `CANON_BLOCK_TOKEN_CAP = 2500` (:61). Only the digest is trimmed.
- Parsing: `coerceMemoryCandidate` (:668) defaults importance to 0.5, normalises kind, caps entities at 8, and turns tags into keywords via `applyTargetingTags` (:244, defaults present / wide / information).

#### A.4 Settings read on this path

| Key / source | Accessor | Default | Read at |
|---|---|---|---|
| `instance_settings.memoryExtractionLimits` | `getMemoryExtractionLimits` (`lib/instance-settings/index.ts:215`) | `{enabled:false, maxPerHour:20, softStartFraction:0.7, softFloor:0.7}` (:85) | `memory-extraction.ts:126`, `carina-memory-extraction.ts:121`, `actions/memories.ts:241`, `fold-other-pass.ts:281` |
| `instance_settings.memoryExtractionMode` | `getMemoryExtractionModeSettings` (:267) | schema `settings.types.ts:262`: `otherPass:'hybrid'`, `perTurnOtherFloor:0.75`, `foldCandidatesPerSubject:3` | `memory-processor.ts:606`, `fold-other-pass.ts:161,485`, `memory-regenerate-chat.ts:136` |
| `instance_settings.memoryExtractionConcurrency` | :194 | 1 | job pool only |
| `chatSettings.cheapLLMSettings` | per call | — | every handler |
| `chatSettings.conciergeSettings` | `resolveConciergeSettings` | — | every handler, plus context-summary.ts twice (:361, :577) |
| `chatSettings.autoHousekeepingSettings` | `maybeEnqueueHousekeeping` (`memory-service.ts:63`) | cap 2000, watermark 0.9 | after insert |
| `memoryRecall` | not read on creation | — | — |

#### A.5 Concierge / Locked-chat handling

- Routing: `resolveUncensoredCheapLLMSelection` (`lib/llm/cheap-llm.ts:301`) goes direct only when `isDangerousChat && policy.routeDirect`, which only Unmoderated sets (`resolver.service.ts:241-256`). Locked gives `inert('chat-locked')` (:236): `failoverAllowed:false`, `routeDirect:false`, `desk: NO_DESK`. That means no reroute and no empty-response failover (`core-execution.ts:422`). Help/Brahma resolve to `chat-type-exempt`, which is also inert.
- Dangerous flag: callers pass `shouldUseUncensoredRoute(chat)` (`chat-override.ts:115`).
- Fallback options built by: `memory-processor.ts:416`, `fold-other-pass.ts:626`, `context-summary.ts:584`.
- Fold episode pass: gets the routed `cheapLLM` but no `uncensoredFallback` (`context-summary.ts:556-564`, `fold-episode-pass.ts:100`).

#### A.6 Smells

Dead or ignored inputs:

1. `MemoryChatSettings.conciergePolicy` and `isDangerousChat` (`memory-trigger.service.ts:36-37`) are passed by the finalizer (:497-500) and the courier route (:191-196) but never read by `triggerTurnMemoryExtraction`. The handler resolves both again. The two callers also compute the flag differently (`shouldUseUncensoredRoute(chat)` vs `chat.isDangerousChat === true`).
2. `UncensoredFallbackOptions.isDangerousChat` (`types.ts:100`) is never set on extraction paths (`memory-processor.ts:418`, `fold-other-pass.ts:626`, `context-summary.ts:584`). This disables the uncensored→uncensored empty-retry (`core-execution.ts:431`) and the dangerous stand-in chain (:732).
3. `ExtractionClock.narrativeNow` (`memory-tasks.ts:121`) is never assigned anywhere.
4. `MemoryCandidate.temporal/scope/context` (`types.ts:29-31`) are never populated.
5. `FoldEpisode.participants` (`memory-tasks.ts:1215`) is parsed but unused. Episodes are written for every present participant (`fold-episode-pass.ts:130`).
6. `batchExtractMemories` (`memory-tasks.ts:1120`) has no callers; it is exported via `lib/memory/index.ts:17`. The `applyTags:false` branch of `coerceMemoryCandidate` exists only for it.
7. `handleInterCharacterMemory` is an empty body.
8. The courier route's comment claims extraction "is gated to the user's turn inside the helper" (`route.ts:198-199`). The helper does no such gating.

Same thing computed more than once:

9. Cheap-LLM config built three ways: `toCheapLLMConfig` (`memory-processor.ts:211`), inline at `fold-other-pass.ts:587-596`, and `context-summary.ts:345-354`. Only the last passes `defaultCheapProfileId`.
10. Character hydration loop copied in `memory-extraction.ts:90-98`, `actions/memories.ts:210-218` and `fold-other-pass.ts:208-221`.
11. Project-description lookup copied in `memory-extraction.ts:134-147` and `fold-other-pass.ts:606-613`. It is missing in the Carina handler, the dry run and the context-summary fold-other call.
12. Fold-window rendering (timestamp + 1500-char truncation) is identical at `memory-tasks.ts:1077-1083` and `:1306-1312`. Speaker mapping is duplicated at `fold-other-pass.ts:266-271` and `fold-episode-pass.ts:92-98`. The "last stamped message" clock is duplicated at `fold-other-pass.ts:272-276` and `fold-episode-pass.ts:84-88`.
13. Turn-opener scans reimplemented in `turn-transcript.ts:67`, `memory-regenerate-chat.ts:65-70`, `actions/memories.ts:108-115` and `:226-231`, and `sillytavern-import-service.ts:626-632`. The autonomous-anchor scan appears in both `memory-trigger.service.ts:79-89` and `actions/memories.ts:96-106`.
14. Handler tails duplicated: debug-log persistence, cost event and timeout throw are copied between `memory-extraction.ts:201-268` and `carina-memory-extraction.ts:153-220`.
15. Episodic anchor resolution in three places, with different semantics: `writeCandidate` (`memory-processor.ts:256-271`): reference = fallback = message time; `fold-episode-pass.ts:122-128`: reference = newest message, fallback = oldest; `applyEpisodicFallbackAnchors` (`memory-service.ts:195`): regex over content.
16. Kind normalisation `=== 'episodic' ? ... : 'semantic'` repeats at `memory-tasks.ts:677` and `memory-processor.ts:285`, `:320`. The `witnessedContext` ternary repeats at `memory-processor.ts:315` and `fold-episode-pass.ts:145`.
17. Targeting-tag normalisation implemented twice: `applyTargetingTags` (`memory-tasks.ts:244`) and `consolidation-plan.ts:201-242`. The fold episode pass bypasses both and hard-codes `'past','scope: narrow','history'` (`fold-episode-pass.ts:138`).
18. Importance default handled inconsistently: the parser already defaults to 0.5, then `?? 0.5` again in the dry run (`memory-processor.ts:284`) and `applyImportanceFloor` (:94), but `|| 0.5` on the real write (:306), which turns 0 into 0.5. Then `?? 0.5` once more in `memory-service.ts:545,599`.
19. `memoryExtractionLimits` defaults defined three times: `instance-settings/index.ts:85`, `settings.types.ts:740` (a legacy ChatSettings field still in the schema) and `chat-settings.repository.ts:175`. There is also a migration copy and the `sqlite-initial-schema.ts:519` column default.
20. `getMemoryExtractionModeSettings()` is re-read per turn in the processor and again in each fold and catch-up call.

Contract and behaviour mismatches:

21. Event slot dropped at fold grain: the prompt promises one extra slot for an EVENT (`EVENT_INSTRUCTION_BLOCK`), the parser keeps it, then the fold pass truncates it away (`fold-other-pass.ts:368-370`).
22. OTHER cap differs by grain: budget-clamped to ≤2 per turn (`resolveMaxMemories`), unclamped at fold.
23. Silent loss when the window is trimmed: the fold window is cut to the newest 60 messages (:197), but the watermark advances to the last message (:194, :409). Older uncovered messages are skipped permanently. Regenerate inherits this: in fold/hybrid mode the rebuilt observations only cover the last 60 messages (`memory-regenerate-chat.ts:125-130`).
24. No watermark on the episode pass: a hard-rebuild fold (`forceRegenerate`, `context-summary.ts:390-393`) re-extracts episodes over the whole history, and the gate's date guard deliberately avoids near-duplicate skips. There is also no `isFoldOtherEligibleMessage` filter on the episode window.
25. `createdAt` semantics diverge by path: per-turn: latest-assistant timestamp; fold OTHER: now (`writeCtx` has no `sourceMessageTimestamp`); fold episode: `sourceMessageTimestamp: occurredAt` (:143), so createdAt becomes the event date; import and restore drop `createdAt` (`import-entities.ts:508,512`; `restore.ts:327,343`), so rows appear to be stamped now. The rate limiter counts by createdAt (`countCreatedSince`, `memory-processor.ts:68`), so regenerated or backdated rows are invisible to it.
26. Rate limit is a snapshot: it is resolved once per turn (:443) and not updated as writes land. Fold OTHER re-resolves per observer, and the fold episode pass has no limiter at all.
27. Dry run diverges from live: uses the cheap profile as `connectionProfile` (`actions/memories.ts:197`), so `resolveMaxTokens` and the provider base differ; passes no `sourceMessageTimestamp`, project or orienting context; rejects autonomous chats (:233); never runs the fold pass, so in hybrid mode it under-reports OTHER output.
28. `resolveCheapLLMProfileId` (`actions/memories.ts:38`) returns null unless `defaultCheapProfileId` or USER_DEFINED is set, even though live extraction works under other strategies.
29. Regenerate-chat ignores autonomous chats: no USER openers means one null-opener job (`memory-regenerate-chat.ts:78-97`), whereas queue-memories handles them with anchors.
30. Carina memories miss project context: the handler omits `projectId`, `projectDescription` and `chatContextSummary` (`carina-memory-extraction.ts:127-144`), so Carina memories in a project chat get `projectId: null`. The fold episode pass also omits orienting context and `cheapMaxTokens`.
31. Manual create API: lets the client claim `source:'AUTO'`, which triggers the AUTO-only heuristics; exposes `skipGate`; never sets `witnessedContext:'manual'` or `projectId`, and has no kind/occurredAt/entities; returns 201 even when the gate reinforced an existing row (`route.ts:76-88`, `:505`).
32. Tangled responsibility in `writeCandidate`: one function does anchor resolution, dry-run collection, the gate call and log formatting, and mutates caller-owned arrays (`WriteOptions.debugLogs/createdIds/reinforcedIds/collected`).
33. Rate-limit throttle runs after the hybrid floor: the two floors stack per subject (`memory-processor.ts:699-718`). SELF gets only the throttle.
34. Two canon-loader APIs: `loadCanonForSelf` vs `loadCanonForSelfWithCommonplace` (`canon.ts:175`, `:233`). Consolidation uses the former with a pre-loaded digest.

### Appendix B — Gate, merge, dedup and linking

#### B.1 `lib/memory/memory-gate.ts` (1046 lines)

Constants:

- `NEAR_DUPLICATE_THRESHOLD = 0.90` (:44)
- `MERGE_THRESHOLD = 0.85` (:47)
- `RELATED_THRESHOLD = 0.70` (:50)
- `MAX_REINFORCEMENT_FOOTNOTES = 8` (:58)
- `GATE_TOP_K = 5` (:61)
- `EMBEDDING_RETRY_DELAY_MS = 500` (:64)
- `DATE_GUARD_DAYS = 7` (:71)
- `MAX_DIGEST_HOPS = 3` (:171)
- Delete warning thresholds: 20 neighbours for a single delete, 200 for a batch (:735, :742)

Enums (two of them):

- `GateDecision.action` (:89-94): `INSERT | REINFORCE | INSERT_RELATED | SKIP_NEAR_DUPLICATE | SKIP_EMBEDDING_FAILED`
- `MemoryGateOutcome.action` (:105-111): the same five plus `SKIP_GATE`

Functions:

- `occasionsAreDistinct(a, b)` (:74): true only when both timestamps parse and are more than 7 days apart.
- `runMemoryGate(characterId, content, summary, _keywords /*unused*/, userId, embeddingProfileId?, anchors?)` (:144). Wraps the work in `trackActivity('memory')` and calls `runMemoryGateInner` (:260-419, about 160 lines).
  - Where the candidate embedding comes from: :272, `buildMemoryEmbeddingText(summary, content, anchors)` (`episodic.ts:72`). The text is `summary\n\ncontent`, plus `\n(when: YYYY-MM-DD · story time: … · place: e1, e2…)` when anchors exist (at most 4 entities, `episodic.ts:29,38-60`).
  - The embedding is generated via `generateEmbeddingForUser(..., {priority:'background'})`, with one retry after 500 ms (:276-304). If both attempts fail, the result is `SKIP_EMBEDDING_FAILED` and `embedding: null`.
  - Search: `getCharacterVectorStore(characterId).search(embedding, 5)` with no tier filter, so it sees both hot and cold rows (:309-310). Rows are hydrated with `repos.memories.findByIds` (:320).
  - Decision order: (1) date guard (:332-350) — if the best score is ≥0.85 and the occasions are distinct, the result is `INSERT_RELATED` with only the best match linked, after `redirectColdLink`; (2) ≥0.90 → `SKIP_NEAR_DUPLICATE` after `resolveColdForAbsorb` (:352); (3) ≥0.85 → `REINFORCE`; if the cold redirect fired, the result is rewritten to `SKIP_NEAR_DUPLICATE` (count only, no footnote) (:366-389); (4) matches in the 0.70–0.85 band, redirected cold → digest and deduplicated by target id, → `INSERT_RELATED` (:392-415); (5) otherwise `INSERT`.
- `resolveColdForAbsorb(memory, debug)` (:186-216): follows up to 3 hops of `supersededById` to the digest (`redirected=true`). A cold row with no supersession is promoted to hot through `promoteColdMemory` (:224-241), which calls `updateTierBulk(..., 'hot', {supersededById:null})` and `store.setTier`. So the "decision" function has write side effects.
- `redirectColdLink` (:248-258): the same hop loop, without writes.
- `countReinforcementFootnotes` (:426); `appendCappedFootnotes(content, details) → {content, appended}` (:439-447).
- `patchMemory(memory, patch): Memory|null` (:457-469). It calls `updateForCharacter`. `null` means the row is missing. `undefined` (a buffered write in the job child) returns `{...memory, ...patch}`.
- `reembedMemory(memory, userId, profileId?) → boolean` (:476-515): re-embeds, writes the row, does update-or-add on the vector store, then `save()`.
- `countReinforcement(memory)` (:528-548): calls `repos.memories.incrementReinforcement`. In the child the result is `undefined`, so it builds a local view from the snapshot count + 1.
- `absorbNearDuplicate(existing): Memory` (:558-574): count only. No text, anchor or vector change.
- `reinforceMemory(existing, content, summary, userId, profileId?, anchors?) → {memory, novelDetails}` (:589-685): runs `extractNovelDetails`, then capped footnotes, then the atomic count; upgrades anchors (fills a null `occurredAt`/`narrativeTime`, unions entities capped at 12, :646); re-embeds only if the row was not already at the footnote cap.
- `linkRelatedMemories(newId, charId, related[]) → string[]` (:694-725): appends `newId` to each neighbour's snapshot `relatedMemoryIds` (:704-710), then sets the new row's links as an absolute list.
- `deleteMemoryWithUnlink(id): boolean` (:770-817): raw `SELECT … WHERE relatedMemoryIds LIKE '%"id"%'`, a per-neighbour `updateForCharacter`, then `repos.memories.delete`. Does not touch the vector store.
- `deleteMemoriesWithUnlinkBatch(ids, {currentLinks?}) → number` (:831-935): a raw full scan of every row with non-empty links (:853), with `currentLinks` overriding those rows (:857-865). It then resolves ids to characters in chunks (raw `SELECT`, :889) and calls `bulkDelete` per character. When the result is `undefined` (child), it counts the resolved ids instead (:905-915). Does not touch the vector store.
- `extractNovelDetails(candidate, existing)` (:969-1046): regex extraction of proper nouns, dates, currency, number+unit, CamelCase and acronyms. Uses `STOP_WORDS` (:942).

Which caller branches on which action:

- `memory-processor.ts:325-363` (`writeCandidate`): all six actions are handled; `REINFORCE` pushes to `reinforcedIds`; `INSERT`, `INSERT_RELATED` and `SKIP_GATE` push to `createdIds`; `SKIP_NEAR_DUPLICATE` is not counted as reinforced, even though it does increment the count.
- `fold-episode-pass.ts:157` counts only `INSERT`, `INSERT_RELATED` and `SKIP_GATE` as written. It then links fragments for every non-null outcome, including REINFORCE and absorbed rows (:166-199).
- `app/api/v1/memories/route.ts:505` uses `createMemoryWithEmbedding`, which discards the action. A manual POST that hits REINFORCE or near-dup therefore returns an existing (possibly AUTO) row as if it had been created.

#### B.2 `lib/memory/memory-service.ts` (1817 lines)

Create, update and delete:

- `createMemoryWithEmbedding(data, opts): Memory|null` (:359): a thin wrapper around `createMemoryWithGate`.
- `createMemoryWithGate(data, opts): MemoryGateOutcome` (:373-494): the write chokepoint. Runs `applyNamePresenceCheck` (:142, AUTO only), then `applyEpisodicFallbackAnchors` (:195). If `skipGate || skipEmbedding`, it goes to `createMemoryDirect` and returns `SKIP_GATE` (:398-401). Otherwise it runs the gate and switches on the decision (:419-493). INSERT and INSERT_RELATED call `createMemoryDirectWithEmbedding` and fire `maybeEnqueueHousekeeping` without awaiting it. INSERT_RELATED returns `{...memory, relatedMemoryIds: linkedIds}` (the Bug 26 comment at :471-477 is interleaved with the watermark comment).
- `createMemoryDirect` (private, :540-587): bypasses the gate. It creates the row, then embeds. If embedding fails, the row stays without an embedding (:579-586), which contradicts the reason SKIP_EMBEDDING_FAILED exists.
- `createMemoryDirectWithEmbedding` (private, :593-625): `create` → `updateForCharacter({embedding})` → `addVector` → `save`. Row fields come from `memoryRowFromOptions` (:502-524): `reinforcementCount: 1`, `relatedMemoryIds: []`.
- `updateMemoryWithEmbedding(charId, id, data, opts)` (:630-695): re-embeds when summary, content or anchors change. Its only caller is `lib/search-replace/search-replace-service.ts:199`.
- `deleteMemoryWithVector(charId, id)` (:700-728): checks ownership, calls `deleteMemoryWithUnlink`, then `removeVector` + `save`. In the child, `delete` returns undefined, so this returns false early and skips vector removal. Callers: `app/api/v1/messages/[id]/route.ts:424`, `app/api/v1/chats/[id]/actions/bulk.ts:77`.
- Three near-identical bulk deletes, each with its own copy-pasted per-character vector-removal loop: `deleteMemoriesBySourceMessageWithVectors` (:1639), `deleteMemoriesBySourceMessagesWithVectors` (:1703), `deleteMemoriesByChatIdWithVectors` (:1769).

Search and recall:

- `searchMemoriesSemantic(charId, query, opts)` (:771-1271, about 500 lines). It covers, in order: embed/memo; dimension-mismatch fallback to text search; hot-only `isHotVector` filter unless `includeCold`; `limit*3` top-K; extra probes; literal and entity union via `searchByContent`; `findByIds` hydration (same pattern as gate :320); minScore floor; filters; time window; recall multipliers; `expandRelatedMemories`; R6 background reservation.
- `expandRelatedMemories` (private, :1290-1359): reads `relatedMemoryIds` from the top hits (`RELATED_EXPANSION = {maxPerHit:3, maxTotal:10}`, `recall-tags.ts:235`) and cosine-scores them.
- `searchMemoriesText` (private, :1395-1514): the fallback. It has its own `STOP_WORDS`, rebuilt on every call (:1414).
- `reserveBackgroundSlots` (:752); `markMemoriesAccessed` (:1373, fire-and-forget `updateAccessTimeBulk`).

Plumbing:

- `generateMissingEmbeddings` (:1521): loads the full corpus, then add + save.
- `rebuildVectorIndex` (:1588-1630): `deleteStore` → `getStore` → `addVector(id, emb, {memoryId, characterId})` with no tier stamped. Cold rows read as hot until the next `load()`, so recall's hot-only filter leaks archived rows.
- `maybeEnqueueHousekeeping` (:63): watermark at 0.9, default cap 2000, 15-minute DB throttle.

Gate bypasses ("direct-with-embedding"): `skipGate` (API POST, `app/api/v1/memories/route.ts:87,518`); `consolidation.ts:596` (raw `repos.memories.create` for digests); `lib/backup/restore/restore.ts:343`, `lib/import/quilltap-import/import-entities.ts:529`, `lib/services/ai-import.service.ts:581`.

Gate callers: `memory-processor.ts:297` (`writeCandidate`, which is also used by `fold-other-pass.ts:382`), `fold-episode-pass.ts:133`, and the API POST.

#### B.3 Merge and dedup

`lib/memory/memory-merge.ts`:

- `planMemoryMerge(survivor, losers, excludeIds=[])` (:75-129) is pure. Footnotes accumulate against the growing content (capped); `reinforcementCount` = uncapped sum, written as an absolute value; `reinforcedImportance` is recomputed from the survivor's `importance`; links are unioned, minus the survivor, losers and `excludeIds`; `occurredAt` keeps the earliest value; `lastReinforcedAt` keeps the latest.
- `applyMemoryMerge(survivor, plan, {userId?, profileId?})` (:139-176): calls `patchMemory`, then re-embeds if content or `occurredAt` changed (only when a `userId` is given).
- The header (:5-7) says housekeeping calls this. It is stale: housekeeping pass 2 is retired.

`lib/tools/memory-dedup.ts`:

- `deduplicateCharacterMemories(charId, name, threshold, dryRun, userId?)` (:157-379, about 220 lines): `findByCharacterId` loads the whole corpus, including cold rows; rows are grouped by dimension; O(n²) pairwise cosine, then Union-Find (transitive chaining); `scoreMemory` (:115) picks the survivor using raw `importance`, length and regex specificity. For real runs it plans and applies each merge, then calls `deleteMemoriesWithUnlinkBatch(removeIds, {currentLinks})`, then `removeVector` + `save`, then `invalidateFrozenArchive`. The comment at :264-266 says the plan is "recomputed against the full removal set"; the actual call at :305 passes no `excludeIds` and relies on the `currentLinks` scrub instead.
- `deduplicateAllMemories(userId, threshold, dryRun)` (:388). Only caller: `app/api/v1/system/tools/route.ts:1108` (preview) and `:1142` (apply), with a default threshold of 0.80 (:1100, :1134). It runs synchronously in the request.
- What dedup ignores: the date guard, tier/`supersededById` (deleting a digest leaves cold rows pointing at a dead `supersededById`), `aboutCharacterId`, `kind`, and `source` (MANUAL rows can be deleted).

Lost from each loser in a dedup merge: summary, keywords, tags, entities, narrativeTime, aboutCharacterId, chatId/projectId/sourceMessageId provenance, witnessedContext, kind, higher importance, and `consolidatedFrom`. Only footnoted regex details, the count, links and the earliest `occurredAt` survive.

Housekeeping (`lib/memory/housekeeping.ts`): `runHousekeeping` (:195-436, about 240 lines). `mergeSimilar` and `mergeThreshold: 0.9` (:41-43, :103-104) are accepted but do nothing (:249-253). Pass 1 and pass 3 demote rows to cold without `supersededById`, so the gate will re-promote them on re-observation. Its only deletion is retention, through `deleteMemoriesWithUnlinkBatch(expiredIds)` (:397).

Consolidation, the other combine path (`consolidation-plan.ts` `planConsolidationWrites` :268-476; `consolidation.ts` `executePlan` :561-640): digest count = sum capped at 50 (`DIGEST_REINFORCEMENT_CAP`, :50); links are unioned and remapped; entities and tags are unioned; chatId/projectId are kept only when every member shares them; members go cold with `supersededById`; `linkRewrites` re-aim inbound links at the digest.

#### B.4 `lib/database/repositories/memories.repository.ts`

`HOT_TIER_SQL = COALESCE(tier,'hot')='hot'` (:33).

| Method | Shape |
|---|---|
| `findById` / `findAll` (:71/:79) | base |
| `findByIdForCharacter` (:89) | filter {id, characterId}, null on error |
| `findByCharacterId` (:110) | {characterId}, no tier filter, `[]` on error |
| `findByCharacterIdInBatches` (:129) | sort id, skip/limit, all tiers |
| `findByIds` (:160) | `$in`, `[]` on error (a DB failure reads as "no matches") |
| `findByCharacterIdPaginated` (:185) | loads all matching rows sorted, then searches and slices in JS |
| `searchByContent` (:248) | regex $or content/summary, no tier filter |
| `findByImportance` (:281), `findBySource` (:307), `findRecent` (:328, createdAt DESC) | no tier filter |
| `findMostImportant` (:361) | raw, hot, ORDER BY reinforcedImportance DESC, COALESCE(lastReinforcedAt,createdAt) DESC, id |
| `findRecentByImportanceTier` (:430) | tier 'hot'; SQL filters on raw `importance`, but the medium bucket re-filters on `reinforcedImportance ?? importance` (:460). A row with importance 0.6 reinforced past 0.7 falls out of both high and medium. |
| `create` (:490) | defaults tier 'hot', consolidatedFrom [] |
| `update` (:513) | — |
| `updateForCharacter` (:531) | findById, ownership check, update (two statements, not atomic) |
| `incrementReinforcement(charId, id, at)` (:571-606) | `getRawDatabase()` sync transaction: SELECT importance/count, UPDATE count+1, reinforcedImportance, lastReinforcedAt, updatedAt; null if missing |
| `delete` (:613), `deleteForCharacter` (:630) | unused, bypasses unlink |
| `bulkDelete(charId, ids)` (:657) | chunked deleteMany |
| `updateAccessTime` / `updateAccessTimeBulk` (:686/:715) | — |
| `countByCharacterId` (:738) | all tiers |
| `countHotByCharacterId`, `countUnconsideredHot`, `findColdIdsByCharacterId` (:758/:777/:801) | raw |
| `findHotDigests` (:824) | raw, source CONSOLIDATED, hot, same ORDER BY as `findMostImportant` |
| `updateTierBulk(charId, ids, tier, extra)` (:874) | chunked updateMany |
| `markConsidered` (:911); `findSupersededBy` (:934, unused via `memories.`); `findExpiredColdIds` (:947, raw) | — |
| `countCreatedSince`, `countWithoutEmbedding`, `findIdsWithoutEmbedding` (:974-1030) | — |
| `findByCharacterAboutCharacter` (:1038) | sort importance, createdAt; no tier filter |
| `findByCharacterAboutCharacters` (:1071) | raw ROW_NUMBER window, hot |
| `findByChatId`, `findBySourceMessageId`, `findByCharacterAndSourceMessageIds` (:1117-1168) | all tiers |
| `deleteBySourceMessageId` (:1175), `deleteByChatId` (:1231) | unused, bypass unlink and vectors |
| `countBy*` (:1191-1282), `findDistinctChatIds` / `findDistinctCharacterIds` (raw) | — |
| `countMemoriesWithText` / `findMemoriesWithText` / `replaceInMemories` (:1344-1503) | `replaceInMemories` has no re-embed of its own and its name is unclassified for the child proxy (it would throw there) |
| `searchByContentAboutCharacter` (:1512) | no tier filter |

#### B.5 Vector store (`lib/embedding/vector-store.ts`, 656 lines)

- Storage: `CharacterVectorStore` (:97) keeps a `Map` of entries plus dirty sets. The data lives in `vector_entries` (id, characterId, BLOB, createdAt; no FK to `memories`, `migrations/scripts/sqlite-initial-schema.ts:652`). That is a second copy of `memories.embedding`.
- Load: `load()` (:112) reads meta and entries, plus `findColdIdsByCharacterId`, and stamps `metadata.tier`. Tier is not persisted. If the lookup fails, everything reads as hot (:493-504). If the whole load fails, it starts empty (:152-164).
- Tier helpers: `isHotVector(m) = m.tier !== 'cold'` (:89). `setTier` (:506) works in memory only.
- Save: incremental through `addEntries` / `removeEntries` / `updateEntryEmbedding` / `saveMeta` (:170-231).
- Search (:340, brute force): linear scan + sort when there are fewer than 1000 entries or `limit*4 ≥ size`, otherwise a bounded min-heap (:414). A dimension mismatch returns `[]`.
- Cache lifetime: `VectorStoreManager` (:549) caches stores for the life of the process. There is no TTL, and `getStore` (:559) does not memoize the load promise, so concurrent first loads can create two instances.
- Invalidation: `unloadStore` is called from `job-dispatcher.ts:745`, `child-entry.ts:211` (via IPC), and `handlers/embedding-generate.ts:186`. `unloadAll` is called from `reapply-profile.ts:405` and `startup/reconcile-embedding-dimensions.ts:200`.
- Parent/child: `dispatchInvalidations` (`job-dispatcher.ts:697-734`) runs after the child's writes commit. It does `notifyChild('vectorStore', id)` and unloads the parent store for any method in `WRITES_INVALIDATING_VECTOR_STORE` (:762-773: `vectorIndices.{deleteStore,addEntry,updateEntryEmbedding,saveMeta}`, `memories.{updateForCharacter,delete,create,upsert,updateTierBulk}`). The id comes from `firstIdArg` (`lib/realtime/job-topics.ts:154`). `memories.delete(id)` yields a memory id, so the unload is a no-op. `memories.bulkDelete` and `vectorIndices.addEntries` / `removeEntries` are not in the list. They are covered only incidentally, by `saveMeta`.

#### B.6 The `relatedMemoryIds` graph

Writers: `linkRelatedMemories` (gate :694); `fold-episode-pass.ts:185-197` (episode ↔ window fragments, `MAX_FRAGMENT_LINKS`); `planMemoryMerge` (memory-merge :102-107); consolidation `planConsolidationWrites` (:341-346, :458-465) → `executePlan` (:627); the delete scrubs (gate :792, :875); PUT `app/api/v1/memories/[id]/route.ts:26,89`: arbitrary user-supplied ids, not made bidirectional, not checked for existence or character; import/restore uuid remap (`lib/backup/restore/uuid-remap.ts:346`, `lib/import/quilltap-import/import-entities.ts:518`).

Readers: `expandRelatedMemories` (memory-service :1308); `calculateProtectionScore` graph degree (`memory-weighting.ts:279`), so links affect retention; consolidation `loadCorpus` (`consolidation.ts:347`); CLI `show` / `tree` / `status`.

Repair and integrity: spec `docs/developer/features/complete/repair-memory-graph-integrity.md` still says "Status: Proposal / Not Implemented" even though the chokepoint exists (stale). One-off migration `migrations/scripts/repair-dangling-related-memory-edges-v1.ts`, registered in `migrations/scripts/index.ts:291/708/1127`. CLI `packages/quilltap/lib/graph-integrity.js` `scanDanglingEdges` (:31), used by `memories status` and the read-only `memories validate [--list] [--json]` (exits 1 when dangling edges remain; `memories-commands.js:1344`). There is no CLI repair verb, and nothing repairs orphan vectors or dangling `supersededById`.

#### B.7 Job-child write semantics (`lib/background-jobs/child/child-repositories-proxy.ts`)

- Classification: by prefix (:208-209) plus overrides; `memories.updateForCharacter` is forced to `write` (:236).
- Buffered writes: `create*` returns a synthetic `{id, ...data}` and injects the id into `args[1]` (:427-443). `upsert*` returns its input. Every other write returns `undefined` (:454). Reads go to the readonly DB with no overlay for memories (the only overlay is equipped outfits, :481-484); there is just a heuristic warning (:485-501).
- Callers that handle the `undefined`: `patchMemory` (gate :461), `countReinforcement` (:535), and the batch-delete count (:905-915).
- `deleteMemoryWithVector` treats `undefined` as "not deleted" (memory-service :713-716).
- Read-your-writes hazards in the child: (a) a memory INSERTed earlier in the same job is in the child's in-memory vector store, but `findByIds` cannot see it; `bestMemory` comes back undefined, so a second near-identical candidate in the same job is INSERTed (gate :325, :352, :366, :393); (b) two INSERT_RELATED results linking to the same neighbour in one job: each writes `[...snapshot, newId]` (gate :704-710); the last write wins and the earlier link is lost; (c) two REINFORCE results on one row in one job: the second content patch is built from the pre-job snapshot and drops the first's footnotes (gate :600, :666); the atomic count is still correct; (d) in the fold-episode pass, fragments created earlier in the same job are invisible to `findByCharacterAndSourceMessageIds`.
- Host-RPC (`host-rpc-dispatcher.ts:69-137`) covers only file and vault bridges plus `startScheduledAutonomousRun`. No memory method goes through it.

#### B.8 Smells

Orphan-vector masking bug: `DELETE /api/v1/memories/[id]` (`app/api/v1/memories/[id]/route.ts:132`) and `lib/characters/archive-service.ts:764` call the unlink chokepoint but never remove the vector. There is no FK on `vector_entries`. An orphan top-1 hit makes `bestMemory` undefined, which skips the near-dup and reinforce branches, and the related band excludes scores ≥0.85 (gate :393). A live second match at ≥0.85 is therefore ignored and the candidate is INSERTed.

Stale vectors: PUT `app/api/v1/memories/[id]/route.ts:89` edits content through the raw `updateForCharacter`, with no re-embed (only a BUILTIN refit). `handlers/embedding-generate.ts:146` and `handlers/embedding-refit.ts:94` embed `summary\n\ncontent` without `buildMemoryEmbeddingText`'s anchor line. That breaks the "single source of truth" stated at `episodic.ts:64-67`.

Thresholds defined in many places: gate 0.90 / 0.85 / 0.70; dedup default 0.80 (`system/tools/route.ts:1100`, `:1134`); housekeeping `mergeThreshold` 0.9, dead (`housekeeping.ts:104`); consolidation `clusterThreshold` 0.72 (`settings.types.ts:225`); `anchor-gate-probe.ts` re-derives the gate thresholds. Recall's R1 "boost gate" (`recall-tags.ts`, memory-service :1236) is a name collision with the Memory Gate.

Three reinforcement-count semantics: gate atomic +1; `planMemoryMerge` absolute, uncapped sum written through `updateForCharacter` (memory-merge :118-121), breaking the rule stated at repository :562-564; consolidation sum capped at 50.

Overlapping action meanings: `SKIP_NEAR_DUPLICATE` means both "≥0.90" and "0.85–0.90 redirected to a digest" (gate :369-378); `SKIP_GATE` means both `skipGate` and `skipEmbedding` (memory-service :398); `INSERT_RELATED` is both "band match" and "date-guard split". The date guard inspects only the top-1 result, so a same-occasion ≥0.90 hit at rank 2 is ignored (:332-350).

Two ways to do one thing: `createMemoryDirect` vs `createMemoryDirectWithEmbedding` (memory-service :540 / :593); `resolveColdForAbsorb` vs `redirectColdLink` (duplicate hop loops, gate :195 / :251); add-or-update vector + save is written four times: gate :496-505, memory-service :677-686, `consolidation.ts:578-593`, and `embedding-generate.ts:173-186` (which bypasses the store); the three per-character vector-removal loops in memory-service (:1660, :1730, :1786); `STOP_WORDS` twice (gate :942, memory-service :1414); cosine twice: `consolidation-clustering.ts:82` vs `cosineSimilarity`; link union in five places: gate :704, memory-merge :102, consolidation-plan :341/:463, fold-episode-pass :177-196, batch-delete :873. The gate ignores `aboutCharacterId`, `kind` and `source`, so a MANUAL candidate can REINFORCE into an AUTO row.

Functions over 150 lines: `searchMemoriesSemantic` about 500 (:771-1271); `runConsolidation` about 356 (`consolidation.ts:711-1067`); `runHousekeeping` about 240; `deduplicateCharacterMemories` about 220; `planConsolidationWrites` about 208; `runMemoryGateInner` about 160.

Dead or unsafe code: `deleteForCharacter`, `deleteBySourceMessageId` and `deleteByChatId` have no callers and skip both the unlink and the vector cleanup; `_candidateKeywords` is unused (gate :148); `maybeEnqueueHousekeeping` falls back to a hard-coded cap of 2000.

Recall re-derives gate state: recall depends on the gate's links (`expandRelatedMemories`) and repeats the gate's top-K → `findByIds` hydration (memory-service :1101 vs gate :320). The gate searches both tiers while recall searches hot only. Because `rebuildVectorIndex` adds vectors without a tier, cold rows look hot to recall until the next `load()`.

### Appendix C — Scoring and recall

Biggest findings: all recall text, the frozen archive included, goes into a trailing section of the
new user message, not system block 1. On continue turns that recall text is never delivered, but
the memories are still marked accessed and recorded as whispered. On the per-turn paths,
entity-anchor hits are still cut by the cosine floor, even though the code comments say they must
not be.

#### C.1 Scores

`lib/memory/memory-weighting.ts`:

- `referenceTimeMs` (:49): `max(createdAt, lastReinforcedAt)`. `lastAccessedAt` does not reset the decay clock.
- `calculateEffectiveWeight` (:75–101), with `DEFAULT_WEIGHTING_CONFIG` (:26) = `{halfLifeDays: 30, importanceFloor: 0.70, minWeightThreshold: 0.05}`:
  ```
  base = reinforcedImportance ?? importance
  daysOld = max(0,(now-ref)/86400000)
  timeDecayFactor = 0.5^(daysOld/30)
  rawWeight = base*decay
  minWeight = base*0.70
  effectiveWeight = max(rawWeight, minWeight)
  ```
- `RANKING_RELEVANCE_WEIGHT = 0.75`, `RANKING_PRIORITY_WEIGHT = 0.25` (:119–120). `computeRankingBlend(cos, raw) = 0.75*cos + 0.25*rawWeight` (:128). It uses `rawWeight` (no floor); the comment at :104–117 says the floor "must not leak into retrieval ranking".
- `DEFAULT_MIN_COSINE_NEURAL = 0.30`, `DEFAULT_MIN_COSINE_TFIDF = 0.10` (:143–144). `defaultMinCosineForProvider` picks 0.10 when the provider is `BUILTIN`.
- `formatRelativeAge` (:164): the age label uses the event clock (`occurredAt`, else the reference time). Decay stays on the write clock.
- `calculateProtectionScore` (:257–311), with `DEFAULT_PROTECTION_CONFIG` (:221):
  ```
  decay = 0.5^(days/30)
  content = min(0.40, base*max(decay, 0.10))
  reinf = min(0.25, log2(reinforcementCount??1 + 1)*0.08)
  graph = min(0.10, relatedMemoryIds.length*0.025)
  recentAccess = 0.10 if lastAccessedAt < 90d
  episodic = 0.10 if kind==='episodic'
  score = min(1, sum)
  ```
  Housekeeping compares it to `PROTECTION_THRESHOLD = 0.5` (`housekeeping.ts:26`).
- `rankMemoriesByWeight` (:317): filters `effectiveWeight >= 0.05` and sorts by `effectiveWeight`. Only `character-optimizer.service.ts:776` uses it.

`reinforced-importance.ts:12`: `min(1.0, base + log2(count+1)*0.05)`. Called from the repository's atomic reinforcement (`memories.repository.ts:589`, base `row.importance ?? 0.5`), `memory-gate.ts:544` (base `memory.importance`), `memory-merge.ts:120`. New rows are written with `reinforcementCount: 1, reinforcedImportance: importance` (`memory-service.ts:520–522`). The formula at count 1 would give `+0.05`, so a fresh row sits 0.05 below what any recompute would produce.

`recall-tags.ts`:

- Vocabularies (:45–60): temporal past / moment / present / future; scope narrow / wide; context 7 words. Defaults: present / wide / information (:67–69). `parseTargetingTags` (:331) reads them from `keywords`; the last match wins.
- `RECALL_MULTIPLIERS` (:167–220):

  | Multiplier | Value |
  |---|---|
  | scopeNarrowSameProject | 1.15 |
  | scopeNarrowCrossProjectDownWeight | 0.15 |
  | temporalPast | 0.85 |
  | temporalMoment | 0.7 |
  | contextMatch | 1.1 |
  | participantPresent | 1.2 |
  | recentlyWhispered | 0.6 |
  | temporalPastRetrospective | 1.15 |
  | temporalMomentRetrospective | 1.0 |
  | occurredWithinWindow | 1.3 |
  | freshEvent24h | 1.3 |
  | freshEvent48h | 1.15 |

- Other constants: `MULTIPLIER_CLAMP = {0, 4}` (:228); `RELATED_EXPANSION = {maxPerHit: 3, maxTotal: 10}` (:235); `RECALL_TUNING_DEFAULTS` (:276): `boostGate {abs: 0.45, margin: 0.15, ramp: 0.1}`, `boostCap 1.4`, `specificAnchors true`, `anchorMinHits 1`, `anchorOrder 'rarest'`, `backgroundReserve 0`, both bypasses false.
- Gate (R1): `boostGateThreshold = max(abs, bestCosine − margin)` (:250). `boostGateStrength` (:259): 1 if `cos ≥ thr`; 0 if `ramp ≤ 0`; otherwise `clamp((cos−(thr−ramp))/ramp, 0, 1)`.
- Individual factors: `scopeProjectMultiplier` (:368): `exclude` → `{0, exclude: true}`. `temporalMultiplier` (:403): flips direction on retrospective turns. `occurredWithinMultiplier` (:437): event time `occurredAt ?? createdAt`. `freshEventMultiplier` (:471): age ≤ 24h → 1.3, ≤ 48h → 1.15; skipped when `memory.chatId === currentChatId` (echo guard) and for future times. `recentlyWhisperedMultiplier` (:547): suspended on retrospective turns.
- `combineRecallMultipliers` (:593–660):
  ```
  product = Π all
  boost = Π(f>1); penalty = Π(f≤1)
  ungated = fresh/window if bypass
  gatedBoost = boost/ungated
  if (boost>cap || (strength<1 && gatedBoost>1)):
     scaled = 1 + (min(gatedBoost,cap)−1)*strength
     combined = penalty*min(scaled*ungated, cap)
  else combined = product
  clamp [0,4]
  ```
- `buildTurnRecallContext` (:703) builds the per-turn context and fills `recentlyWhisperedIds` from `chat.commonplaceRecallHistory`. `buildRetrospectiveProbes` (:731): probe 1 is the joined entity names; probe 2 is `"${paraphrase} (around YYYY-MM-DD to YYYY-MM-DD)"`.

`recall-tuning.ts`: `DEFAULT_RECALL_TUNING` (:67) spreads `RECALL_TUNING_DEFAULTS`. A second copy of the defaults is assembled inline in `recallTuningOf` (`recall-tags.ts:289`). `RecallTuningInputSchema` (:86) bounds the knobs; `resolveRecallTuning` (:133) treats 0 or null as "term off". `selectSpecificAnchors` (:166, max 3): drops names of people in the room and names with fewer than `minHits` matching memories; rarest first.

Retrospective classifier: prompt definition `cheap-llm-tasks/memory-tasks.ts:804`. `extractMemorySearchKeywords` (:1440 and following): LLM output keywords ≤ 10, entities ≤ 5; a date-only `timeRange` is normalised to the UTC day (`T00:00:00.000Z` to `T23:59:59.999Z`); `mergeDayReference` (:1394): a deterministic past-pointing reference overrides `timeRange` and forces `retrospective: true`; the deterministic scan covers only the last `DAY_REFERENCE_SCAN_MESSAGES = 4` messages (:1369), realtime timelines only. `day-references.ts` works in the server-local calendar: "last night" = previous day 18:00 to 06:00 local; "last week" = previous local calendar week; `MAX_DAYS_AGO = 14`; the latest match in the text wins (:205).

Episodic helpers (`episodic.ts`): `buildMemoryAnchorLine` (:38): `(when: YYYY-MM-DD · story time: X · place: a, b)`, at most 4 entities. `buildMemoryEmbeddingText` (:72): `${summary}\n\n${content}` plus `\n(anchor)` when anchors exist. `resolveWhenPhrase` (:126) is the write-side resolver and is UTC point-date based: yesterday or last night = anchor − 1 day at 00:00Z; last week = −7 days; last month = −30; last season = −182. `eventReferenceTimeMs` (:224). `episodic-anchors.ts:47` (`resolveEpisodicAnchors`) wraps `resolveWhenPhrase`. No ×0.7 "fresh demotion" exists in this code; the only 0.7 factors are `temporalMoment: 0.7` (recall-tags.ts:175) and the 70/30 compression split (context-manager.ts:1952).

Subject attribution: `about-character-resolution.ts:108` (`resolveAboutCharacterId`) is write-side. Rules: null passes through; self is kept; about-name absent → flip to holder; holder named strictly more often → flip. `memory-subject.ts:33` (`buildMemorySubjectContext`) is read-side: one `findNamesByIds` query. Its output feeds `formatMemorySubjectPrefix` (`memory-injector.ts:240`), which prints `About <Name>: ` or `About another character: `.

Same quantity, computed differently:

| Quantity | Where | What it uses |
|---|---|---|
| Retrieval rank | memory-service.ts:1188–1195 and 1235–1239 | `0.75·cos + 0.25·rawWeight` (no floor) |
| Dynamic-head fallback sort (no `recallAdjustment`) | memory-injector.ts:713–729 | floored `effectiveWeight` first (Δ > 0.05), then cosine |
| `formatMemoriesForContext` (Carina) | memory-injector.ts:424–433 | floored `effectiveWeight` first; re-sorts the blend order |
| Inter-character importance half | memory-injector.ts:559–566 | digests first, then floored `effectiveWeight` |
| Inter-character SQL pre-cut | memories.repository.ts:1085–1088 | raw `importance DESC`, then `COALESCE(lastReinforcedAt, createdAt)` |
| Frozen archive pool | `findMostImportant` (repository :369) | `reinforcedImportance DESC`, then re-ranked by floored `effectiveWeight` (frozen-archive-cache.ts:189) |
| Housekeeping protect gate | housekeeping.ts:129 | `calculateProtectionScore` |
| Housekeeping demotion order | housekeeping.ts:318 | floored `effectiveWeight` (ignores the usage evidence the protection score uses) |
| Consolidation | consolidation.ts:308, 387 | raw `reinforcedImportance` |
| `commonplace-file.ts:94` | — | raw `reinforcedImportance` |
| First-message context | first-message-context.ts:216 | raw `importance` only |
| Search tool, final cross-source sort | search-scriptorium-handler.ts:525 | `relevanceScore = mr.score` (cosine, literal-boosted); the blend is discarded |
| `minImportance` filters | memory-service.ts:1135, 1360, 1467 | raw `importance`, not `reinforcedImportance` |

#### C.2 Recall paths into the prompt

Budget (`context-manager.ts`, `model-context-data.ts:264`): `memoryBudget = max(2000, 4% of totalLimit)`. `sizeMemoryPools` (`memory-injector.ts:103`):
```
headTokens = min(budget, clamp(round(0.15*budget), 200, 1200))
headEntries = clamp(round(headTokens/40), 5, 15)
retro: headTokens = min(budget, max(600, 2*headTokens)); headEntries = max(10, 2*headEntries)
archiveSize = clamp(round((budget − ordinaryHeadTokens)/60), 25, 60)
archiveTokenBudget = budget − headTokenBudget   (uses the *turn's* head)
```
Inter-character budget = `floor((memoryBudget − memoryTokens − currentStateTokens)/2)` (:1777). Phase-2 compression has its own ceiling, `MEMORY_BUDGET_RATIO = 0.20 × maxAvailable` (model-context-data.ts:347), with a 70/30 semantic/inter-character split (:1951). This is a second memory budget that is inconsistent with the 4% allocation.

Frozen archive (`frozen-archive-cache.ts`): cache key `${characterId}\0${chatId}` (:69); freshness check `generation === compactionGeneration && size === size && presence === sorted other-present ids` (:97); LRU max 64 entries (:44). Composition (`computeFrozenArchive`, :157): `findHotDigests(char, otherId, 3)` for each person present; `findHotDigests(char, 'self', 5)`; fill from `findMostImportant(char, size×4)`, re-ranked by floored `effectiveWeight`; sort by `id`. Format (`formatFrozenMemoryArchive`, injector :628):
```
## Memory Anchors
- {About X: }{summary}{ (from N notes)} _(importance 0.80 · keywords: a, b)_
```
Byte-stability is broken on several axes: the archive's token budget shrinks on retrospective turns (`archiveTokenBudget` follows the turn's head, :1561), so truncation can differ; a change in who is present or in the budget changes the key; Phase-2 `compressMemories` rewrites the combined text (:1957); the archive does not sit in a cached prefix.

Where recall lands: all memory sections are combined via `buildCommonplaceLLMContext` (`commonplace-notifications/writer.ts:146`) and appended to the new user message as a trailing section (`context-manager.ts:2787`). System block 1 holds only the identity stack (:2236 and following). The persisted persona whisper (`systemSender: 'commonplaceBook'`, `kind: 'consolidated'`, writer.ts:224) is removed from LLM context by `isRecordOnlyMessage` (`context-builder.service.ts:852`); the exception is `relevant-conversations`. Continue mode (no `newUserMessage`): the `trailingOnly` list (:2810) leaves out `llmRecallText`. Recall is still computed, posted to the transcript, marked accessed (:1608) and written to the recall-history ring (:2585), yet it appears never to reach the model. LLM framing text: "You remember the following entries that bear on this moment:" (archive and head); "You also recall about the others present:" (inter-character); "You remember the gist of what has happened so far:" (recap); "Here is the present state of the scene:" (current state).

Dynamic head. Proactive path (`pre-compute.service.ts:196`): distils "messages since the character last spoke"; query = paraphrase, else the joined keywords; `limit = PROACTIVE_RECALL_POOL_SIZE = 60 + 15×2 = 90` (:48); `minImportance: 0.3`; passes `recallContext`, `entityAnchors`, `occurredWithin` (whether or not the turn is retrospective) and `extraProbes`. Fallback path (`context-manager.ts:1422`): distils the last 12 messages, interactive latency; `limit = headEntries×3`; `minImportance = 0.5` (default at :731 and context-builder.service.ts:1090). Both paths: candidates already in the archive are dropped (:1417, :1550). `formatDynamicMemoryHead` (injector :697) sorts by `blendedAfter` when present, takes `maxEntries`, and enforces the token cap. Line shape:
```
Most relevant memories for this turn:
[m_abcd] [3 days ago · story time] {About X: }summary{prov} _(importance · relevance · weight · recall: past↓ cap1.4 gate×0.50 · keywords: …)_
```
The `weight` shown is floored `effectiveWeight`, which is not the value the head was ranked on. The `recall:` debug labels and the targeting-tag keywords (`scope: narrow`, `past`) are printed into the model's text.

`whisperedMemoryIds` and access marking: `whisperedMemoryIds` = the head's `debugMemories` ids only (:1601). They are persisted via `appendRecallTurn` only if the persona whisper was posted (:2583). The ring keeps `RECALL_HISTORY_TURNS = 3` turns and skips empty turns (recall-history.ts:18, 79). `markMemoriesAccessed` covers archive + head (:1608) and inter-character (:1846). Both run before Phase-2 compression, which can drop lines afterwards. Recap memories are never marked accessed. The search tool, Carina, voice-rewrite and first-message each mark accessed separately.

Inter-character memories (`context-manager.ts:1756–1858`). Importance half: `findHotDigests(char, other, INTER_CHAR_DIGEST_LIMIT = 2)` plus `findByCharacterAboutCharacters(char, others, 5)` (SQL `ROW_NUMBER` partition, repository :1071). Relevance half: one `searchMemoriesSemantic` call per other character, on the raw recent-window query (not the distilled one), with `limit 5`, `minImportance 0.5`, `aboutCharacterId`, and no `recallContext`. Each call re-embeds the same query (no capture or reuse). Formatter (injector :500): per character, the relevance half is sorted by cosine, the importance half by digest-first then floored `effectiveWeight`, and the two are interleaved. Line shape: `- About Name: [age] content{prov}{meta}`. Duplication: the archive's top-3 present-character digests and inter-character's top-2 come from the same SQL ordering, so the top 2 appear in both sections. There is no cross-section dedup against the archive or head.

Recap (`memory-recap.ts:285`): chat start / character join only. Source: `findRecentByImportanceTier` (repository :430) with limits high 20 / medium 10 / low 5, newest first. Bug: high and low filter raw `importance` (≥ 0.7, < 0.3) in SQL, but medium filters `reinforcedImportance < 0.7` after a raw `importance ≥ 0.3` query. A row with importance 0.65 and reinforcedImportance 0.73 lands in neither bucket. Digests lead the high bucket; the cheap LLM writes a narrative; output begins `## What You Remember`, followed by the conversation lists. Phase timeout 60s (:111).

Conversation summaries (`conversation-summary-search.ts`): chunk pool `max(limit×4, 20)`, keeping the best chunk per file. Time window: hard filter if ≥ `limit` hits, otherwise a local `CONVERSATION_WINDOW_BOOST = 1.3` (duplicates `occurredWithinWindow`). Used in three places: per-turn list (setting `perTurnConversationSummaries`; reuses the captured embedding; ramp 3→10 over 4k→32k); retrospective mini-recap (`RETRO_MINI_RECAP_MAX_ENTRIES = 5`, deduped against the standing fold whisper via `collectFoldWhisperConversationIds`, spam-guarded by retro signatures, `RETRO_SIGNATURE_TURNS = 3`); the recap. The ramp constants are duplicated in `memory-recap.ts` (`RECAP_CONVERSATIONS_*`).

Other consumers. Carina (`carina.service.ts:208`, `loadCarinaMemoryRecall`): limit 12, `minImportance 0.3`, budget 1200, no `recallContext`; formatted with `formatMemoriesForContext` (`## Relevant Memories`, floored-weight re-sort) and appended to the system prompt (:584). First-message (`first-message-context.ts:99`): up to 3 from `findByCharacterAboutCharacter` (no hot-tier SQL filter, so it filters cold in JS), then semantic search on `name - description` with `limit 8` and an explicit `minScore 0.4` (overrides the provider floor, so on TF-IDF it acts as a 4× floor); text fallback only if semantic returned nothing; final sort by raw `importance`. Voice-rewrite (`voice-rewrite-core.ts:60`, `recallForSeed`): limit 20, `minImportance 0.3`, `maxEntries 12`; it reuses `formatDynamicMemoryHead` without `maxTokens`, so the cap is `DYNAMIC_HEAD_TOKEN_BUDGET = 200` tokens; it leads the user-role message. API (`app/api/v1/memories/route.ts:553`): includes cold rows; its comment at :574 ("Access times are bumped inside searchMemoriesSemantic") is stale (see memory-service.ts:1361).

#### C.3 Tool-side recall

`search` tool (`lib/tools/handlers/search-scriptorium-handler.ts:233–303`): defaults `limit 10`, `minImportance 0`; search options `applyLiteralPhraseBoost: true`, `includeCold: true`, a hard time filter, optional `aboutCharacter` (resolved by name/alias over `findAll`); merged with the other sources by cosine; only the surviving memories are marked accessed (:536). Format (:594): `[Result N - Memory{archived}] (Importance: High/Medium/Low, Relevance: NN%)` with thresholds 0.7 / 0.4, which differ from the repository tiers (0.7 / 0.3).

`recall-replay.ts:157` (`runRecallReplay`) runs the search twice, old path (signals inert) and new path (tuning, probes, window, anchors), both with `minImportance 0.3`. Each row reports cosine, rawWeight, blendedBefore, multiplier, fired, blendedAfter, and `selected = index < headSize`. Knobs: `tuning`, pinned `signals`, `asOf` (excludes newer ids and sets `weightClockMs`), a process-wide embedding memo (500 entries). It cannot measure: frozen-archive overlap removal; the token-budget cut; the inter-character half; compression; the 0.5 `minImportance` the fallback head uses; the anti-repetition set as of the replayed turn (it reads the current `commonplaceRecallHistory`); who was present at that turn (it uses the current participants, user personas included, whereas live uses character participants); reinforcement after `asOf`; anything at all on the text-fallback path.

#### C.4 Vector search (`memory-service.ts:771`, `searchMemoriesSemantic`)

1. Embed the query, optionally memoised; fire `captureQueryEmbedding`. The floor is `minScore ?? providerDefault` (:916).
2. Dimension mismatch → `searchMemoriesText` (:947).
3. Hot-only filter inside the scan unless `includeCold` (`isHotVector`, vector-store.ts:89). The R1 gate is turned off for `BUILTIN` providers (:962).
4. Over-fetch: `vectorStore.search(q, limit×3)` (:975). Up to 2 extra probes, each also `limit×3`, keeping the max cosine per memory (:985–1003).
5. Literal and entity union (:1012–1095): the tool query (≥ 8 characters, `LITERAL_BOOST_MIN_PHRASE_LENGTH`) plus up to 3 entity anchors (R4 selection). Missing hits are cosine-scored directly.
6. Score each candidate (:1116): `applyLiteralBoost = s + (1−s)·0.5` applies only when `literalPhrase` is set (tool path); then the floor `r.score >= minScore` (:1132). Bug: on the per-turn paths entity-anchor hits get no boost, so the floor still removes low-cosine verbatim place names. This contradicts the comments at :1006–1011 and :874–879.
7. Filters: `minImportance` (raw), `source`, `aboutCharacterId`. `bestCosine` is taken over the survivors (:1146).
8. Time window, two stages (:1163): no context → hard filter; `windowHits ≥ limit` → hard filter (with R6 background reserve); otherwise the soft ×1.3 boost. Because `limit` is 90 on the proactive path versus 15–30 on the fallback, the two head paths in practice almost never share the same window behaviour.
9. Blend × `combineRecallMultipliers`, sorted by `blendedAfter`; optional `expandRelatedMemories` (:1290, no floor, labelled `related↗`); R6 `reserveBackgroundSlots` (:752). Without a context, sort by the plain blend (:1235).
10. Text fallback (:1395):
    ```
    phrase-in-summary 0.4 + phrase-in-content 0.3
    + 0.2·contentWordFrac + 0.1·summaryWordFrac
    + 0.1·keywordFrac   (cap 1)
    ```
    Then the plain blend. It ignores `recallContext`, `occurredWithin`, `entityAnchors`, `extraProbes`, `excludeMemoryIds` and `weightClockMs`; the tool's time filter is lost on fallback.

#### C.5 Settings

`memoryRecall` (`settings.types.ts:170`, read via `getMemoryRecallSettings`, `instance-settings/index.ts:233`): `scopePolicy` (`'down-weight'` | `'exclude'`), `expandRelated` (default false), `perTurnConversationSummaries` (default false). Instance-wide only. Per-chat inputs: `projectId`, `compactionGeneration`, `commonplaceRecallHistory`, `commonplaceSceneCache`, `timelineMode`. `minMemoryImportance` is a `buildContext` option fixed at 0.5 by the caller. No per-character recall knobs exist. Retuning (`tuning`) is reachable only through replay.

#### C.6 Smells

1. Floor leak: floored `effectiveWeight` drives the fallback head sort, the Carina sort, the inter-character sort, archive fill and housekeeping demotion, despite the "no floor in ranking" rule at memory-weighting.ts:104.
2. Inconsistent `minImportance`: 0.3 (proactive, Carina, voice-rewrite, replay) vs 0.5 (fallback head, inter-character) vs 0 (tool). All filter raw `importance`.
3. Two time resolvers: `episodic.ts:126` (write, UTC point dates) vs `day-references.ts` (read, local windows), plus the LLM's UTC full-day ranges (memory-tasks.ts ~1556). A memory written as "last night" (stamped yesterday 00:00Z) can miss the read window for "last night" (18:00–06:00 local).
4. 1.3 window boost duplicated (recall-tags.ts:206, conversation-summary-search.ts). Ramp constants 3/10/4000/32000 duplicated (memory-recap.ts, conversation-summary-search.ts). Importance tier thresholds 0.7/0.3 (repository) vs 0.7/0.4 (tool formatter).
5. Fetching and formatting mixed: `generateMemoryRecap` fetches, calls the LLM and formats; `recallForSeed` and `loadCarinaMemoryRecall` search, format and mark accessed; `context-manager.ts` interleaves search, formatting, access marking and persistence across about 1300 lines.
6. "What was shown" is tracked inconsistently: accessed = archive + head + inter-character, before compression; anti-repetition = head only, and only if the whisper was posted; recap never counted; continue turns count memories the model never received; the tool counts only after the cross-source cut.
7. Archive "prefix-cache" design (frozen-archive-cache.ts:27–32) vs actual placement in the trailing user message (context-manager.ts:2787). The archive budget also varies with the retrospective flag.
8. Inter-character relevance re-embeds the query once per present character, ignores the recall context and the distilled query, and duplicates archive digests.
9. Text fallback silently drops every episodic and replay option (memory-service.ts:1395).
10. Recap bucket gap from mixing `importance` and `reinforcedImportance` (memories.repository.ts:443–462).
11. Search tool throws away the importance/recency blend in its final sort (search-scriptorium-handler.ts:525).
12. Tuning defaults are assembled in two places (`recall-tuning.ts:67`, `recall-tags.ts:289`).

### Appendix D — Maintenance, settings and operator surfaces

#### D.1 Housekeeping

`lib/memory/housekeeping.ts`:

- `DEFAULT_OPTIONS` (98): maxMemories 2000, maxAgeMonths 6, maxInactiveMonths 6, minImportance 0.3, mergeSimilar false, mergeThreshold 0.9. The doc comment at 33 still says the default is 1000.
- `PROTECTION_THRESHOLD = 0.5` (26).
- `isProtectedMemory` (123): `source === 'MANUAL'` or `'CONSOLIDATED'` always counts as protected. Anything else is protected when `calculateProtectionScore(...).score >= 0.5`. Neither is ever demoted. Retention excludes MANUAL in SQL but does not exclude CONSOLIDATED.
- `shouldDeleteMemory` (136): despite the name, it decides demotion. Eligible when `reinforcedImportance ?? importance` < minImportance, and `createdAt` age ≥ maxAgeMonths, and (`lastAccessedAt` is null or ≥ maxInactiveMonths ago). The reason string prints raw `memory.importance` (158/168), not the value it actually compared.
- `runHousekeeping` (195): loads the corpus in pages of 250, yielding with `setImmediate` (214–219); filters to hot rows (222) — the cap, the counts and every pass are measured on the hot tier only. Pass 1 (277): sorts by raw `importance` then createdAt (260); the sort has no effect because every row is visited; fills `protectedMap`. Pass 2: retired; `mergeSimilar` only logs (249). Pass 3 (306–356): if remaining hot rows > cap and any are unprotected, it scores rows by `calculateEffectiveWeight(...).effectiveWeight` and demotes the lowest unprotected ones until the excess is cleared. Retention (361–374): the only deletion; runs when `memoryConsolidation.coldRetentionDays` > 0; calls `repos.memories.findExpiredColdIds`. Writes: `updateTierBulk(..., 'cold')` plus `vectorStore.setTier` (378–381); `deleteMemoriesWithUnlinkBatch` plus `removeVector`/`save` (397–404); `invalidateFrozenArchive` (421), which does nothing in the child (comment at 417). `capUsed` is returned so the outcome cache can use it.
- `getHousekeepingPreview` (441) is a dry run. `needsHousekeeping` (455) uses an 80% threshold and is dead: it is only re-exported from `lib/memory/index.ts:53`.

`lib/memory/memory-weighting.ts`: `referenceTimeMs` (49) = max(createdAt, lastReinforcedAt); `calculateEffectiveWeight` (75): half-life 30 days, floor 0.70; `computeRankingBlend` (128): 0.75 × cosine + 0.25 × rawWeight — the comment at 104–118 says the 0.70 floor "exists to protect … from housekeeping deletion"; `calculateProtectionScore` (257), defaults at 221: content half-life 30 days, floor 0.10, capped at 0.40; reinforcement log2(count+1) × 0.08, capped at 0.25; graph degree 0.025 per link, capped at 0.10; recent access within 90 days +0.10; episodic +0.10.

Cap resolution (`perCharacterCapOverrides`), duplicated in two places: `lib/memory/memory-service.ts:72–75` (override → `perCharacterCap` → 2000) and `lib/background-jobs/handlers/memory-housekeeping.ts:64–67` (`payload.maxMemories` → override → perCharacterCap → housekeeping default). The manual API path `?action=housekeep` (`app/api/v1/memories/route.ts:631`) ignores `autoHousekeepingSettings` entirely and uses the 2000 default unless the body sends `maxMemories`.

Triggers and backoff: `maybeEnqueueHousekeeping` (`memory-service.ts:63`), called after inserts at 478 and 490: fires at a 0.9 watermark of the hot count (43, 78); then checks `shouldSkipWatermarkSweep`; then a durable 15-minute DB throttle using `backgroundJobs.findRecentByType('MEMORY_HOUSEKEEPING', 50)` matched on `payload.characterId` (101–112); then a dynamic import of `enqueueMemoryHousekeeping` (121). `housekeeping-outcome-cache.ts`: the map is local to the job child; `shouldSkipWatermarkSweep` (65) skips for 1 hour when the last sweep removed fewer than max(10, 1% of excess) rows; the handler records `demoted + deleted` into the field named `deleted` (`memory-housekeeping.ts:101–106`). `enqueueMemoryHousekeeping` (`lib/background-jobs/queue-service.ts:607`): dedupes on PENDING/PROCESSING jobs for the same (userId, characterId); an undefined characterId means a user-wide sweep; `maxAttempts` = 1; payload type at 296: `characterId?`, `maxMemories?`, `mergeThreshold?`, `mergeSimilar?`, `dryRun?`, `reason`. Handler `handleMemoryHousekeeping` (`lib/background-jobs/handlers/memory-housekeeping.ts:18`): bails when auto is disabled, unless `reason` is `'manual'`; sweeps one character or every character the user owns; passes `mergeSimilar`/`mergeThreshold` through even though both are ignored; guards against a NaN `deleted` count (82–90).

Scheduled sweep: `lib/background-jobs/scheduled-housekeeping.ts`, registered at `instrumentation.ts:850`. Daily `setInterval`, a 5-minute startup grace, and a startup skip when a scheduled run completed within 20 hours (80–111). `runScheduledHousekeeping` (133) calls `runScheduledConsolidation` first; if anything was enqueued, housekeeping is delayed by `HOUSEKEEPING_AFTER_CONSOLIDATION_DELAY_MS` = 30 min (41, 146); it then enqueues one user-wide job per enabled `chat_settings` row. `lib/background-jobs/scheduled-maintenance.ts` (registered at `instrumentation.ts:853`) runs on the parent and touches no memory rows; its only memory-adjacent step is `enqueueFoldOtherCatchups`.

#### D.2 Consolidation

`lib/memory/consolidation.ts` — `runConsolidation` (711): settings = `getMemoryConsolidationSettings()` merged with `opts.settings` (721); skips characters that are missing or archived; reads the holder with `findByIdRaw` (748). Load — `loadCorpus` (313): pages of 250; every row goes into `rowIndex` (links); hot CONSOLIDATED rows that have an embedding become bucket digests; hot AUTO rows older than `matureAfterDays` that have an embedding become candidates; MANUAL rows are skipped (360); buckets come from `bucketKeyOf` (280): `self` / `other:<id>` / `none`. Per-bucket cap — `capBucketRows` (380): `CONSOLIDATION_MAX_BUCKET_ROWS = 2000` (106); never-considered rows sort first, then by reinforcedImportance. Cluster: `clusterBucket`, then `selectClusters` (800, 816); rows in clusters below the size floor get `consolidatedAt` stamped (829). Model route: `resolveModelRoute` (399): `connectionProfileId`, else the cheap LLM; `routeForCluster` (428) is the Concierge inheritance: a Locked member chat wins, then Unmoderated (routes to the uncensored desk), then the global policy; failover only happens if the policy allows it. Canon: `describeBuckets` (465); self: `loadCanonForSelf` on card fields, no Commonplace file; other: `loadCanonForObserverAboutSubject(..., { includeCommonplace: false })`. Budget: `timeBudgetMs` checked at 851; deferred clusters are counted. Plan and write: `planConsolidationWrites` runs twice, once before and once after embedding (975, 1018); a cluster whose digest fails to embed is dropped whole; `executePlan` (561) does, in order: creates, then `updateForCharacter` for the embedding, updates, `updateTierBulk(cold, { supersededById, consolidatedAt })`, `markConsidered`, link rewrites, `store.save()`. Announce (1038–1040): `invalidateFrozenArchive`, `publishRealtime('memories')`, then `mirrorTouchedBuckets` (643) → `writeCommonplaceDigestsToVault`.

`consolidation-clustering.ts` (pure): digest attraction, then average-linkage agglomeration (Lance–Williams). Semantic and episodic rows are split; `EPISODIC_WINDOW_MS` = 1 day (41). `effectiveMinClusterSize` (331): drops to 2 when any member is older than 2 × matureAfterDays. `clusterHasNewMaterial` (345). `selectClusters` (357): sorts by `cluster.score` (sum of reinforcedImportance) and takes the top `maxClusters`.

`consolidation-plan.ts` (pure): `DIGEST_REINFORCEMENT_CAP` = 50 (50). `clampDigestImportance` (177): clamps to 0.2–1, then to the members' [min, max]. `planConsolidationWrites` (268): writes `consolidatedFrom`, `supersededById`, contradiction supersession, and inbound-link remapping (`remap`, up to 5 hops).

`cheap-llm-tasks/consolidation-tasks.ts`: `consolidateMemoryCluster` (344), `validateConsolidationOutput` (101). Output limit `CONSOLIDATION_MAX_TOKENS` = 4000 (41); each member is capped at 1200 characters (44).

Triggers — `consolidation-triggers.ts`: `runScheduledConsolidation` (168): `findDistinctCharacterIds`, then enqueues when `countUnconsideredHot` ≥ 2. `maybeEnqueueConsolidationAfterCommit` (153) is called by the dispatcher's `checkConsolidationWatermarkAfterCommit` (`host/job-dispatcher.ts:257, 651`): ignores MEMORY_CONSOLIDATION jobs; looks only at `memories.create` writes; 10-minute debounce per character, held in a parent in-memory map (38, 45); threshold: unconsidered count > `watermark`; 6-hour throttle via `findRecentByType` (79). `enqueueMemoryConsolidation` (`queue-service.ts:671`): dedupes on (characterId, dryRun); `maxAttempts` = 1.

Handler — `handlers/memory-consolidation.ts`: `CONSOLIDATION_JOB_TIME_BUDGET_MS` = 7 min (35). Automatic triggers bail when disabled (47). A dry-run report only goes to the log (64).

Vault mirror: `lib/file-storage/commonplace-digest-vault-bridge.ts:68`: when `QUILLTAP_JOB_CHILD === '1'` it uses `callHost` (71). The host side is `host-rpc-dispatcher.ts:117`. Rendering lives in `lib/memory/commonplace-file.ts`: `commonplacePathFor` (42) → `Commonplace/<sanitized>.md` or `Commonplace/Self.md`; a character actually named "Self" gets an id-prefix suffix; `renderCommonplaceFile` (88) has a 1500-token budget; `commonplaceFileToCanonText` (127).

Canon order — `cheap-llm-tasks/canon.ts`: self: manifesto → personality → description → identity, then `Commonplace/Self.md` (`loadCanonForSelfWithCommonplace` at 233, used by `memory-processor.ts:523`); other: `Others/<name>.md`, else identity, else description (`loadHandCanon`, 274), then `Commonplace/<name>.md` (255), used by `memory-processor.ts:651` and `fold-other-pass.ts:317`. `CANON_BLOCK_TOKEN_CAP` = 2500 (61). Only the digest part gets truncated.

`memory-recap.ts`: `generateMemoryRecap` (277) is a cheap-LLM narrative recap of hot memories by importance band; `digestsFirst` (248) puts digests first. Consumed by `lib/chat/context-manager.ts:1316`, which is driven by `context-builder.service.ts:887/1118`. `buildRecentConversationsBlock` (86) is consumed by `app/api/v1/chats/route.ts:737`. The band query `findRecentByImportanceTier` filters `tier: 'hot'` (`memories.repository.ts:442–470`).

#### D.3 Tiers

Schema: migration `add-memory-tiers-v1` adds `tier` (default `'hot'`), `supersededById`, `consolidatedFrom` (`'[]'`), `consolidatedAt`, index `(characterId, tier)`, and `chats.otherExtractionWatermarkMessageId`.

Repository (`lib/database/repositories/memories.repository.ts`): `HOT_TIER_SQL` (33); `findByCharacterIdPaginated` with a `tier` filter (212); `create` defaults `tier` to hot (497); `countHotByCharacterId` (758), `countUnconsideredHot` (777), `findColdIdsByCharacterId` (802; stamps tiers into the vector store at load); `findHotDigests` (820), `updateTierBulk` (874), `markConsidered` (911), `findSupersededBy` (933); `findExpiredColdIds` (947): cold + superseded + not MANUAL + `updatedAt` < cutoff.

Writers:

| What | Where |
|---|---|
| Demote to cold | `housekeeping.ts:378` |
| Consolidate to cold (with supersededById) | `consolidation.ts:614` |
| Promote back to hot | `memory-gate.ts:resolveColdForAbsorb` (186) → `promoteColdMemory` (222), only for cold rows without supersededById |
| Import | `import-entities.ts:519–522` |

Superseded rows are redirected to their digest on absorb (195) and on link (`redirectColdLink`, 248).

Readers: recall hot-only filters: `memory-service.ts:951–958, 1034, 1111, 1329, 1447`; Scriptorium search passes `includeCold: true` (`search-scriptorium-handler.ts:278`), label from `memoryArchivedLabel` (584); the Memories API search also passes `includeCold: true` (`route.ts:560`); Brahma SQL prompt text (`brahma-sql-prompt.ts:62`); CLI `--tier` filter (`memories-commands.js:241`). `coldRetentionDays` (default null = never) is read only at `housekeeping.ts:363`.

Every path that deletes AUTO rows:

| Path | Respects source/tier? |
|---|---|
| Retention (`housekeeping.ts:397`) | Yes: cold + superseded + not MANUAL only |
| Dedup tool (`lib/tools/memory-dedup.ts:157`, delete at 335; API `system/tools?action=memory-dedup`) | No filtering — `findByCharacterId` (168) reads all tiers and sources |
| Chat wipe `deleteMemoriesByChatIdWithVectors` (`memory-service.ts:1768`; used by `DELETE /memories?chatId=` and `MEMORY_REGENERATE_CHAT`) | No — deletes every row with that chatId, including MANUAL rows, cold members and single-chat digests |
| Message/swipe cascades (`memory-service.ts:1640–1750`) | not checked in detail |
| Cascade delete (`cascade-delete.ts:380`) | n/a (whole character/chat) |
| Character archive (`archive-service.ts:764`) | n/a (whole character) |
| Restore delete-service (`delete-service.ts:167`) | n/a |
| Item delete (`memories/[id]/route.ts:132`) | Single row, explicit user action |

#### D.4 Memory settings

Instance settings (`lib/instance-settings/index.ts`; schemas in `lib/schemas/settings.types.ts`):

| Key | Schema line | Defaults | Readers |
|---|---|---|---|
| `memoryRecall` | 170 | scopePolicy down-weight, expandRelated false, perTurnConversationSummaries false (91) | `context-manager.ts:1353`, `pre-compute.service.ts:307`, `recall-replay.ts:231` |
| `memoryConsolidation` | 219 | enabled false, connectionProfileId null, clusterThreshold 0.72, minClusterSize 3, maxClusterSize 30, matureAfterDays 7, maxClustersPerRun 40, watermark 150, coldRetentionDays null | consolidation*, `housekeeping.ts:363`, handler |
| `memoryExtractionMode` | 256 | otherPass hybrid, perTurnOtherFloor 0.75, foldCandidatesPerSubject 3 | `memory-processor.ts:606`, `fold-other-pass.ts:161/485`, `memory-regenerate-chat.ts:133` |
| `memoryExtractionLimits` | 277 | enabled false, 20/hour, softStart 0.7, softFloor 0.7 (85) | `memory-extraction.ts:126`, `carina-memory-extraction.ts:121`, `fold-other-pass.ts:281`, `chats/[id]/actions/memories.ts:241` |
| `memoryExtractionConcurrency` (plain string) | — | 1 | `route.ts:1376` |
| `dataRetention` | 307 | staleChatDays 30 | maintenance only (`retention-constants.ts:53`); does not affect memories |

Per-user `chat_settings` columns: `autoHousekeepingSettings` (schema 141; defaults repeated at `settings.types.ts:733`, `chat-settings.repository.ts:171`, `route.ts:768/789`, `memory-housekeeping-card.tsx:28`, `phase3-ledgers.ts:638`): enabled false, perCharacterCap 2000, perCharacterCapOverrides {}, autoMergeSimilarThreshold 0.9, mergeSimilar false. `memoryCascadePreferences` (121). The legacy column `chat_settings.memoryExtractionLimits` is still declared (`settings.types.ts:740`, `chat-settings.repository.ts:175`); it was superseded by `migrateExtractionKnobsToInstanceSettingsMigration`, and no runtime code reads it.

Settings that are read but ignored: `mergeSimilar` and `autoMergeSimilarThreshold` (still settable through the API schema `route.ts:126–127`, the UI card, and the job payload; housekeeping does nothing with them); `HousekeepingOptions.mergeThreshold` / `userId` / `embeddingProfileId` (`housekeeping.ts:43–49`); `HousekeepingResult.merged` / `mergedIds` are always 0 / empty; pass-1 knobs (`maxAgeMonths`, `maxInactiveMonths`, `minImportance`) are not persisted anywhere — only the manual API and the dialog can set them.

#### D.5 Operator surfaces

Settings tab (`app/settings/SettingsView.tsx:38`, id `memory`, labelled "Commonplace Book") renders `components/settings/tabs/MemorySearchTabContent.tsx` with these cards: Embedding Profiles; `memory-backfill-card`; `memory-housekeeping-card` (config, per-character overrides, `housekeep-sweep`); `memory-consolidation-card` (+ `memory-consolidation-report-dialog`); `memory-extraction-grain-card`; `memory-recall-card`; `memory-dedup-card` (`system/tools`); `memory-regenerate-card`; `conversation-summary-regenerate-card`. There is no UI for `extraction-limits-config` or `extraction-concurrency`.

Per-character browser: `app/aurora/[id]/view/components/MemoriesTab.tsx` → `components/memory/memory-list.tsx` (source and tier filters, view-digest at 197), plus `memory-card.tsx`, `memory-editor.tsx`, and `housekeeping-dialog.tsx` (GET/POST `?action=housekeep`, local default maxMemories 1000 at 37).

Memories API, `app/api/v1/memories/route.ts`: GET actions `housekeep` (preview), `embeddings`, `housekeeping-config`, `extraction-limits-config`, `recall-config`, `consolidation-config`, `extraction-mode-config`, `backfill-embeddings`, `character-memory-counts`, `extraction-concurrency`, `regenerate-all`; with no action: list by characterId (filters: tier/source/paged), count by chatId, or get by messageId. POST actions `search`, `housekeep` (synchronous, in the parent), `housekeep-sweep`, `embeddings`, `housekeeping-config`, `extraction-limits-config`, `recall-config`, `consolidation-config`, `extraction-mode-config`, `consolidate`, `backfill-embeddings`, `regenerate-all`, `extraction-concurrency`, `anchor-gate-probe`; with no action: create. `consolidate` with `dryRun` runs in-process (default 10 clusters, max 40, 120 s budget); otherwise it enqueues a job. PUT `?action=embeddings` rebuilds the index. DELETE `?chatId=`. `app/api/v1/memories/[id]/route.ts`: GET (32; bumps `lastAccessedAt` at 58), PUT (76), DELETE (118).

CLI (`packages/quilltap/bin/quilltap.js`): `memories`, routed at 1219 to `lib/memories-commands.js` (dispatch at 1434): `ls`, `find`, `grep` (`--semantic` goes through the server), `show`, `tree`, `status`, `validate` (uses `lib/graph-integrity.js`), `consolidate` (`lib/memories-consolidate-command.js` → POST `?action=consolidate`); `memory-diff` → `lib/memory-diff-command.js`; `recall-replay` → `lib/recall-replay-command.js`; `anchor-probe` → `lib/anchor-probe-command.js`; `db memories` → `lib/db-commands.js:657` (source filter is AUTO|MANUAL only, no tier).

Help pages: `help/memory-housekeeping.md`, `memory-consolidation.md`, `memory-recall-relevance.md`, `memory-regenerate.md`, `episodic-memory.md`, `memory-playing-a-character.md`, `cli-memories.md`.

#### D.6 Export, import, backup, migrations

- `.qtap` export: `lib/export/ndjson-writer.ts`. `stripEmbedding` (145) emits per character (317–323) or per chat (448, filtered by chatId). The record type is `QtapMemoryRecord`, i.e. `Omit<Memory, 'embedding'>` (`lib/export/types.ts:735`). There is also a legacy collector in `quilltap-export-service.ts:26/40`.
- Import: `quilltap-import-stream.ts:291` drops the embedding. `import-entities.ts:importMemories` (433) mints ids up front and remaps `supersededById`, `consolidatedFrom` and `relatedMemoryIds` (518–522). It uses a raw create, not the gate.
- Schema: `public/schemas/qtap-export.schema.json` defines `$defs/Memory` (977), including `source` (991), `tier` (992), `supersededById` (997), `consolidatedFrom` (1001) and `consolidatedAt` (1006).
- Backup (`lib/backup/backup-service.ts:207–216`) keeps encoded embeddings; the lite variant nulls them (588). Restore: `restore/archive.ts:190` reads `data/memories.json`; `uuid-remap.ts:339–346` remaps supersededById and consolidatedFrom.
- Migrations touching `memories`, in registry order (`migrations/scripts/index.ts`): sqlite-initial-schema; add-memory-gate-fields; normalize-vector-storage; fix-text-embeddings-after-update; fix-memory-timestamps-from-source; rename-persona-columns; normalize-embeddings-unit-vectors; add-auto-housekeeping-settings-field; add-memory-extraction-limits-field; add-memory-extraction-concurrency-field; migrate-extraction-knobs-to-instance-settings; align-about-character-id; align-about-character-id-v2; add/apply-embedding-profile-truncation; add-memories-reinforced-importance-index-v1; repair-dangling-related-memory-edges-v1; add-autonomous-rooms-fields; quantize-embeddings; add-episodic-memory-fields; add-memory-tiers-v1. Items 8–11 are chat_settings only. Also `move-llm-logs-to-separate-db` mentions memories. `add-commonplace-*` touch `chats`, not `memories`.

#### D.7 Smells

Several ranking formulas for "what's worth keeping": housekeeping pass 1 (reinforcedImportance + createdAt + lastAccessedAt, `housekeeping.ts:147–170`, which contradicts the `referenceTimeMs` rule that passive access doesn't reset the clock); protection score (`memory-weighting.ts:257`); pass 3 `effectiveWeight` with the 0.70 floor (`housekeeping.ts:318`); consolidation bucket cap (`consolidation.ts:380`) and cluster score (`clustering:selectClusters`); dedup `scoreMemory`: raw importance × 100 + length + regex "specificity" (`memory-dedup.ts:115`); recall `rawWeight` blend. `help/memory-housekeeping.md:43` says the cap sweep uses "the same formula the chat prompt uses for retrieval". That is false: pass 3 uses the floored `effectiveWeight`, not the retrieval `rawWeight`.

Viewing a memory protects it: `GET /memories/[id]` bumps `lastAccessedAt` (`[id]/route.ts:58`), which feeds the +0.10 recent-access bonus.

Settings that no longer do anything: `mergeSimilar` / `autoMergeSimilarThreshold` end to end; `needsHousekeeping` is dead; the `chat_settings.memoryExtractionLimits` column is dead. Stale comments: `memory-merge.ts:5` says housekeeping calls the merge; `memory-service.ts:96–97` blames "mergeSimilar compares embeddings"; `settings.types.ts:144` says the trigger is at 80%, the code uses 0.9; `scheduled-maintenance.ts:25–26` says housekeeping runs inline on the parent, it is a job in the child.

Inconsistent defaults and caps: housekeeping defaults are copied in 6 places; cap bounds differ: API body allows 10–10000 (`route.ts:101`), preview allows 1–100000 (`route.ts:720`), config allows 100–100000 (`route.ts:124`); the dialog defaults to 1000, everything else to 2000; the manual `housekeep` action ignores the per-character override; `character-memory-counts` counts all tiers (`route.ts:1003`, `countByCharacterId` at repo 738), but the card's over-cap check compares that number to a hot-only cap (`memory-housekeeping-card.tsx:239`).

Housekeeping and consolidation step on each other: housekeeping can demote AUTO rows before consolidation ever considers them; consolidation loads only hot rows (`consolidation.ts:348`), and retention deletes only superseded rows, so those demoted rows can never be digested and never expire. Both loops repeat the same paged load-and-yield code (`housekeeping.ts:214`, `consolidation.ts:344`). Both use the same `findRecentByType(…, 50)` throttle, written twice (`memory-service.ts:101`, `consolidation-triggers.ts:79`). The cap counts MANUAL rows and digests, which are always protected, so it can be unreachable; the backoff cache exists to paper over that.

Process boundary handled case by case: the outcome cache is a map in the child process, while the consolidation debounce is a map in the parent. `invalidateFrozenArchive` / `publishRealtime` are called in code that runs in the child, where they do nothing (`housekeeping.ts:421`, `consolidation.ts:1038`); the dispatcher has to redo them (`job-dispatcher.ts:649–690`; `bus.ts:116`). `deleteMemoriesWithUnlinkBatch` returns NaN in the child, so a guard was added downstream (`memory-housekeeping.ts:78–90`). The vault mirror is written over host-RPC immediately, while the DB writes are buffered until commit (`consolidation.ts:1040`, bridge:71); if the batch fails to apply, the `Commonplace/` files describe digests that were never saved. The dedupe/throttle checks only match on `characterId`: a user-wide scheduled job (no characterId) does not block a per-character watermark job, so both can sweep the same character at once (`queue-service.ts:619–621`, `memory-service.ts:107`).

Dangling references: retention and other deletes leave the digest's `consolidatedFrom` pointing at removed ids; the unlink helpers only scrub `relatedMemoryIds` (`memory-gate.ts:770–930`). Deleting a digest leaves its members cold with a dangling `supersededById`. The retention clock is `updatedAt`, which link rewrites can reset. Chat-scoped export filters by chatId, so it can ship cold members without their digest (`ndjson-writer.ts:448`).

Editing doesn't keep derived data in step: `PUT /memories/[id]` uses raw `updateForCharacter` (`[id]/route.ts:93`); it does not re-embed, recompute `reinforcedImportance` on an importance edit, refresh the Commonplace mirror, or invalidate the frozen archive.

Dedup ignores tiers and sources: it can delete MANUAL rows, CONSOLIDATED digests and cold members (`memory-dedup.ts:168`).

Manual consolidate drops a parameter: outside a dry run, `clusterThreshold` is accepted but silently dropped — the job payload has no field for it (`route.ts:983`, `queue-service.ts:650`).
