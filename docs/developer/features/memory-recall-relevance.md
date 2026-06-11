# Memory Recall Relevance — Reading the Targeting Tags Back at Recall Time

Status: **PHASE 1 IMPLEMENTED (4.7-dev)** — items 1 (scope + project gating) and
2 (temporal down-weighting) are implemented, wired into both recall paths, with
the cross-project scope-policy setting and debug instrumentation. Phase 2 (items
3–5: context steering, participant boost, related-memory expansion, plus the
two-recall-path query unification) remains the tracked follow-up below. Recall-
side follow-up to
[`memory-extraction-enrichment.md`](./memory-extraction-enrichment.md), which is
extraction-side-implemented. That doc writes the `temporal` / `scope` / `context`
targeting tags onto every memory and plumbs `projectId` onto derived memories;
this doc reads those signals back to make the Commonplace Book whispers more
relevant per turn. The two docs are deliberately disjoint file-sets: enrichment
touches the extraction/write path, this touches the recall/read path.

Phase 1 implementation note: the cross-project scope-policy setting lives in the
migration-free `instance_settings['memoryRecall']` key/value store (single-user
model), **not** on the column-per-field `chat_settings` table (which would have
needed a migration) — same call as `memoryExtractionLimits` in 4.4. Accessors:
`getMemoryRecallSettings` / `setMemoryRecallSettings`. The pure tag-reading +
multiplier logic is `lib/memory/recall-tags.ts`.

## Motivation

We now *extract* far more structure than we *read*. Every memory carries three
controlled targeting tags (`temporal`, `scope`, `context`) and a rename-proof
`projectId`, but the per-turn recall path consults none of them. It ranks purely
on `0.4·cosine + 0.6·effectiveWeight` (`lib/memory/memory-service.ts`
`searchMemoriesSemantic`), where `effectiveWeight` is importance × 30-day
time-decay. The richest signals the extractor produces are inert at the moment
they would do the most good.

Three concrete failure modes follow from that:

1. **Cross-project leakage.** A `scope: narrow` memory — "true only inside this
   project/story" by the extractor's own definition — can surface in an
   unrelated chat and mislead the character. This is the single most common
   bad-recall case and the most clearly *wrong*, not merely sub-optimal.
2. **Stale `past` outranking live `present`.** A memory tagged `past` ("was true
   once, no longer true") can outrank a `present` fact on recency+importance
   alone, so the character "remembers" something that has been explicitly
   superseded. This is a correctness bug wearing a relevance costume.
3. **Uneven query quality between the two recall paths.** The proactive-recall
   path distills recent conversation into keywords via a cheap LLM
   (`lib/memory/cheap-llm-tasks/memory-tasks.ts` `extractMemorySearchKeywords`),
   but the dynamic-head path embeds the **raw last user message verbatim**
   (`lib/chat/context-manager.ts`, `memorySearchQuery = newUserMessage`). Same
   character, same turn, two different query qualities depending on which path
   fired.

This change reads the existing tags back, adds project/participant awareness to
ranking, and unifies the two query paths — without re-tuning the core blend
blind.

## What recall consults today vs. ignores

Confirmed by reading the recall path (`searchMemoriesSemantic`,
`context-manager.ts` Phases 3a/3b and 2b, `memory-injector.ts`):

**Consulted today:** cosine similarity, `importance`, `reinforcedImportance`,
time-decay (`createdAt`/`lastReinforcedAt`), `source` (AUTO/MANUAL),
`aboutCharacterId` (inter-character pool only, as a strict filter), holder
`characterId`.

**Extracted but ignored at recall:** the `temporal` / `scope` / `context` tags
(stored inside `keywords`), the free-text `keywords` themselves (never matched
against the turn), `Memory.projectId`, `relatedMemoryIds` (used only to *group*
inter-character output, never to expand candidates), and the identity of the
characters actually present this turn (the main dynamic head does not boost
about-present memories the way the separate inter-character pool filters on
presence).

## Design decisions (proposed)

- **Tags are read from `keywords`, not re-parsed from a new column.** The
  enrichment doc deliberately materializes the tags into the existing
  `keywords: string[]` array with no schema change. Recall reads them the same
  way: a small pure helper parses `temporal` (bare word), `scope` (`scope: …`),
  and `context` (bare word) back out of `keywords`. **No schema, migration, DDL,
  qtap-export, or backup changes on this side either.**
- **Scope enforcement compares `Memory.projectId`, never a project-name
  keyword.** Per the enrichment doc's explicit warning: keywords freeze at write
  time, so a name would break on rename or duplicate display names. The ID is
  the single source of truth. `chat.projectId` already flows into the context
  manager (`context-manager.ts`, `projectId: options.chat.projectId ?? null`),
  so both sides of the comparison are already in hand.
- **Adjustments are bounded multipliers / filters on the FINAL blended score,
  not new terms inside the blend.** The `0.4/0.6` blend is left untouched in this
  change. Stacking new additive terms into a 0.6-weighted recency-dominated blend
  risks producing the opposite failure (semantic relevance stops mattering). Each
  tag-derived adjustment is a clamped multiplier applied *after* the existing
  sort key is computed, so its effect is auditable in isolation.
- **Down-weight before exclude.** Default behavior is a multiplicative penalty,
  not a hard filter — except cross-project `scope: narrow`, which is the one case
  the enrichment doc itself names as exclude-or-down-weight. A user-facing
  setting picks between "exclude" and "strong down-weight" for that one case;
  everything else only ever re-weights, so we never *hide* a memory that the
  semantic match wanted badly enough.
- **Unify the two query paths.** The dynamic head routes through the same
  keyword-distillation the proactive path already uses, and that distillation is
  extended to also emit a best-guess `temporal` / `context` for the *current
  turn* so the per-turn adjustments have something to compare a memory's tags
  against. One query-construction path, one quality bar (SRP/DRY).

## The adjustments, in priority order

Highest correctness-per-effort first. Items 1–2 are the cheap, high-correctness
wins and read only signals already on the hydrated memory; 3–5 add new retrieval
logic.

### 1. Scope + project gating (highest leverage)

After candidates are hydrated (they already carry `projectId` and the parsed
`scope`):

- `scope: wide` → pass through unchanged (true regardless of project).
- `scope: narrow` AND `memory.projectId` set AND
  `memory.projectId === currentChat.projectId` → **boost** (this is exactly the
  story this memory belongs to).
- `scope: narrow` AND `memory.projectId` set AND
  `memory.projectId !== currentChat.projectId` → **exclude or strong
  down-weight** (per setting; this is the cross-project-leakage fix).
- `scope: narrow` with `projectId: null` (legacy/untagged) → pass through
  unchanged (nothing to compare; never penalize on missing data).

This directly discharges the recall-side follow-up the enrichment doc tracks
(its §"Follow-up: recall-side scope enforcement").

### 2. Temporal down-weighting of stale `past`

- `past` → small multiplicative penalty (a `past` fact should rarely outrank a
  live one, but isn't worthless — history still matters sometimes).
- `moment` → slight penalty *only when the recalling turn is not the turn that
  produced it* (a `moment` fact is, by definition, true only at one instant).
- `present` / `future` → unchanged.

No new data — `temporal` is already in `keywords`. Pure post-sort multiplier.

### 3. Context-axis steering

Have the unified keyword-distillation emit a dominant `context` guess for the
current turn (one of the closed 7). Boost memories whose `context` tag matches
the turn's guessed context. Lowest-confidence of the tag adjustments (the guess
is itself model output), so the smallest multiplier — but it's the natural use
of the third axis and costs one extra field on an LLM call we're already making.

### 4. Participant-aware boosting (main dynamic head)

In a multi-character room we already know `otherCharacterIds`. The *separate*
inter-character pool filters strictly on presence, but the main dynamic head
does not boost about-present memories at all. Add a **boost** (not a filter —
absent people still get discussed) when `memory.aboutCharacterId` is one of the
characters currently present this turn.

### 5. Related-memory one-hop expansion

`relatedMemoryIds` is stored and only used to group inter-character output.
After the top-K semantic hits are chosen, pull each hit's strongly-linked
neighbors in as low-cost extra candidates (one hop only, capped), then re-rank
the union. This catches the memory that's relevant by association but didn't
clear the embedding threshold directly — the classic RAG miss. Cap the
expansion and the per-hop count so corpus-heavy characters don't balloon the
candidate set.

## Data sources (all already reachable at recall time)

| Datum | Source | New query? |
|---|---|---|
| `temporal` / `scope` / `context` tags | parsed from `memory.keywords` (already hydrated) | none |
| `memory.projectId` | column on the hydrated `Memory` | none |
| `currentChat.projectId` | already on the context-manager options (`options.chat.projectId`) | none |
| present `otherCharacterIds` | already computed for the inter-character pool | none |
| `relatedMemoryIds` neighbors (item 5 only) | `repos.memories.findByIds(neighborIds)` | one batched lookup, only when expansion is on and hits have neighbors |
| turn-level `temporal` / `context` guess (items 2–3) | extended `extractMemorySearchKeywords` return | none (same cheap-LLM call) |

No new background-job payload fields. Recall runs on the request path (the
parent process), not in the forked child, so the `getRepositories()`
read-through proxy behaves normally — no buffered-write concerns here.

## Touch list

| File | Change |
|---|---|
| `lib/memory/recall-tags.ts` *(new)* | Pure helpers: `parseTargetingTags(keywords)` → `{ temporal, scope, context }`; the tag/project/participant multiplier functions. Pure + independently unit-testable; no I/O. |
| `lib/memory/memory-service.ts` | `searchMemoriesSemantic` gains an optional `recallContext` (current `projectId`, present `aboutCharacterIds`, turn `temporal`/`context` guess, and the scope policy). When present, apply the bounded multipliers/exclusion to the final blended score *after* the existing `0.4/0.6` sort key, before `slice(0, limit)`. Absent → byte-identical behavior to today. |
| `lib/chat/context-manager.ts` | Pass `recallContext` into both the dynamic-head and (where applicable) inter-character calls, sourced from `options.chat.projectId` and the already-computed present-character set. Route the dynamic head through the unified keyword distillation instead of the raw `newUserMessage`. |
| `lib/services/chat-message/pre-compute.service.ts` | Proactive-recall path passes the same `recallContext`; consume the extended turn-level `temporal`/`context` guess. |
| `lib/memory/cheap-llm-tasks/memory-tasks.ts` | Extend `extractMemorySearchKeywords` to optionally return a turn-level `temporal` + `context` guess alongside the keyword list (additive; existing callers ignore it). |
| `lib/memory/memory-service.ts` (related expansion, item 5) | Optional one-hop `relatedMemoryIds` expansion behind a flag in `recallContext`; batched `findByIds`, capped. |
| Settings (Memory tab) | The cross-project `scope: narrow` policy toggle (exclude vs. strong down-weight) and an on/off for related-memory expansion. Wire through `/settings?tab=memory`. |
| `lib/chat/context/memory-injector.ts` | The delivered-memory metadata tag (`_(importance … · relevance … · weight …)_`) gains the recall adjustments applied, so the salon whisper *shows why* a memory ranked where it did — essential for tuning. |
| `__tests__/.../recall-tags.test.ts` *(new)* | Tag parsing (valid/invalid/missing round-trips with the extraction-side defaults); each multiplier in isolation; cross-project narrow exclusion; legacy `projectId: null` passes through unpenalized; participant boost; one-hop expansion cap. |
| `docs/CHANGELOG.md` | Terse dev-facing entry (no steampunk voice). |
| `help/*.md` | The cross-project recall policy and related-memory expansion are user-visible settings — document in the memory help file with correct `url` frontmatter + matching `help_navigate` call. |

No changes to: memory schema (tags live in `keywords`, `projectId` column
exists), DDL.md, qtap-export schema, migrations, backups, tool-definition
snapshot.

## Why this is a clean recall-side unit

The enrichment doc owns the write path and ends by explicitly tracking
recall-side scope enforcement as "a recall-path change, in a different set of
files … tracked as a distinct follow-up." This doc is that follow-up, widened to
also use the `temporal` and `context` axes (already written, also free to read)
and to fix the unrelated query-quality asymmetry between the two recall paths.
The extraction prerequisite — derived memories actually carrying `projectId` —
belongs to the enrichment doc and is assumed done here; without it, item 1's
cross-project comparison has nothing to compare and the code path simply falls
through to "pass through unchanged."

## Risk and instrumentation (do this before tuning)

The blend constant `0.4·cosine + 0.6·effectiveWeight` already lets recency
dominate. Layering multiplicative boosts on top can easily produce a ranking
where semantic relevance barely registers — the inverse of today's failure. To
tune with eyes open rather than blind:

- Keep every adjustment a **clamped multiplier on the final blended score**, with
  the blend itself untouched in this change.
- Extend the existing `debugMemories` output (`memory-injector.ts` already
  computes per-memory `importance` / `relevance` / `weight`) to log the
  *pre-adjustment* and *post-adjustment* score plus which adjustments fired, so
  every ranking decision is explainable from the per-turn debug log.
- Land items **1 and 2 first** (highest correctness, read-only on existing
  fields, smallest blast radius), verify against real chats via the debug
  output, and only then add 3–5.

## Debug logging

Per project convention, every new branch fires `logger.debug`: which adjustments
applied to each candidate and the multiplier each contributed; cross-project
exclusions (memory id, its `projectId`, the chat's `projectId`); related-memory
expansion (how many neighbors pulled, how many survived the re-rank). All at
debug so a single chat turn's recall decisions are fully reconstructable from
`logs/combined.log` without re-instrumenting.

## Worked acceptance example

Carry forward the enrichment doc's worked memory. After extraction in project
**Foundry-9**, Ariadne holds:

```
content   = "I committed to restructuring the summarization pipeline …"
keywords  = ["summarizer","commitment","architecture","future","scope: narrow","philosophy"]
projectId = <Foundry-9 projectId>
```

Recall behavior with this change:

- **Same project (Foundry-9), turn is about architecture.** `scope: narrow` +
  `projectId` match → boosted. Turn `context` guess `philosophy` matches the
  memory's `philosophy` → further small boost. `temporal: future` → no penalty.
  Surfaces high, correctly.
- **Different project.** `scope: narrow` + `projectId` mismatch → excluded (or
  strong down-weight per setting). The cross-project leak is closed.
- **Legacy copy with `projectId: null`.** Nothing to compare → passes through on
  the unchanged blend, never penalized for missing data.
